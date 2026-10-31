"""Translate engine output without changing calculations or numeric parameters."""
import json
import logging
import re
from copy import deepcopy

from mariner.settings import ROOT

TEMPLATES = json.loads((ROOT / "docs/engine_text_templates.json").read_text(encoding="utf-8"))
LAYERS_EN = dict(MFN="General (MFN)", SEC301_LIST_CN="Section 301 list",
                 SEC301_FORCED_LABOR_CN="Section 301 forced labor", SEC122_GLOBAL="Section 122 surcharge",
                 IEEPA_FENTANYL_CN="IEEPA fentanyl", IEEPA_RECIPROCAL_CN="IEEPA reciprocal")
WATCH_EN = {
    "W_301_EXCLUSION_EXPIRY": ("178 China Section 301 exclusions expire on 11-09", "Exclusions cover goods entered before 23:59 U.S. Eastern on 2026-11-09; no extension notice seen as of 2026-10-31."),
    "W_232_ROBOTICS": ("Section 232 proclamation on robotics and industrial machinery", "Signed 2026-10-28; starts negotiations; no rate, tariff code list or effective date yet; first progress report due around 2027-04-26."),
    "W_301_EXCESS_CAPACITY": ("Section 301 excess-capacity investigation (China: steel, aluminum, batteries, solar, semiconductors, autos)", "Opened 2026-03-11; no final action yet."),
}
LEGAL = dict(in_force=("已生效", "In force"), signed_pending=("已签署待生效", "Signed, pending"),
             scheduled_expiry=("按期到期", "Scheduled expiry"), proposed=("拟议", "Proposed"),
             investigation=("调查中", "Under investigation"), negotiation_no_tariff=("谈判中（无税率）", "In negotiation (no rate)"),
             court_ruling=("法院裁决", "Court ruling"), procedural=("程序性", "Procedural"))
RISK = dict(zip("红橙黄绿", ("Red", "Orange", "Yellow", "Green")))
STATUS = dict(draft=("待确认", "Pending"), needs_detail=("需补充", "Needs Detail"),
              approved=("已确认", "Approved"), rejected=("已驳回", "Rejected"))


def parse(text, kind):
    matches = []
    for template in TEMPLATES[kind]:
        names = re.findall(r"\{(\w+)\}", template["zh"])
        pattern = re.escape(template["zh"])
        for name in names:
            pattern = pattern.replace(re.escape("{" + name + "}"), f"(?P<{name}>.+?)")
        match = re.fullmatch(pattern, text)
        if match:
            matches.append((template, match.groupdict()))
    return matches


def watch_text(session, wid, value, lang):
    from mariner.engine.adapter import WATCH_TEXT
    from mariner.db.models import TriageRecord
    if lang == "zh":
        return WATCH_TEXT.get(wid, (value["title"], value["summary"]))
    if wid in WATCH_EN:
        return WATCH_EN[wid]
    triage = session.get(TriageRecord, wid.removeprefix("W_"))
    if triage and triage.payload.get("one_line_en"):
        return triage.payload["one_line_en"], triage.payload["one_line_en"]
    return value["title"], value["summary"]


def render(text, kind, lang, session=None, snapshot=None):
    matches = parse(text, kind)
    if len(matches) != 1:
        logging.getLogger(__name__).warning("Engine text has %s template matches: %s", len(matches), text)
        return text
    template, params = matches[0]
    if "watch_title" in params and session is not None:
        for wid, w in (snapshot or {}).get("watch_items", {}).items():
            if w["title"] == params["watch_title"]:
                params["watch_title"] = watch_text(session, wid, w, lang)[0]
                break
    return template[lang].format(**params)


def impact_text(value, lang, session, snapshot):
    v = deepcopy(value)
    v["actions"] = [render(t, "actions", lang, session, snapshot) for t in v["actions"]]
    v["flags"] = [render(t, "flags", lang, session, snapshot) for t in v["flags"]]
    v["risk_reasons"] = ("; " if lang == "en" else "；").join(
        render(t, "reasons", lang, session, snapshot) for t in v["risk_reasons"].split("；") if t)
    v["adopted_actions"] = [{**a, "text": render(a["text"], "actions", lang, session, snapshot)}
                            for a in v.get("adopted_actions", [])]
    if lang == "en":
        v["layers"] = [{**layer, "label": LAYERS_EN.get(layer["id"], layer["label"])} for layer in v["layers"]]
    return v
