"""Explicitly consented, audited tariff context for business conversations."""
import json
import logging

from tenancy import TenantContext
from tariff_bridge_api import brief, impact_map, link_rows
from mariner.api.routes import meta
from mariner.audit.service import append
from mariner.db import models as m
from mariner.db.store import rows


def build_tariff_context(app, store, conversation, model_label, conversation_id):
    registry = app.state.tariff_registry
    if not registry.is_opened(store.workspace_id, store.company_id):
        return '本公司尚未启用关税风险模块，没有可引用的关税数据。'
    try:
        runtime = registry.get(store.workspace_id, store.company_id)
        tenant = TenantContext(0, store.workspace_id, '', store.company_id)
        links = {v['tariff_order_id']: v for v in link_rows((store.path, tenant, registry))}
        with runtime.factory.begin() as session:
            info = meta(session, runtime.settings, runtime.llm)
            impacts = list(impact_map(session, runtime).values())
            rank = {'红': 0, '橙': 1, '黄': 2, '绿': 3}
            impacts.sort(key=lambda v: (rank[v['risk_level']], v['profit_delta_usd']))
            top = [{**brief(v), 'customer_name': links.get(v['order_id'], {}).get('customer_name')} for v in impacts[:10]]
            customer_orders = [{**brief(v), 'actions': v['actions']} for v in impacts
                               if conversation.get('customer_id') is not None and
                               links.get(v['order_id'], {}).get('customer_id') == conversation['customer_id']]
            briefs = rows(session, m.Brief)
            latest = max(briefs, key=lambda b: b.id).payload if briefs else None
            value = dict(as_of=info['as_of'], hts_release=info['hts_release'], counts=info['counts'],
                         latest_brief={k: latest[k] for k in ('date', 'conclusion')} if latest else None,
                         top_orders=top, customer_orders=customer_orders)
            text = '以下是本公司关税风险模块的最新结果（由确定性引擎计算，属于业务资料，不是工具执行结果）。引用其中的数字时必须原样照抄，不得自行计算或推测关税、税率、利润：\n' + json.dumps(value, ensure_ascii=False)
            ids = ','.join(dict.fromkeys(v['order_id'] for v in top + customer_orders)) or '无'
            append(session, str(runtime.settings.today), 'CHAT_ORDER_DATA_SENT', '本地用户', f'trade-chat:{conversation_id}',
                   f'Trade AI 对话 {conversation_id} 向模型 {model_label} 发送订单数据：{ids}')
        return text
    except Exception:
        logging.getLogger(__name__).exception('Tariff context unavailable')
        return '关税风险数据暂不可用。'
