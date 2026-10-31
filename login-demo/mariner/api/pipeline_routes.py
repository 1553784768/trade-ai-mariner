from typing import Literal
from mariner.localization import localize
from fastapi import APIRouter, Depends

from mariner.api import schemas as s
from mariner.api.errors import ApiException
from mariner.api.routes import missing, session_dep, settings_dep, pipeline_dep
from mariner.agents.validate import validate
from mariner.audit.service import append
from mariner.db import models as m
from mariner.db.store import build_snapshot, rows
from mariner.engine.adapter import current_impacts
from mariner.engine.changes import apply_change, store_changes
from mariner.engine.service import create_run

router = APIRouter(prefix="")


@router.post("/pipeline/runs", response_model=s.PipelineRun, status_code=202)
def start_pipeline(pipeline=Depends(pipeline_dep), lang: Literal["zh", "en"] = "zh"):
    return localize(pipeline.start(), "pipeline", lang, None)


@router.get("/pipeline/runs/latest", response_model=s.PipelineRun)
def latest_pipeline(lang: Literal["zh", "en"] = "zh", session=Depends(session_dep)):
    values = rows(session, m.PipelineRun)
    if not values:
        missing("流水线", "latest")
    return localize(max(values, key=lambda r: r.payload["started_at"]).payload, "pipeline", lang, session)


@router.get("/pipeline/runs/{run_id}", response_model=s.PipelineRun)
def pipeline_detail(run_id: str, lang: Literal["zh", "en"] = "zh", session=Depends(session_dep)):
    record = session.get(m.PipelineRun, run_id)
    if record is None:
        missing("流水线", run_id)
    return localize(record.payload, "pipeline", lang, session)


@router.get("/rule-drafts", response_model=list[s.RuleDraft])
def drafts(lang: Literal["zh", "en"] = "zh", status: str | None = None, session=Depends(session_dep)):
    rank = {"draft": 0, "needs_detail": 1, "approved": 2, "rejected": 3}
    if status and status not in rank:
        raise ApiException(400, "BAD_REQUEST", "请求参数不合法")
    values = sorted([r.payload for r in rows(session, m.RuleDraft) if not status or r.payload["status"] == status], key=lambda r: r["created_at"], reverse=True)
    return [localize(v, "draft", lang, session) for v in sorted(values, key=lambda r: rank[r["status"]])]


@router.get("/rule-drafts/{draft_id}", response_model=s.RuleDraftDetail)
def draft_detail(draft_id: str, lang: Literal["zh", "en"] = "zh", session=Depends(session_dep)):
    record = session.get(m.RuleDraft, draft_id)
    if record is None:
        missing("草稿", draft_id)
    return localize(record.payload, "draft", lang, session)


@router.post("/rule-drafts/{draft_id}/review", response_model=s.RuleDraft)
def review(draft_id: str, body: s.ReviewRequest, session=Depends(session_dep), settings=Depends(settings_dep)):
    record = session.get(m.RuleDraft, draft_id)
    if record is None:
        missing("草稿", draft_id)
    draft = record.payload
    if draft["status"] not in ("draft", "needs_detail"):
        raise ApiException(409, "CONFLICT", "该草稿已处理，不能重复操作")
    number = draft["source_document_number"]
    if body.action == "approve":
        doc = session.get(m.PolicyDocument, number)
        _, impacts = current_impacts(session, settings)
        draft = validate(draft, draft["source_text"], doc.payload["publication_date"], build_snapshot(session), settings, impacts)
        if any(c["status"] == "fail" for c in draft["validation"]):
            raise ApiException(409, "CONFLICT", "该草稿存在未通过的校验，不能确认")
        _, changes, outcome = apply_change(build_snapshot(session), draft["change"], doc.payload["publication_date"], draft["legal_status"], draft["title"], draft["summary_zh"])
        store_changes(session, changes, draft, str(settings.today))
        record.payload = {**draft, "status": "approved"}
        append(session, str(settings.today), "RULE_APPROVED", "本地用户", draft_id, f"确认 {number} · {outcome}")
        if changes:
            create_run(session, settings)
    else:
        state, action, summary = ("rejected", "RULE_REJECTED", f"驳回 {number}") if body.action == "reject" else ("needs_detail", "RULE_NEEDS_DETAIL", f"{number} 需补充")
        record.payload = {**draft, "status": state}
        append(session, str(settings.today), action, "本地用户", draft_id, summary)
    from mariner.knowledge.service import sync_kb
    sync_kb(session, settings)
    session.commit()
    return record.payload


@router.get("/briefs", response_model=list[s.BriefDate])
def brief_dates(session=Depends(session_dep)):
    return [dict(date=r.id, item_count=len(r.payload["items"])) for r in sorted(rows(session, m.Brief), key=lambda r: r.id, reverse=True)]


@router.get("/briefs/latest", response_model=s.Brief)
def latest_brief(lang: Literal["zh", "en"] = "zh", session=Depends(session_dep), settings=Depends(settings_dep)):
    current_impacts(session, settings)
    values = rows(session, m.Brief)
    if not values:
        missing("日报", "latest")
    return localize(max(values, key=lambda r: r.id).payload, "brief", lang, session)


@router.get("/briefs/{day}", response_model=s.Brief)
def brief_detail(day: str, lang: Literal["zh", "en"] = "zh", session=Depends(session_dep)):
    record = session.get(m.Brief, day)
    if record is None:
        missing("日报", day)
    return localize(record.payload, "brief", lang, session)
