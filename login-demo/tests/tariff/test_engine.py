import csv
import importlib.util
import json
from datetime import date

import pytest

from mariner.db.store import build_snapshot, database, seed, rows
from mariner.db.models import Impact
from mariner.engine.core import evaluate
from mariner.engine.service import create_run, carry_over_decisions
from mariner.settings import ROOT, Settings


def compare(actual, expected):
    for key, value in expected.items():
        assert actual[key] == (pytest.approx(value, abs=0.01) if isinstance(value, float) else value), key


def test_seed_parity_and_database(tmp_path):
    spec = importlib.util.spec_from_file_location("seed_engine", ROOT / "seed/engine/engine.py")
    original = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(original)
    rules = json.loads((ROOT / "seed/engine/rules.json").read_text(encoding="utf-8"))
    golden = json.loads((ROOT / "seed/golden/impacts.json").read_text(encoding="utf-8"))
    with (ROOT / "seed/engine/orders_sample.csv").open(encoding="utf-8") as f:
        orders = list(csv.DictReader(f))
    for order, expected in zip(orders, golden):
        actual = evaluate(order, rules, date(2026, 10, 31), None)
        compare(actual, original.evaluate(order, rules, date(2026, 10, 31), None))
        compare(actual, expected)
        if order["order_id"] == "O5":
            assert [v["rate"] for v in actual["layers"]] == [4.4, 25, 12.5]
            assert [v["duty_usd"] for v in actual["layers"]] == [2816, 16000, 8000]
            assert actual["timing_boundary_date"] == "2026-11-09"
            assert actual["timing_saving_usd"] == 16000
    settings = Settings(database_url=f"sqlite:///{tmp_path}/test.db", as_of_date="2026-10-31")
    engine, factory = database(settings.database_url)
    with factory.begin() as session:
        seed(session, str(settings.today))
        assert build_snapshot(session) == rules
        create_run(session, settings)
        by_id = {r["order_id"]: r for r in golden}
        for impact in rows(session, Impact):
            compare(impact.payload, by_id[impact.order_id])
    engine.dispose()


def test_carry_over():
    old = dict(profit_delta_usd=-16000, risk_level="红", decision="adopted")
    assert carry_over_decisions(old, dict(old)) == "adopted"
    assert carry_over_decisions(old, {**old, "profit_delta_usd": -15000}) == "pending"
