import csv
import json
from copy import deepcopy
from pathlib import Path

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from mariner.db.models import Base, Order, RuleVersion
from mariner.settings import ROOT


def database(url):
    if url.startswith("sqlite:///") and url != "sqlite:///:memory:":
        Path(url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(url, connect_args={"check_same_thread": False, "timeout": 30})
    Base.metadata.create_all(engine)
    return engine, sessionmaker(engine, expire_on_commit=False)


def rows(session, cls):
    return list(session.scalars(select(cls)))


def seed(session, today, sample_orders=True):
    if not session.scalar(select(RuleVersion)):
        rules = json.loads((ROOT / "seed/engine/rules.json").read_text(encoding="utf-8"))
        for kind, collection in rules.items():
            objects = ({kind: collection} if kind in ("meta", "fees") else
                       {p["id"]: p for p in collection} if kind == "programs" else collection)
            singular = {"programs": "program", "hts_profiles": "hts_profile", "watch_items": "watch_item"}.get(kind, kind)
            for key, payload in objects.items():
                session.add(RuleVersion(rule_kind=singular, rule_id=key, version=1, status="active",
                                        source="seed", business_date=today, payload=payload))
    if sample_orders and not session.scalar(select(Order)):
        with (ROOT / "seed/engine/orders_sample.csv").open(encoding="utf-8-sig") as f:
            for order in csv.DictReader(f):
                for key in NUMERIC_FIELDS:
                    order[key] = float(order[key])
                session.add(Order(id=order["order_id"], business_date=today, payload=order))
    session.flush()


NUMERIC_FIELDS = ["qty", "unit_price_usd", "purchase_cost_cny_per_unit", "other_cost_cny_per_unit",
                  "fx_cny_per_usd", "intl_freight_usd", "insurance_usd", "us_side_cost_usd",
                  "customs_value_usd", "baseline_duty_rate_pct", "target_margin_pct"]


def build_snapshot(session):
    snapshot = {"meta": {}, "programs": [], "fees": {}, "hts_profiles": {}, "watch_items": {}}
    versions = list(session.scalars(select(RuleVersion).order_by(RuleVersion.seq)))
    latest = {}
    for v in versions:
        latest[(v.rule_kind, v.rule_id)] = v
    for (kind, key), v in latest.items():
        if kind in ("meta", "fees"):
            snapshot[kind] = deepcopy(v.payload)
        elif kind == "program":
            snapshot["programs"].append(deepcopy(v.payload))
        else:
            snapshot[{"hts_profile": "hts_profiles", "watch_item": "watch_items"}[kind]][key] = deepcopy(v.payload)
    return snapshot
