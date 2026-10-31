from datetime import date, timedelta

from mariner.collectors.service import lookup_hts
from mariner.engine.adapter import digits
from mariner.engine.changes import preview

PROGRAM_FIELDS = {"id", "name", "heading", "rate_pct", "origins", "valid_from", "valid_to", "applies_to_232_goods", "status", "refund_status", "sources"}


def fields(value, prefix="change.payload"):
    result = {}
    for key, item in value.items():
        path = prefix + "." + key
        result[path] = item
        if isinstance(item, dict):
            result.update(fields(item, path))
    return result


def validate(draft, source, published, snapshot, settings, impacts):
    change = draft["change"]
    payload = change["payload"]
    flat = fields(payload)
    checks = {f"V{i}": {"check": f"V{i}", "status": "n/a", "message": "不适用"} for i in range(1, 10)}
    def set_check(key, status, message=None):
        checks[key] = dict(check=key, status=status, message=message or {"pass": "通过", "warn": "注意", "fail": "不通过", "n/a": "不适用"}[status])
    evidence = [{**e, "verified": e["quote"] in source} for e in draft["evidence"]]
    set_check("V1", "pass" if evidence and all(e["verified"] for e in evidence) else "fail")
    required = {path for path, v in flat.items() if v is not None and path.split(".")[-1] in ("rate_pct", "valid_from", "valid_to", "heading", "in_transit_exception")}
    if change["target_id"] is not None:
        required.add("change.target_id")
    if required:
        set_check("V2", "pass" if required <= {e["field"] for e in evidence} else "fail")
    if change["change_type"] == "watch_item_upsert" and not (change["target_id"] or "").strip():
        set_check("V2", "fail")
    starts = [v for k, v in flat.items() if k.endswith(".valid_from") and v]
    transits = [v for k, v in flat.items() if k.endswith(".in_transit_exception") and v]
    if starts or transits:
        try:
            invalid = any(date.fromisoformat(t["loaded_before"]) > date.fromisoformat(t["entered_before"]) for t in transits)
            retroactive = any(date.fromisoformat(v) < date.fromisoformat(published) - timedelta(days=30) for v in starts)
            set_check("V3", "fail" if invalid else "warn" if retroactive else "pass")
        except (ValueError, KeyError, TypeError):
            set_check("V3", "fail")
    rates = [v for k, v in flat.items() if k.endswith(".rate_pct") and v is not None]
    if rates:
        set_check("V4", "pass" if all(isinstance(v, (float, int)) and 0 <= v <= 200 for v in rates) else "fail")
    headings = [v for k, v in flat.items() if k.endswith(".heading") and v]
    for key, codes in (("V5", headings), ("V6", [change["target_id"]] if change["change_type"] == "hts_profile_update" and change["target_id"] else [])):
        if codes:
            results = [lookup_hts(code, settings) for code in codes]
            if any(r is None for r in results):
                set_check(key, "warn", "无夹具，未核验")
            else:
                hit = all(any(digits(row.get("htsno")) == digits(code) for row in result) for code, result in zip(codes, results))
                set_check(key, "pass" if hit else "warn")
    if change["change_type"] in ("program_add", "program_update"):
        current = next((p for p in snapshot["programs"] if p["id"] == change["target_id"]), None)
        conflict = False
        if current and "rate_pct" in payload:
            start = payload.get("valid_from") or current.get("valid_from") or "0001"
            end = payload.get("valid_to") or "9999"
            overlap = start <= (current.get("valid_to") or "9999") and (current.get("valid_from") or "0001") <= end
            conflict = overlap and payload["rate_pct"] != current["rate_pct"]
        set_check("V7", "warn" if conflict else "pass")
    if change["change_type"] == "program_add":
        valid = (PROGRAM_FIELDS <= payload.keys() and payload.get("id") == change["target_id"]
                 and bool(payload.get("id")) and not any(p["id"] == payload.get("id") for p in snapshot["programs"]))
        set_check("V8", "pass" if valid else "fail")
    if change["change_type"] == "hts_profile_update" and "s301_exclusion" in payload and any(digits(k) == digits(change["target_id"]) for k in snapshot["hts_profiles"]):
        set_check("V9", "pass" if payload["s301_exclusion"] and payload["s301_exclusion"].get("valid_to") else "fail")
    highlights = []
    for e in evidence:
        start = source.find(e["quote"])
        if start >= 0:
            highlights.append(dict(start=start, end=start+len(e["quote"]), field=e["field"]))
    result = {**draft, "evidence": evidence, "validation": list(checks.values()), "source_text": source, "highlights": highlights, "impact_preview": None}
    if not any(c["status"] == "fail" for c in checks.values()):
        result["impact_preview"] = preview(snapshot, result, published, impacts, settings.today)
    return result
