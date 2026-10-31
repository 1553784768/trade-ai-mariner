#!/usr/bin/env python3
"""
Tariff-impact recalculation engine (hackathon prototype).

Deterministic by design: every number here comes from rules.json + orders CSV.
An LLM may write explanations around these numbers, but never computes them.

Usage:
  python3 engine.py                       # as of 2026-10-31, no scenario
  python3 engine.py --scenario S1         # add a hypothetical layer
  python3 engine.py --as-of 2026-07-01    # replay: only rules published by that date
"""
from datetime import date, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
SELLER_PAYS_FREIGHT = {"CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"}
SELLER_PAYS_US_SIDE = {"DAP", "DPU", "DDP"}

SCENARIOS = {
    "S1": {
        "id": "S1_HYPO_EXCESS_CAP_BATTERY",
        "label": "假设情景：301 产能过剩调查对华电池再加征 25%（非已公布政策）",
        "rate_pct": 25.0,
        "hts_prefixes": ["8507.60"],
        "valid_from": "2026-11-15",
    }
}


def d(s):
    return date.fromisoformat(s) if s else None


def in_window(x, start, end):
    return (start is None or x >= start) and (end is None or x <= end)


# ---------------------------------------------------------------- layers
def s301_list_rate(profile, entry):
    """China Section 301 list rate at entry date, honouring exclusions."""
    rate, heading = 0.0, None
    for seg in profile.get("s301_list", []):
        if in_window(entry, d(seg["from"]), d(seg.get("to"))):
            rate, heading = seg["rate_pct"], seg["heading"]
    excl = profile.get("s301_exclusion")
    if excl and rate > 0 and entry <= d(excl["valid_to"]):
        return 0.0, f'{excl["heading"]} (exclusion, through {excl["valid_to"]})'
    return rate, heading


def layers_for(order, profile, rules, entry, load, as_of, scenario=None, include_struck=True):
    out, flags = [], []
    out.append({"id": "MFN", "rate": profile["mfn_pct"], "heading": order["hts10"]})
    r, h = s301_list_rate(profile, entry)
    if r:
        out.append({"id": "SEC301_LIST_CN", "rate": r, "heading": h})
    for p in rules["programs"]:
        if p.get("published") and d(p["published"]) > as_of:
            continue  # replay mode: rule not yet known
        if "*" not in p["origins"] and order["origin"] not in p["origins"]:
            continue
        if not in_window(entry, d(p["valid_from"]), d(p.get("valid_to"))):
            continue
        if not include_struck and p.get("refund_status") == "struck_down":
            continue
        if profile.get("s232"):
            if p.get("applies_to_232_goods") is None:
                flags.append(f'{p["id"]} 与 232 叠加关系未建模，需人工复核')
                continue
            if p["applies_to_232_goods"] is False:
                continue
        ex_flag = p.get("product_exemption_flag")
        if ex_flag and profile.get(ex_flag):
            continue
        it = p.get("in_transit_exception")
        if it and load and load < d(it["loaded_before"]) and entry < d(it["entered_before"]):
            flags.append(f'{p["id"]} 适用在途豁免 {it["heading"]}（装船<{it["loaded_before"]} 且入境<{it["entered_before"]}）')
            continue
        out.append({"id": p["id"], "rate": p["rate_pct"], "heading": p["heading"],
                    "refund_status": p.get("refund_status")})
    if scenario and any(order["hts10"].startswith(x) for x in scenario["hts_prefixes"]) \
            and entry >= d(scenario["valid_from"]):
        out.append({"id": scenario["id"], "rate": scenario["rate_pct"], "heading": "HYPOTHETICAL"})
    for k, v in profile.items():
        if k.endswith("_verified") and v is False:
            flags.append(f"规则库字段 {k}=false（示例假设，需核对第99章原文）")
    return out, flags


def total_rate(layers):
    return round(sum(l["rate"] for l in layers), 4)


def fees(rules, value, entry, mode, flags=None):
    f = rules["fees"]
    mpf = 0.0
    if value > f["formal_entry_threshold_usd"]:
        for seg in f["MPF"]:
            if in_window(entry, d(seg["valid_from"]), d(seg.get("valid_to"))):
                mpf = min(max(value * seg["rate_pct"] / 100, seg["min_usd"]), seg["max_usd"])
                if flags is not None and not seg.get("verified", True):
                    flags.append(f'MPF 上下限取自单一来源（{seg["valid_from"]} 起），需核对 CBP 公告')
    hmf = value * f["HMF"]["rate_pct"] / 100 if mode in f["HMF"]["modes"] else 0.0
    return round(mpf, 2), round(hmf, 2)


# ---------------------------------------------------------------- money
def seller_profit(o, duty_and_fees_borne):
    q, fx = float(o["qty"]), float(o["fx_cny_per_usd"])
    revenue = q * float(o["unit_price_usd"])
    cost = q * (float(o["purchase_cost_cny_per_unit"]) + float(o["other_cost_cny_per_unit"])) / fx
    inc = o["incoterm"].upper()
    if inc in SELLER_PAYS_FREIGHT:
        cost += float(o["intl_freight_usd"]) + float(o["insurance_usd"])
    if inc in SELLER_PAYS_US_SIDE:
        cost += float(o["us_side_cost_usd"])
    cost += duty_and_fees_borne
    return revenue, cost, revenue - cost


def clause_share(o):
    c = o["tariff_clause"]
    return float(c.split(":")[1]) if c.startswith("share:") else 0.0


# ---------------------------------------------------------------- per order
def evaluate(o, rules, as_of, scenario):
    profile = rules["hts_profiles"][o["hts10"]]
    cv = float(o["customs_value_usd"])
    entry, load, quote = d(o["entry_date"]), d(o["load_date"]), d(o["quote_date"])
    mode, inc = o["transport_mode"], o["incoterm"].upper()
    entered = o["status"] == "entered"

    new_layers, flags = layers_for(o, profile, rules, entry, load, as_of, scenario)
    rate_new = total_rate(new_layers)
    rule_base_layers, _ = layers_for(o, profile, rules, quote, quote, quote, None)
    rate_rule_base = total_rate(rule_base_layers)
    rate_user_base = float(o["baseline_duty_rate_pct"])

    mpf, hmf = fees(rules, cv, entry, mode, flags)  # same fee table for both sides -> isolates tariff effect
    duty_base, duty_new = cv * rate_user_base / 100, cv * rate_new / 100
    duty_delta = duty_new - duty_base

    if inc == "DDP":
        borne_base, borne_new = duty_base + mpf + hmf, duty_new + mpf + hmf
    else:
        borne_base = 0.0
        borne_new = clause_share(o) * max(0.0, duty_delta)
    rev, cost_b, prof_b = seller_profit(o, borne_base)
    _, cost_n, prof_n = seller_profit(o, borne_new)
    m_b, m_n = prof_b / rev * 100, prof_n / rev * 100

    buyer_landed_pct = None
    if inc != "DDP":
        buyer_base = cv + duty_base + mpf + hmf
        buyer_landed_pct = (duty_delta - clause_share(o) * max(0.0, duty_delta)) / buyer_base * 100

    # refunds on entries already made
    refund = []
    if entered:
        for l in new_layers:
            if l.get("refund_status") in ("struck_down", "challenged_pending_appeal"):
                refund.append((l["id"], round(cv * l["rate"] / 100, 2), l["refund_status"]))

    # applicable watch items
    watches = [(w, rules["watch_items"][w]) for w in profile.get("watch", [])]
    # entry-date sensitivity: would an earlier entry inside [as_of, entry] be cheaper?
    timing = None
    if not entered:
        bounds = set()
        for p in rules["programs"]:
            if p.get("published") and d(p["published"]) > as_of:
                continue
            for k in ("valid_from", "valid_to"):
                if p.get(k):
                    bounds.add(d(p[k]) - timedelta(days=1) if k == "valid_from" else d(p[k]))
        if profile.get("s301_exclusion"):
            bounds.add(d(profile["s301_exclusion"]["valid_to"]))
        for b in sorted(x for x in bounds if as_of <= x < entry):
            alt, _ = layers_for(o, profile, rules, b, min(load, b), as_of, scenario)
            if total_rate(alt) < rate_new:
                timing = (b, total_rate(alt), cv * (rate_new - total_rate(alt)) / 100)

    # risk level
    reasons, level = [], "绿"
    dm = m_n - m_b
    if m_n < 0 or dm <= -10:
        level = "红"
        reasons.append("重算后亏损" if m_n < 0 else f"毛利率下降 {dm:.1f}pp")
    elif m_n < float(o["target_margin_pct"]) and dm < 0 or dm <= -5 or (buyer_landed_pct or 0) >= 10:
        level = "橙"
        if m_n < float(o["target_margin_pct"]) and dm < 0:
            reasons.append(f"毛利率 {m_n:.1f}% 低于目标 {o['target_margin_pct']}%")
        if dm <= -5:
            reasons.append(f"毛利率下降 {dm:.1f}pp")
        if (buyer_landed_pct or 0) >= 10:
            reasons.append(f"客户到岸成本 +{buyer_landed_pct:.1f}%")
    else:
        if watches and not entered:
            level = "黄"
            reasons += [f"观察项：{w['title']}（确定性 {w['certainty']}）" for _, w in watches]
        if -5 < dm <= -2 or (buyer_landed_pct or 0) >= 3:
            level = "黄"
            reasons.append(f"毛利率 {dm:+.1f}pp / 客户到岸成本 {buyer_landed_pct or 0:+.1f}%")
    if abs(rate_user_base - rate_rule_base) >= 1:
        level = "黄" if level == "绿" else level
        reasons.append(f"填写的当时税率 {rate_user_base}% 与规则库按报价日推算的 {rate_rule_base}% 不一致，先核对基准")
    tag = "利好" if prof_n - prof_b > 0.5 or refund else ""

    # actions (templates filled with computed numbers; LLM only rephrases)
    acts = []
    channel = o.get("channel", "b2b")
    if timing:
        b, r_alt, saving = timing
        head = (f"入境日若能在 {b} 或之前，税率 {r_alt:.1f}%（当前预计 {rate_new:.1f}%），可少缴约 ${saving:,.0f}；"
                f"当前预计入境 {entry}，晚 {(entry - b).days} 天。")
        if o["status"] == "shipped":
            acts.append(head + "货已装船，入境时间基本由到港时间决定，提前空间很小；不要指望保税仓（按出仓日税率计）")
        else:
            acts.append(head + "尚未装船：评估提前装船、改空运或改港的成本是否低于可省关税")
    for wid, w in watches:
        if w["legal_status"] == "scheduled_expiry":
            acts.append(f"盯 USTR 是否在 {w['next_milestone']} 前发布延期公告（上一次是 2025-11 延期）；未延期则按上面的数字执行")
        else:
            acts.append(f"观察：{w['title']} — 当前无税率变化，不改报价；准备备用报价和合同关税条款")
    if prof_n < prof_b - 0.5 and o["status"] in ("quoted", "confirmed", "shipped"):
        q = float(o["qty"])
        req = cost_n / (1 - m_b / 100) / q
        if inc == "DDP" and channel == "ecom":
            acts.append(f"维持原毛利率 {m_b:.1f}% 需售价 ≥ ${req:,.2f}（原 ${float(o['unit_price_usd']):,.2f}）；"
                        f"结合竞品价格决定是调价还是吸收")
        elif inc == "DDP" and o["status"] == "shipped":
            acts.append(f"维持原毛利率 {m_b:.1f}% 需单价 ≥ ${req:,.2f}（原 ${float(o['unit_price_usd']):,.2f}）；"
                        f"货已发出，只能与客户协商分摊；后续新单改 DAP/FOB 或加关税调整条款")
        elif inc == "DDP":
            acts.append(f"维持原毛利率 {m_b:.1f}% 需单价 ≥ ${req:,.2f}（原 ${float(o['unit_price_usd']):,.2f}）；"
                        f"或在发货前与客户改为 DAP/FOB（买方做进口商）")
        elif clause_share(o):
            acts.append(f"按合同关税分担条款，我方承担增量的 {clause_share(o):.0%}：约 ${borne_new:,.0f}；向客户发正式通知并附法规原文")
    if inc != "DDP" and duty_delta > 0:
        acts.append(f"客户（进口商）关税增加约 ${duty_delta:,.0f}，到岸成本 {buyer_landed_pct:+.1f}%；提前沟通，防止压价或取消")
    if prof_n > prof_b + 0.5 and not entered:
        acts.append(f"关税下降，利润增加约 ${prof_n - prof_b:,.0f}；可留作价格竞争空间或维持报价")
    for pid, amt, st in refund:
        if st == "struck_down":
            acts.append(f"该票已缴 {pid} 约 ${amt:,.0f}，属已被判无效的关税：由登记进口商通过 CBP CAPE 申报退款；先核对 7501 与清算状态")
        else:
            acts.append(f"该票已缴 {pid} 约 ${amt:,.0f}，合法性仍在上诉中：先保留单证，暂不计入利润")
    if entered and abs(rate_user_base - rate_new) >= 1:
        acts.append(f"规则推算应缴 {rate_new:.1f}%，与当时预估 {rate_user_base:.1f}% 不同：核对报关单实际申报的第99章税号")
    if any("规则库字段" in f for f in flags):
        acts.append("税号/301清单/豁免归属含示例假设：上线前请报关行核对")

    return {
        "order_id": o["order_id"], "product": o["product"], "hts10": o["hts10"], "incoterm": inc,
        "status": o["status"], "entry_date": o["entry_date"],
        "rate_baseline_user_pct": rate_user_base, "rate_baseline_rules_pct": rate_rule_base,
        "rate_new_pct": rate_new,
        "layers_new": " + ".join(f'{l["id"]} {l["rate"]}%' for l in new_layers),
        "duty_baseline_usd": round(duty_base, 2), "duty_new_usd": round(duty_new, 2),
        "duty_delta_usd": round(duty_delta, 2), "mpf_usd": mpf, "hmf_usd": hmf,
        "seller_profit_baseline_usd": round(prof_b, 2), "seller_profit_new_usd": round(prof_n, 2),
        "profit_delta_usd": round(prof_n - prof_b, 2),
        "margin_baseline_pct": round(m_b, 2), "margin_new_pct": round(m_n, 2),
        "buyer_landed_cost_change_pct": None if buyer_landed_pct is None else round(buyer_landed_pct, 2),
        "potential_refund_usd": round(sum(a for _, a, s in refund if s == "struck_down"), 2),
        "risk_level": level, "tag": tag, "risk_reasons": "；".join(reasons),
        "actions": acts, "flags": flags,
        "layers": [{**layer, "refund_status": layer.get("refund_status"),
                    "duty_usd": round(cv * layer["rate"] / 100, 2)} for layer in new_layers],
        "revenue_usd": round(rev, 2),
        "seller_cost_baseline_usd": round(cost_b, 2), "seller_cost_new_usd": round(cost_n, 2),
        "timing_boundary_date": str(timing[0]) if timing else None,
        "timing_saving_usd": round(timing[2], 2) if timing else None,
        "watch_ids": profile.get("watch", []),
    }

