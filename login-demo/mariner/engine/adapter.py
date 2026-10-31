import re
from datetime import date

from mariner.db.models import Impact, RuleDraft, PipelineRun
from mariner.db.store import build_snapshot, rows
from mariner.engine.service import latest_run

WATCH_TEXT = {
    "W_301_EXCLUSION_EXPIRY": ("178 项中国 301 排除 11-09 到期", "排除覆盖美东时间 2026-11-09 23:59 前入境的货物；截至 2026-10-31 未见延期公告。"),
    "W_232_ROBOTICS": ("机器人与工业机械 232 公告", "2026-10-28 签署，启动谈判；暂无税率、税号清单和生效日，首次进展报告约 2027-04-26。"),
    "W_301_EXCESS_CAPACITY": ("301 产能过剩调查（中国：钢、铝、电池、光伏、半导体、汽车）", "2026-03-11 立案，尚无最终措施。"),
}
LAYER_LABELS = {"MFN": "普通税率", "SEC301_LIST_CN": "301 清单", "SEC301_FORCED_LABOR_CN": "301 强迫劳动",
                "SEC122_GLOBAL": "122 临时附加", "IEEPA_FENTANYL_CN": "IEEPA 芬太尼", "IEEPA_RECIPROCAL_CN": "IEEPA 对等"}


def digits(value):
    return re.sub(r"\D", "", value or "")


def current_impacts(session, settings):
    run = latest_run(session, settings)
    items = [i for i in rows(session, Impact) if i.run_id == run.id]
    items.sort(key=lambda i: (i.payload["status"] == "entered",
                             -date.fromisoformat(i.payload["entry_date"]).toordinal() if i.payload["status"] == "entered"
                             else date.fromisoformat(i.payload["entry_date"]).toordinal(), i.order_id))
    return run, items


def adapt(session, settings, impact, run, lang="zh"):
    v, snapshot = dict(impact.payload), build_snapshot(session)
    order = v.pop("order_input")
    programs = {p["id"]: p for p in snapshot["programs"]}
    used = [programs[layer["id"]] for layer in v["layers"] if layer["id"] in programs]
    draft_matches = [r.payload["source_document_number"] for r in rows(session, RuleDraft)
                     if r.payload["status"] in ("draft", "needs_detail") and
                     (r.payload["change"]["target_id"] in [p["id"] for p in used] or
                      digits(r.payload["change"]["target_id"]) == digits(order["hts10"]))]
    unverified = sum(f.startswith("规则库字段") for f in v["flags"])
    mismatch = abs(v["rate_baseline_user_pct"] - v["rate_baseline_rules_pct"]) >= 1
    checks = [dict(key="rules_confirmed", status="warn" if draft_matches else "pass", value=", ".join(draft_matches) or None),
              dict(key="evidence", status="pass" if all(p.get("sources") for p in used) else "fail", value=None),
              dict(key="hts_exists", status="pass", value=None),
              dict(key="baseline_match", status="warn" if mismatch else "pass",
                   value=f'{v["rate_baseline_user_pct"]:.1f}% / {v["rate_baseline_rules_pct"]:.1f}%' if mismatch else None),
              dict(key="unverified_fields", status="warn" if unverified else "pass", value=str(unverified) if unverified else None)]
    boundary = v["timing_boundary_date"]
    countdown = (dict(kind="entered", days=None) if v["status"] == "entered" else
                 dict(kind="rule_boundary" if boundary else "entry",
                      days=(date.fromisoformat(boundary or v["entry_date"]) - settings.today).days))
    decision = v["decision"]
    chain = [dict(key="rules", state="warn" if draft_matches or unverified else "done"),
             dict(key="calc", state="done"), dict(key="human", state=decision if decision in ("pending", "needs_detail") else "done")]
    sources = [dict(rule_id=p["id"], title=p["name"], url=url) for p in used for url in p["sources"]]
    for wid in v["watch_ids"]:
        w = snapshot["watch_items"][wid]
        sources += [dict(rule_id=wid, title=WATCH_TEXT.get(wid, (w["title"],))[0], url=url) for url in w["sources"]]
    pipelines = rows(session, PipelineRun)
    pipe = max(pipelines, key=lambda p: p.payload["started_at"]).payload if pipelines else None
    steps = {s["agent"]: s for s in pipe["steps"]} if pipe else {}
    agent_chain = []
    for agent in ("collector", "triage", "extract"):
        candidates = [s for key, s in steps.items() if key.startswith("collector_")] if agent == "collector" else [steps[agent]] if agent in steps else []
        state = "not_run"
        if candidates:
            states = {s["status"] for s in candidates}
            state = "failed" if "failed" in states else "skipped" if "skipped_no_fixture" in states else "done" if states == {"succeeded"} else "pending"
        agent_chain.append(dict(agent=agent, status=state, at=max((s["finished_at"] for s in candidates if s["finished_at"]), default=None)))
    agent_chain += [dict(agent="impact", status="done", at=run.payload["created_at"]),
                    dict(agent="human", status="pending" if decision == "pending" else "done", at=v.get("decision_at"))]
    result = {**v, "run_id": run.id, "as_of": run.payload["as_of"],
            "seller_cost_delta_usd": round(v["seller_cost_new_usd"] - v["seller_cost_baseline_usd"], 2),
            "margin_delta_pp": round(v["margin_new_pct"] - v["margin_baseline_pct"], 2),
            "adopted_actions": v.get("adopted_actions", []), "note": v.get("note"),
            "channel": order["channel"], "importer_of_record": order["importer_of_record"],
            "layers": [dict(id=layer["id"], label=LAYER_LABELS.get(layer["id"], programs.get(layer["id"], {}).get("name", layer["id"])),
                            heading=layer["heading"], rate_pct=layer["rate"], duty_usd=layer["duty_usd"], refund_status=layer.get("refund_status")) for layer in v["layers"]],
            "checks": checks, "countdown": countdown, "chain": chain, "agent_chain": agent_chain, "sources": sources,
            "order": {k: order[k] for k in ("load_date", "quote_date", "customs_value_usd", "transport_mode", "tariff_clause")}}
    from mariner.engine.i18n import impact_text
    return impact_text(result, lang, session, snapshot)


def watches(session, settings, lang="zh"):
    _, impacts = current_impacts(session, settings)
    result = []
    rank = {"红": 0, "橙": 1, "黄": 2, "绿": 3}
    for wid, w in build_snapshot(session)["watch_items"].items():
        affected = [i.payload for i in impacts if wid in i.payload["watch_ids"]]
        from mariner.engine.i18n import watch_text
        title, summary = watch_text(session, wid, w, lang)
        result.append({**w, "id": wid, "title": title, "summary": summary,
                       "affected_order_ids": [i["order_id"] for i in affected],
                       "impact_usd": round(sum(i["profit_delta_usd"] for i in affected), 2) if w["legal_status"] in ("scheduled_expiry", "in_force", "signed_pending") else None,
                       "severity": min((i["risk_level"] for i in affected), key=rank.get, default="黄")})
    return sorted(result, key=lambda w: (rank[w["severity"]], w["next_milestone"] or "9999", w["id"]))
