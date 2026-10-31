"""Bridge trade orders and customers to the deterministic tariff engine."""
import logging
import re
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from database import connection
from orders_api import get_order
from tenancy import require_tenant
from mariner.api.errors import ApiException
from mariner.api.imports import parse_orders
from mariner.api.import_jobs import csv_bytes
from mariner.api.routes import meta
from mariner.api.schemas import Order
from mariner.audit.service import append
from mariner.db import models as m
from mariner.db.store import build_snapshot, rows
from mariner.engine.adapter import adapt, current_impacts, watches
from mariner.engine.service import create_run
from mariner.localization import localize

router = APIRouter(prefix='/api/trade-tariff', tags=['trade tariff bridge'])
Lang = Literal['zh', 'en']
STATUS = {'报价中': 'quoted', '已下单': 'confirmed', '已出货': 'shipped', '已完成': 'entered'}
BRIEF_FIELDS = ('order_id', 'product', 'hts10', 'incoterm', 'status', 'risk_level', 'tag',
                'profit_delta_usd', 'rate_baseline_user_pct', 'rate_new_pct', 'countdown', 'decision')


def bridge(request: Request, tenant=Depends(require_tenant)):
    if tenant.company_id is None:
        raise HTTPException(404, 'Company not found')
    return request.app.state.db_path, tenant, request.app.state.tariff_registry


Context = Annotated[tuple, Depends(bridge)]


def runtime_for(context, enable=False):
    _, tenant, registry = context
    if enable or registry.is_opened(tenant.workspace_id, tenant.company_id):
        return registry.get(tenant.workspace_id, tenant.company_id)
    return None


def customer(context, cid):
    path, tenant, _ = context
    with connection(path) as conn:
        row = conn.execute('SELECT * FROM customers WHERE id=? AND workspace_id=? AND company_id=?',
                           (cid, tenant.workspace_id, tenant.company_id)).fetchone()
    if row is None:
        raise HTTPException(404, 'Customer not found')
    return dict(row)


def trade_order(context, oid, writable=False):
    path, tenant, _ = context
    order = get_order(path, tenant.workspace_id, tenant.company_id, oid)
    if writable and order['status'] not in STATUS:
        raise HTTPException(409, '已取消的订单不能生成关税订单。')
    return order


def link_rows(context):
    path, tenant, _ = context
    with connection(path) as conn:
        result = conn.execute('''SELECT l.*, c.name AS customer_name, o.order_no FROM tariff_order_links l
            LEFT JOIN customers c ON c.id=l.customer_id AND c.workspace_id=l.workspace_id AND c.company_id=l.company_id
            LEFT JOIN orders o ON o.id=l.order_id AND o.workspace_id=l.workspace_id AND o.company_id=l.company_id
            WHERE l.workspace_id=? AND l.company_id=? ORDER BY l.id''', (tenant.workspace_id, tenant.company_id)).fetchall()
    return [dict(r) for r in result]


def impact_map(session, runtime, lang='zh'):
    run, items = current_impacts(session, runtime.settings)
    return {i.order_id: adapt(session, runtime.settings, i, run, lang) for i in items}


def brief(value):
    return {k: value[k] for k in BRIEF_FIELDS} if value else None


def stale(link, order):
    pos = link['item_position']
    return pos is None or pos >= len(order['items']) or order['items'][pos]['product_name'] != link['item_name']


def hts(session):
    return [{'hts10': key, 'desc': value.get('desc', ''), 'mfn_pct': value['mfn_pct']}
            for key, value in build_snapshot(session)['hts_profiles'].items()]


@router.get('/status')
def status(context: Context, lang: Lang = 'zh'):
    runtime = runtime_for(context)
    if runtime is None:
        return {'opened': False, 'meta': None}
    with runtime.factory.begin() as session:
        return {'opened': True, 'meta': meta(session, runtime.settings, runtime.llm)}


@router.get('/summary')
def summary(context: Context, lang: Lang = 'zh'):
    runtime = runtime_for(context)
    if runtime is None:
        return {'opened': False}
    links = {link['tariff_order_id']: link for link in link_rows(context)}
    with runtime.factory.begin() as session:
        values = impact_map(session, runtime, lang)
        urgent = [brief(v) for v in values.values() if v['risk_level'] in ('红', '橙') and v['decision'] == 'pending']
        urgent.sort(key=lambda v: (v['risk_level'] != '红', v['profit_delta_usd']))
        for v in urgent:
            link = links.get(v['order_id'], {})
            v.update(customer_id=link.get('customer_id'), customer_name=link.get('customer_name'))
        briefs = rows(session, m.Brief)
        latest = localize(max(briefs, key=lambda b: b.id).payload, 'brief', lang, session) if briefs else None
        return dict(opened=True, meta=meta(session, runtime.settings, runtime.llm),
                    brief={k: latest[k] for k in ('date', 'conclusion')} if latest else None,
                    urgent=urgent[:5], watch_count=len(watches(session, runtime.settings, lang)))


@router.get('/hts-options')
def hts_options(context: Context, lang: Lang = 'zh'):
    with runtime_for(context, True).factory.begin() as session:
        return hts(session)


@router.get('/links')
def links(context: Context, lang: Lang = 'zh'):
    return link_rows(context) if runtime_for(context) else []


class LinkInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    customer_id: int | None = Field(None, gt=0)


@router.put('/links/{tariff_order_id}')
def link_customer(tariff_order_id: str, body: LinkInput, context: Context, lang: Lang = 'zh'):
    target = customer(context, body.customer_id) if body.customer_id is not None else None
    path, tenant, _ = context
    runtime = runtime_for(context, True)
    existing = next((v for v in link_rows(context) if v['tariff_order_id'] == tariff_order_id), None)
    if existing and existing['order_id'] and existing['customer_id'] != body.customer_id:
        raise HTTPException(409, '该关税订单由订单生成，客户随订单确定。')
    with runtime.factory.begin() as session:
        if session.get(m.Order, tariff_order_id) is None:
            raise HTTPException(404, '关税订单不存在。')
        with connection(path) as conn:
            conn.execute('''INSERT INTO tariff_order_links(workspace_id,company_id,tariff_order_id,customer_id)
                VALUES (?,?,?,?) ON CONFLICT(workspace_id,company_id,tariff_order_id) DO UPDATE SET
                customer_id=excluded.customer_id, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')''',
                (tenant.workspace_id, tenant.company_id, tariff_order_id, body.customer_id))
        message = f"{tariff_order_id} · 关联客户：{target['name']}" if target else f'{tariff_order_id} · 取消关联客户'
        append(session, str(runtime.settings.today), 'TRADE_LINK_CHANGED', '本地用户', tariff_order_id, message)
    return next(v for v in link_rows(context) if v['tariff_order_id'] == tariff_order_id)


@router.get('/orders/{oid}/draft')
def draft(oid: int, context: Context, lang: Lang = 'zh'):
    order = trade_order(context, oid, True)
    runtime = runtime_for(context, True)
    links = [v for v in link_rows(context) if v['order_id'] == oid]
    result = []
    with runtime.factory.begin() as session:
        occupied = {v.id for v in rows(session, m.Order)}
        for pos, item in enumerate(order['items']):
            link = next((v for v in links if v['item_position'] == pos and not stale(v, order)), None)
            record = session.get(m.Order, link['tariff_order_id']) if link else None
            base = re.sub(r'[^A-Za-z0-9._-]', '', order['order_no']) or f'ST{oid}'
            base = base[:55] + (f'-{pos + 1}' if len(order['items']) > 1 else '')
            tid, n = base, 2
            while tid in occupied:
                tid, n = f'{base}-{n}', n + 1
            occupied.add(tid)
            values = {key: '' for key in Order.model_fields}
            values.update(order_id=tid, product=item['product_name'], origin='CN', channel='b2b', tariff_clause='none',
                          status=STATUS[order['status']], qty=item['quantity'] or '',
                          unit_price_usd=item['unit_price'] if order['currency'] == 'USD' and item['unit_price'] is not None else '',
                          transport_mode='ocean', quote_date=order['created_at'][:10],
                          delivery_date=order['delivery_date'] if re.fullmatch(r'\d{4}-\d{2}-\d{2}', order['delivery_date']) else '')
            for field in ('other_cost_cny_per_unit', 'intl_freight_usd', 'insurance_usd', 'us_side_cost_usd'):
                values[field] = '0'
            if record:
                values = record.payload
            result.append(dict(item_position=pos, product_name=item['product_name'], tariff_order_id=values['order_id'],
                               existing=record is not None, stale=False, values=values))
        for link in links:
            if stale(link, order):
                record = session.get(m.Order, link['tariff_order_id'])
                result.append(dict(item_position=link['item_position'], product_name=link['item_name'],
                                   tariff_order_id=link['tariff_order_id'], existing=True, stale=True,
                                   values=record.payload if record else {}))
        return dict(order=order, rows=result, hts_options=hts(session))


class ConvertRow(BaseModel):
    model_config = ConfigDict(extra='forbid')
    item_position: int = Field(ge=0)
    values: dict[str, str | int | float | None]


class ConvertInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    rows: list[ConvertRow] = Field(min_length=1, max_length=100)


@router.post('/orders/{oid}/convert')
def convert(oid: int, body: ConvertInput, context: Context, lang: Lang = 'zh'):
    order = trade_order(context, oid, True)
    positions = [r.item_position for r in body.rows]
    if len(positions) != len(set(positions)) or any(p >= len(order['items']) for p in positions):
        raise HTTPException(422, 'Invalid item positions')
    runtime = runtime_for(context, True)
    path, tenant, _ = context
    links = {v['tariff_order_id']: v for v in link_rows(context)}
    records, ids = [], set()
    imported = updated = 0
    # Serialize cross-database conversion within the runtime. Provenance makes a retry safe
    # even if the tariff commit succeeds and the main database write fails.
    with runtime.pipeline.lock:
        with runtime.factory.begin() as session:
            for row in body.rows:
                value = {k: '' if v is None else str(v) for k, v in row.values.items()}
                tid = value.get('order_id', '').strip()
                if not re.fullmatch(r'[A-Za-z0-9._-]{1,64}', tid) or tid in ids:
                    raise HTTPException(422, 'Invalid or duplicate tariff order ID')
                value.update(order_id=tid, origin='CN')
                ids.add(tid)
                existing = session.get(m.Order, tid)
                link = links.get(tid)
                owner = {'order_id': oid, 'item_position': row.item_position}
                if existing and not ((link and link['order_id'] == oid and link['item_position'] == row.item_position)
                                     or (not link and existing.payload.get('_trade_source') == owner)):
                    raise HTTPException(409, f'关税订单号 {tid} 已被占用。')
                records.append(value)
            try:
                parsed = parse_orders(csv_bytes(records), build_snapshot(session))
            except ApiException as exc:
                raise HTTPException(422, {'message': '关税订单未生成，请修正以下错误',
                    'errors': [{**e, 'row': e['row'] - 1} for e in (exc.details or [])]}) from exc
            for row, record in zip(body.rows, parsed):
                record['_trade_source'] = {'order_id': oid, 'item_position': row.item_position}
                existing = session.get(m.Order, record['order_id'])
                if existing:
                    existing.payload = record
                    updated += 1
                else:
                    session.add(m.Order(id=record['order_id'], business_date=str(runtime.settings.today), payload=record))
                    imported += 1
            append(session, str(runtime.settings.today), 'ORDERS_IMPORTED', '本地用户', f'trade-order:{oid}',
                   f"从订单 {order['order_no'] or '#' + str(oid)} 生成：导入 {imported} 行，更新 {updated} 行")
            session.flush()
            run = create_run(session, runtime.settings)
        try:
            with connection(path) as conn:
                for row, record in zip(body.rows, parsed):
                    conn.execute('''INSERT INTO tariff_order_links(workspace_id,company_id,tariff_order_id,customer_id,order_id,item_position,item_name)
                        VALUES (?,?,?,?,?,?,?) ON CONFLICT(workspace_id,company_id,tariff_order_id) DO UPDATE SET
                        customer_id=excluded.customer_id,order_id=excluded.order_id,item_position=excluded.item_position,
                        item_name=excluded.item_name,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')''',
                        (tenant.workspace_id, tenant.company_id, record['order_id'], order['customer_id'], oid,
                         row.item_position, order['items'][row.item_position]['product_name']))
        except Exception as exc:
            logging.getLogger(__name__).exception('Failed to persist trade order links')
            raise HTTPException(500, '关税订单已生成，但关联记录保存失败，请重试“生成关税订单”。') from exc
    return dict(imported=imported, updated=updated, run_id=run.id, tariff_order_ids=[v['order_id'] for v in parsed])


@router.post('/orders/{oid}/sync-status')
def sync_status(oid: int, context: Context, lang: Lang = 'zh'):
    order = trade_order(context, oid, True)
    runtime = runtime_for(context, True)
    changed = 0
    with runtime.pipeline.lock, runtime.factory.begin() as session:
        for link in link_rows(context):
            if link['order_id'] != oid:
                continue
            record = session.get(m.Order, link['tariff_order_id'])
            if record and record.payload['status'] != STATUS[order['status']]:
                record.payload = {**record.payload, 'status': STATUS[order['status']]}
                changed += 1
        run = None
        if changed:
            append(session, str(runtime.settings.today), 'ORDERS_IMPORTED', '本地用户', f'trade-order:{oid}',
                   f"从订单 {order['order_no'] or '#' + str(oid)} 同步状态：更新 {changed} 行")
            session.flush()
            run = create_run(session, runtime.settings)
        return dict(updated=changed, run_id=run.id if run else None)


@router.get('/orders/{oid}/impacts')
def order_impacts(oid: int, context: Context, lang: Lang = 'zh'):
    order = trade_order(context, oid)
    runtime = runtime_for(context)
    if runtime is None:
        return []
    with runtime.factory.begin() as session:
        values = impact_map(session, runtime, lang)
        return [dict(item_position=v['item_position'], item_name=v['item_name'], stale=stale(v, order),
                     tariff_order_id=v['tariff_order_id'], impact=brief(values.get(v['tariff_order_id'])))
                for v in link_rows(context) if v['order_id'] == oid]


@router.get('/customers/{cid}/impacts')
def customer_impacts(cid: int, context: Context, lang: Lang = 'zh'):
    customer(context, cid)
    runtime = runtime_for(context)
    if runtime is None:
        return []
    with runtime.factory.begin() as session:
        values = impact_map(session, runtime, lang)
        return [dict(tariff_order_id=v['tariff_order_id'], order_id=v['order_id'], order_no=v['order_no'],
                     impact=brief(values.get(v['tariff_order_id']))) for v in link_rows(context) if v['customer_id'] == cid]
