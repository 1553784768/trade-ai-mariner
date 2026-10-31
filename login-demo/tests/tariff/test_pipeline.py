import json
import threading

import httpx
import pytest
from pydantic import BaseModel

from mariner.agents.llm_client import HttpLLMClient
from mariner.agents.schemas import TriageResult
from mariner.agents.validate import validate
from mariner.collectors.client import CollectorHTTP
from mariner.collectors.service import FR_URL, PI_URL, collect_documents, metadata, read_fixture, source_text
from mariner.db import models as m
from mariner.db.store import rows, build_snapshot
from mariner.engine.adapter import current_impacts
from mariner.scheduler import make_scheduler
from mariner.settings import Settings


def run_pipeline(client):
    client.app.state.pipeline.start(background=False)
    return client.get("/api/tariff/pipeline/runs/latest").json()


def test_complete_fixture_pipeline(client):
    run = run_pipeline(client)
    expected = [(20, 20, 0), (108, 10, 0), (1, 1, 0), (30, 23, 7), (8, 2, 6), (2, 2, 0), (1, 1, 0)]
    assert run["status"] == "partial", run
    for step, (inputs, output, skipped) in zip(run["steps"], expected):
        assert step["status"] == "succeeded", step
        assert step["counts"] == dict(input=inputs, output=output, skipped=skipped, errors=0)
    assert client.get("/api/tariff/meta").json()["hts_release"] == "2026HTSRev22"
    drafts = client.get("/api/tariff/rule-drafts").json()
    assert {d["id"] for d in drafts} == {"DRAFT-2026-20511", "DRAFT-2026-20510"}
    detail = client.get("/api/tariff/rule-drafts/DRAFT-2026-20511").json()
    assert [v["status"] for v in detail["validation"]] == ["pass", "pass", "warn", "n/a", "n/a", "warn", "n/a", "n/a", "n/a"]
    assert len(detail["highlights"]) == 4
    assert "8479.90.9591" in detail["source_text"]
    brief = client.get("/api/tariff/briefs/latest").json()
    assert [i["kind"] for i in brief["items"]] == ["expiry"] + ["policy"] * 7 + ["preview_alert"]
    assert brief["items"][0]["affected_order_ids"] == ["O5"]
    assert brief["items"][0]["impact_usd"] == -16000
    assert "2026-22385" in brief["items"][-1]["source_url"]
    assert sum(not i["confirmed"] for i in brief["items"]) == 2
    assert brief["conclusion"] == "今天没有新的已生效税率变化。待处理红色订单 1 单，合计利润变化 −$16,000.00。"
    assert client.get("/api/tariff/briefs").json() == [dict(date="2026-10-31", item_count=9)]
    before = client.get("/api/tariff/rules/snapshot").json()
    run_before = client.get("/api/tariff/runs/latest").json()["id"]
    assert client.post("/api/tariff/rule-drafts/DRAFT-2026-20511/review", json={"action": "approve"}).json()["status"] == "approved"
    assert client.get("/api/tariff/rules/snapshot").json() == before
    assert client.get("/api/tariff/runs/latest").json()["id"] == run_before
    assert any("不影响现有订单" in e["summary"] for e in client.get("/api/tariff/audit").json())
    assert client.post("/api/tariff/rule-drafts/DRAFT-2026-20511/review", json={"action": "approve"}).status_code == 409
    again = run_pipeline(client)
    assert [s["counts"]["output"] for s in again["steps"][:2]] == [0, 0]
    assert again["steps"][3]["counts"] == dict(input=7, output=0, skipped=7, errors=0)
    with client.app.state.factory() as session:
        assert len(rows(session, m.PolicyDocument)) == 30
        assert len(rows(session, m.TriageRecord)) == 23
        assert sum(t.payload["relevant"] for t in rows(session, m.TriageRecord)) == 8
        for number, fixture in read_fixture("llm/triage.json").items():
            if number.startswith("_"):
                continue
            TriageResult.model_validate(fixture)
            doc = session.get(m.PolicyDocument, number)
            merged = json.dumps(metadata(doc.payload), ensure_ascii=False)
            assert all(e["quote"] in merged for e in fixture["evidence"])


def test_fabricated_evidence_rejected(client):
    run_pipeline(client)
    with client.app.state.factory.begin() as session:
        record = session.get(m.RuleDraft, "DRAFT-2026-20511")
        draft = dict(record.payload)
        draft["evidence"] = [{**e, "quote": "FABRICATED QUOTE"} for e in draft["evidence"]]
        _, impacts = current_impacts(session, client.app.state.settings)
        record.payload = validate(draft, draft["source_text"], "2026-10-07", build_snapshot(session), client.app.state.settings, impacts)
        assert record.payload["validation"][0]["status"] == "fail"
    assert client.post("/api/tariff/rule-drafts/DRAFT-2026-20511/review", json={"action": "approve"}).status_code == 409


def test_live_collectors_are_mocked(client, respx_mock):
    settings = Settings(as_of_date="2026-10-31", collector_mode="live", scheduler_enabled=False)
    doc = read_fixture("federal_register/documents_ustr_cbp_2026-10-01_2026-10-29.json")["results"][0]
    route = respx_mock.get(FR_URL).mock(side_effect=[httpx.Response(503), httpx.Response(200, json={"results": [doc], "next_page_url": FR_URL + "?page=2"}), httpx.Response(200, json={"results": []})])
    waits = []
    http = CollectorHTTP(sleep=waits.append)
    with client.app.state.factory.begin() as session:
        result = collect_documents(session, settings, "collector_fr", http)
        assert result["output"] == 1
    assert route.call_count == 3
    assert route.calls[0].request.headers["User-Agent"] == "MarinerAI/0.1"
    assert waits
    respx_mock.get(PI_URL).respond(json=read_fixture("federal_register/public_inspection_unavailable_example.json"))
    with client.app.state.factory.begin() as session:
        assert collect_documents(session, settings, "collector_pi", http)["output"] == 0
    with pytest.raises(ValueError, match="not allowed"):
        http.get("https://evil.example/document.pdf")
    redirect = "https://www.federalregister.gov/redirect"
    respx_mock.get(redirect).respond(302, headers={"Location": "https://evil.example/document.pdf"})
    with pytest.raises(ValueError, match="not allowed"):
        http.get(redirect)
    with client.app.state.factory() as session:
        assert "8479.90.9591" in source_text({"document_number": "2026-20511"}, client.app.state.settings)


def test_scheduler_and_concurrent_start(client, monkeypatch):
    pipeline = client.app.state.pipeline
    assert make_scheduler(Settings(scheduler_enabled=False), pipeline).get_jobs() == []
    jobs = make_scheduler(Settings(scheduler_enabled=True), pipeline).get_jobs()
    assert len(jobs) == 1
    assert str(jobs[0].trigger.timezone) == "Asia/Shanghai"
    assert "hour='7'" in str(jobs[0].trigger) and "minute='30'" in str(jobs[0].trigger)
    entered, release = threading.Event(), threading.Event()
    original = pipeline.execute
    def paused(run_id):
        entered.set()
        release.wait(10)
        original(run_id)
    monkeypatch.setattr(pipeline, "execute", paused)
    response = client.post("/api/tariff/pipeline/runs")
    assert response.status_code == 202
    entered.wait(2)
    try:
        assert client.post("/api/tariff/pipeline/runs").status_code == 409
    finally:
        release.set()


class Ping(BaseModel):
    ok: bool


def test_model_retry_and_request(respx_mock):
    url = "https://model.example/v1/chat/completions"
    valid = {"choices": [{"message": {"content": '{"ok": true}'}}]}
    route = respx_mock.post(url).mock(side_effect=[httpx.Response(500), httpx.Response(200, json={"choices": [{"message": {"content": "bad"}}]}), httpx.Response(200, json=valid)])
    waits = []
    client = HttpLLMClient(dict(base_url="https://model.example/v1/", model="demo", api_key="secret"), sleep=waits.append)
    assert client.complete_json(system="system", user="public policy only", schema=Ping, fixture_key="", role="triage").ok
    assert waits == [2]
    assert route.call_count == 3
    body = json.loads(route.calls[0].request.content)
    assert body["response_format"] == {"type": "json_object"}
    assert "temperature" not in body
    assert route.calls[0].request.headers["Authorization"] == "Bearer secret"
    assert "上次输出不符合要求" in json.loads(route.calls[-1].request.content)["messages"][1]["content"]
    route.mock(return_value=httpx.Response(401, text="denied"))
    previous = route.call_count
    with pytest.raises(ValueError, match="HTTP 401"):
        client.complete_json(system="s", user="u", schema=Ping, fixture_key="", role="triage")
    assert route.call_count == previous + 1


def test_model_settings_mask_and_test(client, respx_mock):
    payload = dict(base_url="https://model.example/v1", model="demo", api_key="private-1234")
    response = client.put("/api/tariff/settings/llm", json=payload)
    assert response.status_code == 200
    assert response.json()["api_key_masked"] == "****1234"
    assert "private" not in response.text
    response = client.put("/api/tariff/settings/llm", json={"base_url": payload["base_url"], "model": "new"})
    assert response.json()["api_key_masked"] == "****1234"
    route = respx_mock.post("https://model.example/v1/chat/completions").respond(json={"choices": [{"message": {"content": '{"ok": true}'}}]})
    assert client.post("/api/tariff/settings/llm/test").json()["ok"]
    assert route.calls[0].request.headers["Authorization"] == "Bearer private-1234"
    route.respond(403, text="denied")
    assert not client.post("/api/tariff/settings/llm/test").json()["ok"]
    assert client.get("/api/tariff/settings/llm").json()["last_test"]["ok"] is False
    assert client.delete("/api/tariff/settings/llm").json()["configured"] is False
    assert any(e["action"] == "LLM_SETTINGS_CHANGED" for e in client.get("/api/tariff/audit").json())
