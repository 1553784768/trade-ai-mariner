from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile

from mariner.api import schemas as s
from mariner.api.errors import ApiException
from mariner.api.imports import parse_orders
from mariner.audit.service import append
from mariner.db import models as m
from mariner.db.store import build_snapshot, rows
from mariner.engine.adapter import adapt, current_impacts, watches
from mariner.engine.service import create_run
from mariner.settings import now

router = APIRouter(prefix="")


def runtime_dep(request: Request):
    return request.app.state.resolve_runtime(request)


def session_dep(runtime=Depends(runtime_dep)):
    with runtime.factory() as session:
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise


def settings_dep(runtime=Depends(runtime_dep)):
    return runtime.settings


def pipeline_dep(runtime=Depends(runtime_dep)):
    return runtime.pipeline


def llm_dep(runtime=Depends(runtime_dep)):
    return runtime.llm


def missing(resource, key):
    raise ApiException(404, "NOT_FOUND", f"未找到{resource}：{key}")


@router.get("/meta", response_model=s.Meta)
def meta(session=Depends(session_dep), settings=Depends(settings_dep), llm=Depends(llm_dep)):
    run, impacts = current_impacts(session, settings)
    values = [i.payload for i in impacts]
    counts = {key: sum(v["risk_level"] == risk for v in values) for key, risk in zip(("red", "orange", "yellow", "green"), "红橙黄绿")}
    counts.update(pending=sum(v["decision"] == "pending" for v in values),
                  urgent=sum(v["decision"] == "pending" and v["risk_level"] in ("红", "橙") for v in values),
                  drafts_pending=sum(d.payload["status"] == "draft" for d in rows(session, m.RuleDraft)),
                  decisions_total=len(rows(session, m.Decision)))
    processed = [v for v in values if v["decision"] != "pending" and v.get("decision_business_date") == str(settings.today)]
    today = {kind: sum(v["decision"] == kind for v in processed) for kind in ("adopted", "dismissed", "needs_detail")}
    today.update(processed=len(processed), total=len(processed) + counts["pending"])
    releases = rows(session, m.HtsRelease)
    return dict(product_name="Mariner AI", hts_release=releases[-1].payload["name"] if releases else "—",
                as_of=str(settings.today), llm_configured=llm.get() is not None,
                counts=counts, today=today, latest_run=run.payload)


@router.get("/orders", response_model=list[s.Order])
def orders(session=Depends(session_dep)):
    return [o.payload for o in rows(session, m.Order)]


@router.post("/orders/import", response_model=s.ImportResult)
def import_orders(file: UploadFile = File(...), session=Depends(session_dep), settings=Depends(settings_dep)):
    records = parse_orders(file.file.read(), build_snapshot(session))
    imported = updated = 0
    for record in records:
        existing = session.get(m.Order, record["order_id"])
        if existing:
            existing.payload = record
            updated += 1
        else:
            session.add(m.Order(id=record["order_id"], business_date=str(settings.today), payload=record))
            imported += 1
    append(session, str(settings.today), "ORDERS_IMPORTED", "本地用户", "orders", f"导入 {imported} 行，更新 {updated} 行")
    session.flush()
    run = create_run(session, settings)
    session.commit()
    return dict(imported=imported, updated=updated, run_id=run.id, errors=[])


@router.post("/runs", response_model=s.ImpactRun)
def new_run(session=Depends(session_dep), settings=Depends(settings_dep)):
    run = create_run(session, settings)
    session.commit()
    return run.payload


@router.get("/runs/latest", response_model=s.ImpactRun)
def get_run(session=Depends(session_dep), settings=Depends(settings_dep)):
    return current_impacts(session, settings)[0].payload


@router.get("/impacts", response_model=list[s.ImpactCard])
def impacts(lang: Literal["zh", "en"] = "zh", risk: str | None = None, incoterm_group: Literal["all", "ddp", "non_ddp"] = "all",
            decision: s.DecisionKind | None = None, q: str = "", session=Depends(session_dep), settings=Depends(settings_dep)):
    if risk and any(r not in "红橙黄绿" or len(r) != 1 for r in risk.split(",")):
        raise ApiException(400, "BAD_REQUEST", "请求参数不合法")
    run, items = current_impacts(session, settings)
    result = []
    for item in items:
        v = item.payload
        if risk and v["risk_level"] not in risk.split(","):
            continue
        if decision and v["decision"] != decision:
            continue
        if incoterm_group != "all" and (v["incoterm"] == "DDP") != (incoterm_group == "ddp"):
            continue
        if q and not any(q.lower() in v[k].lower() for k in ("order_id", "product", "hts10")):
            continue
        result.append(adapt(session, settings, item, run, lang))
    return result


@router.get("/impacts/{order_id}", response_model=s.ImpactDetail)
def detail(order_id: str, lang: Literal["zh", "en"] = "zh", session=Depends(session_dep), settings=Depends(settings_dep)):
    run, items = current_impacts(session, settings)
    item = next((i for i in items if i.order_id == order_id), None)
    if item is None:
        missing("订单", order_id)
    return adapt(session, settings, item, run, lang)


@router.post("/impacts/{order_id}/decision", response_model=s.Decision)
def decide(order_id: str, body: s.DecisionRequest, session=Depends(session_dep), settings=Depends(settings_dep)):
    run, items = current_impacts(session, settings)
    item = next((i for i in items if i.order_id == order_id), None)
    if item is None:
        missing("订单", order_id)
    if body.decision == "adopted":
        indices = body.action_indices
        if not indices or len(indices) != len(set(indices)) or any(i < 0 or i >= len(item.payload["actions"]) for i in indices):
            raise ApiException(400, "BAD_REQUEST", "请求参数不合法")
    elif body.action_indices is not None:
        raise ApiException(400, "BAD_REQUEST", "请求参数不合法")
    note = body.note.strip() if body.note else None
    if body.decision == "needs_detail" and not note:
        raise ApiException(400, "BAD_REQUEST", "请求参数不合法")
    adopted = [dict(index=i, text=item.payload["actions"][i]) for i in sorted(body.action_indices or [])]
    timestamp = now()
    item.payload = {**item.payload, "decision": body.decision, "decision_at": timestamp, "decision_business_date": str(settings.today), "adopted_actions": adopted, "note": note}
    label = {"adopted": "已采纳", "dismissed": "不处理", "needs_detail": "需补充"}[body.decision]
    summary = f"{order_id} · {label}" + (f" · 备注：{body.note}" if body.note else "")
    if body.decision == "adopted":
        summary = f"{order_id} · 已采纳 · 第 " + "、".join(f'{a["index"]+1:02}' for a in adopted) + " 条"
    elif body.decision == "needs_detail":
        summary = f"{order_id} · 需补充 · 补充：{note}"
    event = append(session, str(settings.today), "DECIDED", "本地用户", order_id, summary)
    value = dict(order_id=order_id, run_id=run.id, decision=body.decision, note=note, adopted_actions=adopted, decided_at=timestamp,
                 actor="本地用户", audit_hash=event["hash"], product=item.payload["product"], profit_delta_usd=item.payload["profit_delta_usd"])
    session.add(m.Decision(id=uuid4().hex, business_date=str(settings.today), payload=value))
    session.commit()
    return value


@router.get("/decisions", response_model=list[s.DecisionRow])
def decisions(limit: int = Query(20, ge=1, le=200), offset: int = Query(0, ge=0), lang: Literal["zh", "en"] = "zh", session=Depends(session_dep)):
    from mariner.localization import localize
    return [localize(r, "decision", lang, session) for r in sorted([r.payload for r in rows(session, m.Decision)], key=lambda r: r["decided_at"], reverse=True)[offset:offset+limit]]


@router.get("/audit", response_model=list[s.AuditEvent])
def audit(lang: Literal["zh", "en"] = "zh", limit: int = Query(50, ge=1, le=200), session=Depends(session_dep)):
    return [{**r.payload, "summary": r.payload.get("summary_en", r.payload["summary"]) if lang == "en" else r.payload["summary"]} for r in sorted(rows(session, m.AuditEvent), key=lambda r: r.seq, reverse=True)[:limit]]


@router.get("/rules/snapshot")
def snapshot(session=Depends(session_dep)):
    return build_snapshot(session)


@router.get("/watch-items", response_model=list[s.WatchItem])
def watch_items(lang: Literal["zh", "en"] = "zh", session=Depends(session_dep), settings=Depends(settings_dep)):
    return watches(session, settings, lang)
