from copy import deepcopy

from mariner.db.models import RuleVersion
from mariner.db.store import rows
from mariner.engine.adapter import digits
from mariner.engine.core import evaluate


def merge(base, patch):
    result = deepcopy(base)
    for key, value in patch.items():
        result[key] = merge(result.get(key, {}), value) if isinstance(value, dict) else deepcopy(value)
    return result


def apply_change(snapshot, change, published, legal_status, title, summary):
    result, changes = deepcopy(snapshot), []
    kind, target, payload = change["change_type"], change["target_id"], deepcopy(change["payload"])
    outcome = "无税率变化"
    if kind in ("program_add", "program_update"):
        existing = next((p for p in result["programs"] if p["id"] == target), None)
        if kind == "program_add":
            if existing or not target or payload.get("id") != target:
                raise ValueError("Invalid or duplicate program id")
            value = {**payload, "published": published}
            result["programs"].append(value)
        else:
            if existing is None:
                raise ValueError("Unknown target program")
            value = merge(existing, payload)
            value["published"] = existing.get("published")
            result["programs"] = [value if p["id"] == target else p for p in result["programs"]]
        changes.append(("program", value["id"], value))
        outcome = "新建规则版本"
    elif kind == "hts_profile_update":
        target = next((key for key in result["hts_profiles"] if digits(key) == digits(target)), None)
        if target is None:
            outcome = "不影响现有订单（规则库无此税号）"
        else:
            value = merge(result["hts_profiles"][target], payload)
            result["hts_profiles"][target] = value
            changes.append(("hts_profile", target, value))
            outcome = "新建规则版本"
    elif kind == "watch_item_upsert":
        if not target or not target.strip():
            raise ValueError("Missing watch item id")
        targets = payload.pop("hts_targets", [])
        certainty = {"in_force": 1., "court_ruling": 1., "procedural": 1., "signed_pending": .9,
                     "scheduled_expiry": .9, "proposed": .4, "investigation": .2, "negotiation_no_tariff": .1}[legal_status]
        value = merge(result["watch_items"].get(target, {}), payload)
        value.update(title=title, summary=summary, certainty=certainty, legal_status=legal_status)
        result["watch_items"][target] = value
        changes.append(("watch_item", target, value))
        for key, profile in result["hts_profiles"].items():
            if digits(key) in [digits(t) for t in targets]:
                profile["watch"] = list(dict.fromkeys([*profile.get("watch", []), target]))
                changes.append(("hts_profile", key, profile))
        outcome = "更新观察项"
    return result, changes, outcome


def store_changes(session, changes, draft, today):
    for kind, key, payload in changes:
        existing = [v for v in rows(session, RuleVersion) if v.rule_kind == kind and v.rule_id == key]
        version = max((v.version for v in existing), default=0) + 1
        for v in existing:
            if v.status == "active":
                v.status = "superseded"
        session.add(RuleVersion(rule_kind=kind, rule_id=key, version=version, status="active", source=f'draft:{draft["id"]}',
                                business_date=today, payload=payload, change_type=draft["change"]["change_type"]))
    session.flush()


def preview(snapshot, draft, published, impacts, today):
    new, _, _ = apply_change(snapshot, draft["change"], published, draft["legal_status"], draft["title"], draft["summary_zh"])
    deltas = [evaluate(i.payload["order_input"], new, today, None)["profit_delta_usd"] - i.payload["profit_delta_usd"] for i in impacts]
    return dict(orders_affected=sum(abs(v) > .01 for v in deltas), profit_delta_usd=round(sum(deltas), 2))


def brief_totals(impacts):
    values = [i.payload for i in impacts]
    counts = {key: sum(v["risk_level"] == risk for v in values) for key, risk in zip(("red", "orange", "yellow", "green"), "红橙黄绿")}
    pending = [v for v in values if v["decision"] == "pending" and v["risk_level"] == "红"]
    amount = round(sum(v["profit_delta_usd"] for v in pending), 2)
    money = f'{"−" if amount < 0 else "+"}${abs(amount):,.2f}'
    return {**counts, "total": len(values), "profit_delta_usd": round(sum(v["profit_delta_usd"] for v in values), 2),
            "refund_usd": round(sum(v["potential_refund_usd"] for v in values), 2)}, len(pending), money
