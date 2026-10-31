"""System knowledge is a read model; manual edits never modify engine inputs."""
import re

from sqlalchemy import text

from mariner.db import models as m
from mariner.db.store import build_snapshot, rows
from mariner.engine.i18n import LEGAL, RISK, STATUS, LAYERS_EN, impact_text, watch_text
from mariner.settings import now


def money(value, signed=False):
    return f'{"−" if value < 0 else "+" if signed else ""}${abs(value):,.2f}'


def index_entry(session, entry):
    session.execute(text("DELETE FROM kb_fts WHERE id=:id"), {"id": entry["id"]})
    session.execute(text("INSERT INTO kb_fts (id,title_zh,body_zh,title_en,body_en) VALUES (:id,:title_zh,:body_zh,:title_en,:body_en)"), entry)


def init_fts(session):
    session.execute(text("CREATE VIRTUAL TABLE IF NOT EXISTS kb_fts USING fts5(id UNINDEXED,title_zh,body_zh,title_en,body_en,tokenize='trigram')"))


def sync_kb(session, settings, only=None):
    from mariner.engine.adapter import LAYER_LABELS
    init_fts(session)
    session.flush()
    today, generated = str(settings.today), {}
    snapshot = build_snapshot(session)

    def add(kind, ref, zh, en, day=today):
        generated[f"{kind}:{ref}"] = dict(source_type=kind, business_date=day,
            title_zh=zh[0], body_zh=zh[1], title_en=en[0], body_en=en[1])

    for wid, w in snapshot["watch_items"].items():
        content = []
        for lang in ("zh", "en"):
            title, summary = watch_text(session, wid, w, lang)
            content.append((title, summary + ("\n下一节点：" if lang == "zh" else "\nNext milestone: ") + (w.get("next_milestone") or ("无" if lang == "zh" else "None"))))
        add("watch", wid, *content)
    for p in snapshot["programs"]:
        values = []
        for lang in ("zh", "en"):
            zh = lang == "zh"
            title = (LAYER_LABELS if zh else LAYERS_EN).get(p["id"], p["name"])
            body = (f'税率 {p["rate_pct"]}%\n第99章税号 {p["heading"]}\n适用入境日 {p.get("valid_from")} 至 {p.get("valid_to") or "无截止"}\n来源：' if zh else
                    f'Rate {p["rate_pct"]}%\nChapter 99 heading {p["heading"]}\nEntry dates {p.get("valid_from")} to {p.get("valid_to") or "No end date"}\nSources: ')
            values.append((title, body + " ".join(p.get("sources", []))))
        add("rule", p["id"], *values)
    for doc in rows(session, m.PolicyDocument):
        triage = session.get(m.TriageRecord, doc.id)
        if not triage or not triage.payload["relevant"]:
            continue
        d, t = doc.payload, triage.payload
        draft = session.get(m.RuleDraft, f"DRAFT-{doc.id}")
        content = []
        for lang in ("zh", "en"):
            zh = lang == "zh"
            title = t.get("one_line_" + lang) or t["one_line_zh"]
            summary = (draft.payload.get("summary_" + lang) or draft.payload["summary_zh"]) if draft else title
            legal = LEGAL.get(t["legal_status"], ("无", "None"))[not zh]
            status = STATUS[draft.payload["status"]][not zh] if draft else ("无" if zh else "None")
            body = (f'法律状态：{legal}\n原文标题：{d["title"]}\n发布日期：{d.get("publication_date")}\n摘要：{summary}\n草稿状态：{status}\n原文：{d.get("html_url")}' if zh else
                    f'Legal status: {legal}\nOriginal title: {d["title"]}\nPublication date: {d.get("publication_date")}\nSummary: {summary}\nDraft status: {status}\nSource: {d.get("html_url")}')
            content.append((title, body))
        add("policy", doc.id, *content, day=doc.business_date)
    for b in rows(session, m.Brief):
        v = b.payload
        add("brief", b.id, (f"美国关税政策日报 · {b.id}", v["conclusion"].split("。")[0] + "。\n" + "\n".join("- " + i["title"] for i in v["items"])),
            (f"U.S. Tariff Policy Brief · {b.id}", v.get("conclusion_en", v["conclusion"]).split(". ")[0] + ".\n" + "\n".join("- " + i.get("title_en", i["title"]) for i in v["items"])), day=b.id)
    for o in rows(session, m.Order):
        v = o.payload
        fields = [("贸易术语", "Incoterm", "incoterm"), ("渠道", "Channel", "channel"), ("税号", "HTS", "hts10"),
                  ("数量", "Quantity", "qty"), ("单价", "Unit price", "unit_price_usd"), ("完税价格", "Customs value", "customs_value_usd"),
                  ("装船日", "Load date", "load_date"), ("预计入境日", "Entry date", "entry_date"), ("状态", "Status", "status")]
        vals = []
        for lang in ("zh", "en"):
            lines = []
            for zh, en, key in fields:
                val = v[key]
                if key.endswith("_usd"):
                    val = money(val)
                elif key == "channel":
                    val = "B2B" if val == "b2b" else "电商" if lang == "zh" else "E-commerce"
                elif key == "status":
                    val = dict(quoted=("已报价", "Quoted"), confirmed=("已确认", "Confirmed"), shipped=("已发货", "Shipped"), entered=("已入境", "Entered"))[val][lang == "en"]
                lines.append(f'{zh if lang == "zh" else en}：{val}')
            vals.append((f'{"订单" if lang == "zh" else "Order"} {o.id} · {v["product"]}', "\n".join(lines)))
        add("order", o.id, *vals)
    runs = rows(session, m.ImpactRun)
    run = max(runs, key=lambda r: r.payload["created_at"]) if runs else None
    for i in rows(session, m.Impact):
        if not run or i.run_id != run.id:
            continue
        raw = i.payload
        values = []
        for lang in ("zh", "en"):
            v = impact_text({**raw, "layers": []}, lang, session, snapshot)
            risk = v["risk_level"] if lang == "zh" else RISK[v["risk_level"]]
            title = f'{"影响单" if lang == "zh" else "Impact sheet"} {i.order_id} · {risk}'
            body = (f'订单 {i.order_id} {v["product"]}（HTS {v["hts10"]}，{v["incoterm"]}）：风险 {risk}；新税率 {v["rate_new_pct"]:.1f}%（基准 {v["rate_baseline_user_pct"]:.1f}%）；关税增量 {money(v["duty_delta_usd"], True)}；利润 {money(v["seller_profit_baseline_usd"])} → {money(v["seller_profit_new_usd"])}（变化 {money(v["profit_delta_usd"], True)}）\n原因：{v["risk_reasons"]}' if lang == "zh" else
                    f'Order {i.order_id} {v["product"]} (HTS {v["hts10"]}, {v["incoterm"]}): risk {risk}; new rate {v["rate_new_pct"]:.1f}% (baseline {v["rate_baseline_user_pct"]:.1f}%); duty change {money(v["duty_delta_usd"], True)}; profit {money(v["seller_profit_baseline_usd"])} → {money(v["seller_profit_new_usd"])} (change {money(v["profit_delta_usd"], True)})\nReason: {v["risk_reasons"]}')
            values.append((title, body + "\n" + "\n".join(f"{j+1:02}. {a}" for j, a in enumerate(v["actions"])) ))
        add("impact", i.order_id, *values)
    for key, value in generated.items():
        if only is not None and key != only:
            continue
        record = session.get(m.KbEntry, key)
        old = dict(record.payload) if record else dict(id=key, created_at=now(), edited_zh=False, edited_en=False, source_changed=False)
        old.setdefault("deleted", False)
        old.setdefault("deleted_at", None)
        changed = False
        for lang in ("zh", "en"):
            for field in ("title", "body"):
                name = field + "_" + lang
                if old.get("edited_" + lang):
                    changed |= old.get("auto_" + name) != value[name]
                else:
                    old[name] = value[name]
                old["auto_" + name] = value[name]
        old.update(source_type=value["source_type"], business_date=value["business_date"], sensitive=value["source_type"] in ("order", "impact"), editable=value["source_type"] not in ("order", "impact"), source_changed=old["source_changed"] or changed)
        if not record or old != record.payload:
            old["updated_at"] = now()
            if record:
                record.payload = old
            else:
                session.add(m.KbEntry(id=key, business_date=value["business_date"], payload=old))
            index_entry(session, old)
    for record in rows(session, m.KbEntry):
        if only is None and not record.payload.get("deleted", False) and record.payload["source_type"] != "manual" and record.id not in generated:
            session.execute(text("DELETE FROM kb_fts WHERE id=:id"), {"id": record.id})
            session.delete(record)
    session.flush()


CN_STOP = set("什么 哪些 怎么 为什 一下 请问 你好 您好 有没 没有 可以 这个 那个 我们 你们 一个 是否 需要 现在 目前 情况 相关 今天 今日 最新 最近 当天".split())
EN_STOP = set("what is the are of to in on for and any there which why how does do today latest recent changed change what's a an me about please hi hello".split())
TIME_WORDS = "今天 今日 最新 最近 当天 日报 本周 today latest recent brief".split() + ["this week"]


def tokens(question):
    value = question.lower()
    terms = []
    for match in re.finditer(r"[a-z0-9][a-z0-9.\-]*|[一-鿿]+", value):
        run = match.group()
        if re.fullmatch(r"[一-鿿]+", run):
            terms.extend(run[i:i+2] for i in range(len(run)-1) if run[i:i+2] not in CN_STOP)
        elif len(run) >= 2 and run not in EN_STOP:
            terms.append(run)
    return list(dict.fromkeys(terms))


def mentioned_orders(question, order_ids):
    return [oid for oid in order_ids if re.search(r"(?<![a-z0-9])" + re.escape(oid) + r"(?![a-z0-9])", question, re.I)]


def ranked_entries(session, candidates, question, prev_question, include_sensitive, order_ids, settings):
    terms = tokens(question + " " + prev_question)
    def score(entry):
        title = (entry["title_zh"] + " " + entry["title_en"]).lower()
        body = (entry["body_zh"] + " " + entry["body_en"]).lower()
        return sum(3 if term in title else 1 if term in body else 0 for term in terms)
    scored = [(score(v), v) for v in candidates]
    result = [v for n, v in sorted(scored, key=lambda pair: (-pair[0], pair[1]["id"])) if n > 0]
    if not result or any(word in question.lower() for word in TIME_WORDS):
        from mariner.engine.adapter import watches
        from mariner.settings import Settings
        briefs = sorted((v for v in candidates if v["source_type"] == "brief"), key=lambda v: (v["business_date"], v["id"]), reverse=True)
        by_id = {v["id"]: v for v in candidates}
        watch_entries = [by_id["watch:" + w["id"]] for w in watches(session, settings or Settings()) if "watch:" + w["id"] in by_id]
        result = briefs[:1] + result + watch_entries
    if include_sensitive:
        by_id = {v["id"]: v for v in candidates}
        result = [by_id[key] for oid in mentioned_orders(question, order_ids) for kind in ("impact", "order") if (key := kind + ":" + oid) in by_id] + result
    return list({v["id"]: v for v in result}.values())


def retrieve(session, question, prev_question="", include_sensitive=False, order_ids=(), k=8, *, settings=None):
    candidates = [e.payload for e in rows(session, m.KbEntry) if not e.payload.get("deleted", False) and (include_sensitive or not e.payload["sensitive"])]
    return ranked_entries(session, candidates, question, prev_question, include_sensitive, order_ids, settings)[:k]


def search(session, q="", kind=None, include_sensitive=False, limit=50, offset=0, *, deleted=False, settings=None):
    candidates = [e.payload for e in rows(session, m.KbEntry) if bool(e.payload.get("deleted", False)) == deleted and (include_sensitive or not e.payload["sensitive"])]
    if q:
        candidates = ranked_entries(session, candidates, q, "", include_sensitive, [o.id for o in rows(session, m.Order)], settings)
    else:
        candidates.sort(key=lambda v: v["updated_at"], reverse=True)
    if kind:
        candidates = [v for v in candidates if v["source_type"] == kind]
    return candidates[offset:offset+limit]
