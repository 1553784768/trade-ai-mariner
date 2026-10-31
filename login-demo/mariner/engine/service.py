from datetime import datetime
from uuid import uuid4
from zoneinfo import ZoneInfo

from mariner.audit.service import append
from mariner.db.models import Impact, ImpactRun, Order
from mariner.db.store import build_snapshot, rows
from mariner.engine.core import evaluate
from mariner.settings import now


def identifier(prefix):
    return f"{prefix}-{datetime.now(ZoneInfo('Asia/Shanghai')):%Y%m%d-%H%M%S}-{uuid4().hex[:4]}"


def carry_over_decisions(previous, current):
    if previous and abs(previous["profit_delta_usd"] - current["profit_delta_usd"]) <= 0.01 \
            and previous["risk_level"] == current["risk_level"]:
        if previous.get("decision") == "adopted" and not all(
            a["text"] in current["actions"] for a in previous.get("adopted_actions", [])
        ):
            return "pending"
        return previous.get("decision", "pending")
    return "pending"


def latest_run(session, settings):
    candidates = [r for r in rows(session, ImpactRun) if r.business_date == str(settings.today)]
    return max(candidates, key=lambda r: r.payload["created_at"]) if candidates else create_run(session, settings)


def create_run(session, settings):
    existing = rows(session, ImpactRun)
    previous = max(existing, key=lambda r: r.payload["created_at"]) if existing else None
    old = {i.order_id: i.payload for i in rows(session, Impact) if previous and i.run_id == previous.id}
    snapshot, run_id, timestamp = build_snapshot(session), identifier("RUN"), now()
    values = []
    for order in rows(session, Order):
        value = evaluate(order.payload, snapshot, settings.today, None)
        value["decision"] = carry_over_decisions(old.get(order.id), value)
        value["decision_at"] = old.get(order.id, {}).get("decision_at") if value["decision"] != "pending" else None
        value["decision_business_date"] = old.get(order.id, {}).get("decision_business_date") if value["decision"] != "pending" else None
        value["order_input"] = order.payload
        value["adopted_actions"] = old.get(order.id, {}).get("adopted_actions", []) if value["decision"] == "adopted" else []
        value["note"] = old.get(order.id, {}).get("note") if value["decision"] != "pending" else None
        session.add(Impact(id=f"{run_id}:{order.id}", run_id=run_id, order_id=order.id,
                           business_date=str(settings.today), payload=value))
        values.append(value)
    payload = dict(id=run_id, as_of=str(settings.today), created_at=timestamp, order_count=len(values),
                   total_profit_delta_usd=round(sum(v["profit_delta_usd"] for v in values), 2),
                   total_potential_refund_usd=round(sum(v["potential_refund_usd"] for v in values), 2))
    run = ImpactRun(id=run_id, business_date=str(settings.today), payload=payload)
    session.add(run)
    append(session, str(settings.today), "RUN_CREATED", "系统", run_id,
           f"批次 {run_id} · as_of {settings.today}")
    session.flush()
    from mariner.knowledge.service import sync_kb
    sync_kb(session, settings)
    return run
