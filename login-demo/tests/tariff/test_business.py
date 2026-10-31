import csv
import io
from concurrent.futures import ThreadPoolExecutor

import pytest

from mariner.audit.service import audit_hash
from mariner.settings import ROOT


def test_counts_details_and_decisions(client):
    assert client.get("/api/tariff/meta").json()["counts"] == dict(pending=8, red=1, orange=1, yellow=2, green=4, urgent=2, drafts_pending=0, decisions_total=0)
    for query, ids in [("", "O5 O1 O3 O6 O4 O2 O8 O7"), ("?incoterm_group=ddp", "O5 O1 O3 O4 O8 O7"),
                       ("?incoterm_group=non_ddp", "O6 O2"), ("?risk=红,橙&decision=pending", "O5 O6")]:
        assert [r["order_id"] for r in client.get("/api/tariff/impacts"+query).json()] == ids.split()
    o5 = client.get("/api/tariff/impacts/O5").json()
    assert o5["countdown"] == dict(kind="rule_boundary", days=9)
    assert len(o5["actions"]) == 4
    assert client.get("/api/tariff/impacts/O1").json()["countdown"] == dict(kind="entry", days=18)
    o6 = client.get("/api/tariff/impacts/O6").json()
    assert next(c for c in o6["checks"] if c["key"] == "baseline_match") == dict(key="baseline_match", status="warn", value="30.3% / 40.3%")
    o8 = client.get("/api/tariff/impacts/O8").json()
    assert [layer["rate_pct"] for layer in o8["layers"]] == [5.3, 25]
    assert any("适用在途豁免 9903.05.85" in f for f in o8["flags"])
    assert client.get("/api/tariff/impacts/O7").json()["potential_refund_usd"] == 6000
    watches = client.get("/api/tariff/watch-items").json()
    assert [(w["id"], w["severity"], w["impact_usd"], w["affected_order_ids"]) for w in watches] == [
        ("W_301_EXCLUSION_EXPIRY", "红", -16000, ["O5"]), ("W_232_ROBOTICS", "黄", None, ["O2"]), ("W_301_EXCESS_CAPACITY", "黄", None, ["O1"])]
    for kind in ("adopted", "needs_detail"):
        assert client.post("/api/tariff/impacts/O5/decision", json={"decision": kind, **({"action_indices": [0, 2]} if kind == "adopted" else {"note": "Verify entry date"})}).status_code == 200
        assert client.get("/api/tariff/impacts/O5").json()["decision"] == kind
    assert len(client.get("/api/tariff/decisions").json()) == 2
    new_run = client.post("/api/tariff/runs").json()
    assert new_run["id"] != o5["run_id"]
    assert client.get("/api/tariff/impacts/O5").json()["decision"] == "needs_detail"
    events = list(reversed(client.get("/api/tariff/audit").json()))
    previous = "0" * 64
    for event in events:
        assert event["prev_hash"] == previous
        assert event["hash"] == audit_hash(event)
        previous = event["hash"]


def csv_data(mutation=None):
    text = (ROOT / "seed/engine/orders_sample.csv").read_text(encoding="utf-8")
    records = list(csv.DictReader(io.StringIO(text)))
    headers = list(records[0])
    if mutation:
        mutation(records, headers)
    output = io.StringIO()
    writer = csv.DictWriter(output, headers, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(records)
    return output.getvalue().encode("utf-8-sig")


def test_import(client):
    result = client.post("/api/tariff/orders/import", files={"file": ("orders.csv", csv_data())}).json()
    assert (result["imported"], result["updated"]) == (0, 8)
    result = client.post("/api/tariff/orders/import", files={"file": ("orders.csv", csv_data(lambda r, h: r[0].update(order_id="NEW")))}).json()
    assert result["imported"] == 1
    assert any(e["action"] == "ORDERS_IMPORTED" for e in client.get("/api/tariff/audit").json())


def test_concurrent_decisions_preserve_audit_chain(client):
    def submit(number):
        return client.post(f"/api/tariff/impacts/O{number}/decision", json={"decision": "dismissed"})
    with ThreadPoolExecutor(max_workers=4) as pool:
        responses = list(pool.map(submit, range(1, 9)))
    assert all(r.status_code == 200 for r in responses)
    previous = "0" * 64
    for event in reversed(client.get("/api/tariff/audit").json()):
        assert event["prev_hash"] == previous
        assert event["hash"] == audit_hash(event)
        previous = event["hash"]


@pytest.mark.parametrize("mutation", [lambda r, h: h.remove("qty"), lambda r, h: r[0].update(origin="XX"),
    lambda r, h: r[0].update(entry_date="2026/11/18"), lambda r, h: r[0].update(entry_date="2000-01-01"),
    lambda r, h: r[0].update(qty="0"), lambda r, h: r[1].update(order_id=r[0]["order_id"]),
    lambda r, h: r[0].update(hts10="unknown")])
def test_atomic_validation(client, mutation):
    before = client.get("/api/tariff/orders").json()
    response = client.post("/api/tariff/orders/import", files={"file": ("orders.csv", csv_data(mutation))})
    assert response.status_code == 422
    assert client.get("/api/tariff/orders").json() == before
    for error in response.json()["error"]["details"]:
        if error["field"] == "hts10":
            for code in client.get("/api/tariff/rules/snapshot").json()["hts_profiles"]:
                assert code in error["message"]
