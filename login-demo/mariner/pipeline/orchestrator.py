import hashlib
import json
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

from mariner.agents.brief import build_brief
from mariner.agents.llm_client import FixtureLLMClient, HttpLLMClient, NoFixture
from mariner.agents.schemas import ExtractionResult, TriageResult
from mariner.agents.validate import validate
from mariner.api.errors import ApiException
from mariner.audit.service import append
from mariner.collectors.service import collect_documents, collect_usitc, metadata, source_text
from mariner.db import models as m
from mariner.db.store import build_snapshot, rows
from mariner.engine.adapter import current_impacts
from mariner.engine.service import identifier
from mariner.settings import now
from mariner.knowledge.service import sync_kb

AGENTS = ("collector_fr", "collector_pi", "collector_usitc", "triage", "extract", "validate", "brief")
EXTRACT_CATEGORIES = {"rate_change", "exclusion", "scope_change", "investigation", "negotiation", "needs_fulltext", "comment_request", "procedure", "refund"}
PROMPTS = Path(__file__).resolve().parents[1] / "agents/prompts"


def counts(input=0, output=0, skipped=0, errors=0):
    return dict(input=input, output=output, skipped=skipped, errors=errors)


def aggregate_status(count):
    return "failed" if count["errors"] else "skipped_no_fixture" if count["input"] > 0 and count["skipped"] == count["input"] else "succeeded"


class Pipeline:
    def __init__(self, factory, settings, llm):
        self.llm = llm
        self.factory, self.settings = factory, settings
        self.lock = threading.Lock()
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="mariner-pipeline")

    def start(self, trigger="manual", background=True):
        if not self.lock.acquire(blocking=False):
            if trigger == "schedule_0730":
                logging.getLogger(__name__).info("Scheduled pipeline skipped: another run is active")
                return None
            raise ApiException(409, "CONFLICT", "已有流水线正在运行")
        run_id = identifier("PIPE")
        value = dict(id=run_id, trigger=trigger, status="running", started_at=now(), finished_at=None,
                     steps=[dict(agent=a, status="pending", started_at=None, finished_at=None, counts=counts(), message=None) for a in AGENTS])
        try:
            with self.factory.begin() as session:
                session.add(m.PipelineRun(id=run_id, business_date=str(self.settings.today), payload=value))
            if background:
                self.executor.submit(self.execute, run_id)
            else:
                self.execute(run_id)
        except Exception:
            if self.lock.locked():
                self.lock.release()
            raise
        return value

    def update_step(self, run_id, agent, **patch):
        with self.factory.begin() as session:
            run = session.get(m.PipelineRun, run_id)
            run.payload = {**run.payload, "steps": [{**s, **patch} if s["agent"] == agent else s for s in run.payload["steps"]]}

    def record(self, session, run_id, agent, number, start, status, user, output, model, error, elapsed, usage=None):
        usage = usage or {}
        key = uuid4().hex
        session.add(m.AgentStep(id=key, business_date=str(self.settings.today), payload=dict(id=key, pipeline_run_id=run_id,
            business_date=str(self.settings.today), agent=agent, document_number=number, started_at=start, finished_at=now(), status=status,
            model=model, prompt_version=f"{agent}_v2" if agent in ("triage", "extract") else None,
            input_sha256=hashlib.sha256(user.encode("utf-8")).hexdigest(), output_json=output, error=error,
            tokens_in=usage.get("prompt_tokens"), tokens_out=usage.get("completion_tokens"), latency_ms=elapsed)))

    def run_agent(self, session, run_id, role):
        config = self.llm.get()
        client = HttpLLMClient(config) if config else FixtureLLMClient()
        docs = rows(session, m.PolicyDocument)
        if role == "triage":
            docs = [d for d in docs if session.get(m.TriageRecord, d.id) is None]
        else:
            docs = [d for d in docs if session.get(m.RuleDraft, f"DRAFT-{d.id}") is None and
                    (t := session.get(m.TriageRecord, d.id)) and t.payload["relevant"] and t.payload["category"] in EXTRACT_CATEGORIES]
        result = counts(input=len(docs))
        relevant = 0
        for doc in docs:
            start, clock, user = now(), time.monotonic(), ""
            output = error = None
            try:
                if role == "triage":
                    user_data = metadata(doc.payload)
                    schema = TriageResult
                else:
                    text = source_text(doc.payload, self.settings)
                    user_data = dict(document_number=doc.id, title=doc.payload["title"], publication_date=doc.payload.get("publication_date"), truncated=len(text) > 120000, text=text[:120000])
                    schema = ExtractionResult
                user = json.dumps(user_data, ensure_ascii=False)
                output = client.complete_json(system=(PROMPTS / f"{role}_v2.md").read_text(encoding="utf-8"), user=user, schema=schema, fixture_key=doc.id, role=role).model_dump()
                if output["document_number"] != doc.id:
                    raise ValueError("Document number mismatch")
                if role == "triage":
                    merged = json.dumps(user_data, ensure_ascii=False)
                    if not all(e["quote"] in merged for e in output["evidence"]):
                        raise ValueError("Triage evidence does not match metadata")
                    relevant += output["relevant"]
                    session.add(m.TriageRecord(id=doc.id, business_date=str(self.settings.today), payload=output))
                else:
                    t = session.get(m.TriageRecord, doc.id).payload
                    draft = dict(id=f"DRAFT-{doc.id}", source_document_number=doc.id, source_url=doc.payload.get("html_url") or doc.payload.get("pdf_url"),
                                 title=t["one_line_zh"], original_title=doc.payload["title"], legal_status=output["legal_status"], change=output["change"],
                                 summary_zh=output["summary_zh"], summary_en=output["summary_en"], title_en=t.get("one_line_en"), evidence=[{**e, "verified": False} for e in output["evidence"]], validation=[],
                                 status="draft", impact_preview=None, created_at=now(), source_text=text, highlights=[], pipeline_run_id=run_id)
                    session.add(m.RuleDraft(id=draft["id"], business_date=str(self.settings.today), payload=draft))
                result["output"] += 1
                status = "succeeded"
            except NoFixture:
                status = "skipped_no_fixture"
                result["skipped"] += 1
            except Exception as exc:
                status, error = "failed", str(exc)
                result["errors"] += 1
            self.record(session, run_id, role, doc.id, start, status, user, output, client.model, error, round((time.monotonic()-clock)*1000, 2), client.usage)
            session.flush()
        if role == "triage":
            summary = f'分诊 {result["output"]} 篇，相关 {relevant} 篇，无夹具跳过 {result["skipped"]} 篇'
        else:
            summary = f'生成草稿 {result["output"]} 篇，无夹具跳过 {result["skipped"]} 篇'
        append(session, str(self.settings.today), "TRIAGED" if role == "triage" else "EXTRACTED", "分诊" if role == "triage" else "抽取", run_id, summary)
        return result

    def execute(self, run_id):
        try:
            for agent in AGENTS:
                start, clock = now(), time.monotonic()
                self.update_step(run_id, agent, status="running", started_at=start)
                result, message = counts(), None
                try:
                    with self.factory.begin() as session:
                        if agent in ("collector_fr", "collector_pi"):
                            result = collect_documents(session, self.settings, agent)
                            append(session, str(self.settings.today), "COLLECTED", "联邦公报采集" if agent == "collector_fr" else "公开预览采集", run_id, f'新增 {result["output"]} 篇')
                        elif agent == "collector_usitc":
                            result = collect_usitc(session, self.settings)
                            append(session, str(self.settings.today), "COLLECTED", "税则版本检查", run_id, f'新增 {result["output"]} 篇')
                        elif agent in ("triage", "extract"):
                            result = self.run_agent(session, run_id, agent)
                            failures = [r.payload["error"] for r in rows(session, m.AgentStep) if r.payload["pipeline_run_id"] == run_id and r.payload["agent"] == agent and r.payload.get("error")]
                            message = failures[0] if failures else None
                        elif agent == "validate":
                            drafts = [d for d in rows(session, m.RuleDraft) if d.payload.get("pipeline_run_id") == run_id]
                            _, impacts = current_impacts(session, self.settings)
                            failed = 0
                            for draft in drafts:
                                doc = session.get(m.PolicyDocument, draft.payload["source_document_number"])
                                draft.payload = validate(draft.payload, draft.payload["source_text"], doc.payload["publication_date"], build_snapshot(session), self.settings, impacts)
                                failed += any(v["status"] == "fail" for v in draft.payload["validation"])
                            result = counts(input=len(drafts), output=len(drafts))
                            append(session, str(self.settings.today), "VALIDATED", "校验", run_id, f"校验草稿 {len(drafts)} 篇，存在不通过项 {failed} 篇")
                        else:
                            brief = build_brief(session, self.settings)
                            result = counts(input=1, output=1)
                            append(session, str(self.settings.today), "BRIEF_PUBLISHED", "日报", brief["date"], f'日报 {brief["date"]} · {len(brief["items"])} 条')
                        status = aggregate_status(result) if agent in ("triage", "extract") else "succeeded"
                        if agent not in ("triage", "extract"):
                            self.record(session, run_id, agent, None, start, status, "", result, None, None, round((time.monotonic()-clock)*1000, 2))
                except Exception as exc:
                    logging.getLogger(__name__).exception("Pipeline step failed: %s", agent)
                    status, message = "failed", str(exc)
                    result["errors"] += 1
                    with self.factory.begin() as session:
                        self.record(session, run_id, agent, None, start, status, "", None, None, message, round((time.monotonic()-clock)*1000, 2))
                self.update_step(run_id, agent, status=status, finished_at=now(), counts=result, message=message)
            with self.factory.begin() as session:
                run = session.get(m.PipelineRun, run_id)
                steps = run.payload["steps"]
                status = "failed" if all(s["status"] == "failed" for s in steps[:3]) else "partial" if any(s["status"] in ("failed", "skipped_no_fixture") or s["counts"]["skipped"] for s in steps) else "succeeded"
                run.payload = {**run.payload, "status": status, "finished_at": now()}
                sync_kb(session, self.settings)
        finally:
            self.lock.release()

    def close(self):
        self.executor.shutdown(wait=True)
