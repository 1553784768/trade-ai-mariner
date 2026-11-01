"""A draft that cannot be sent must not consume its follow-up step.

Regression: ``cmd_run`` appended the step to ``rec["done"]`` at render time, before
looking at whether ``sender_profile.json`` was complete. Every draft rendered without
a signature therefore carried the ``[SENDER INFO MISSING]`` placeholder, the send gate
refused it, and the step was marked consumed - so the real, sendable draft was never
rendered again and Day 0 was lost for the whole campaign.

The rule now: rendering a preview is free, consuming the step requires a complete
sender profile.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
ENGINE = ROOT / "scripts" / "followup_engine.py"

PROFILE = {
    "sender_name": "Test Name",
    "sender_company": "Test Co Ltd",
    "sender_phone": "+1 000 000 0000",
    "sender_email": "sender@example.com",
    "postal_address": "1 Test St, Testville, TS 00000, USA",
    "product_kind": "lighters",
}
PLACEHOLDER = "[SENDER INFO MISSING"


def _seed_state(outbox: Path, first_touch: str) -> None:
    outbox.mkdir(parents=True, exist_ok=True)
    (outbox / "sequence_state.json").write_text(
        json.dumps({
            "enrolled": {
                "1": {
                    "name": "Test Buyer",
                    "email": "buyer@example.com",
                    "tier": "A",
                    "first_touch": first_touch,
                    "done": [],
                }
            },
            "runs": [],
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _run(outbox: Path, *args: str) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env["FOLLOWUP_OUTBOX"] = str(outbox)
    return subprocess.run([sys.executable, str(ENGINE), *args],
                          capture_output=True, text=True, encoding="utf-8", env=env)


def _state(outbox: Path) -> dict:
    return json.loads((outbox / "sequence_state.json").read_text(encoding="utf-8"))


def _only_draft(outbox: Path, day: str) -> str:
    drafts = sorted((outbox / day).glob("Test_Buyer_day0*.eml"))
    assert drafts, f"no Day 0 draft rendered in {outbox / day}"
    return drafts[0].read_text(encoding="utf-8")


def test_draft_without_identity_does_not_consume_the_step(tmp_path):
    outbox = tmp_path / "outbox"
    day = date.today().isoformat()
    _seed_state(outbox, day)

    proc = _run(outbox, "run", "--today", day)
    assert proc.returncode == 0, proc.stderr or proc.stdout

    assert PLACEHOLDER in _only_draft(outbox, day)
    assert _state(outbox)["enrolled"]["1"]["done"] == [], "a preview draft must not burn the step"


def test_completing_the_profile_rerenders_the_same_step(tmp_path):
    outbox = tmp_path / "outbox"
    day = date.today().isoformat()
    _seed_state(outbox, day)

    assert _run(outbox, "run", "--today", day).returncode == 0
    (outbox / "sender_profile.json").write_text(json.dumps(PROFILE, indent=2), encoding="utf-8")

    # Same day, same step: the second run must render it again, now sendable.
    assert _run(outbox, "run", "--today", day).returncode == 0
    draft = _only_draft(outbox, day)

    assert PLACEHOLDER not in draft
    assert PROFILE["postal_address"] in draft, "gate requires the postal address in the body"
    assert PROFILE["sender_company"] in draft
    assert _state(outbox)["enrolled"]["1"]["done"] == [0]


def test_step_is_not_rendered_before_it_is_due(tmp_path):
    outbox = tmp_path / "outbox"
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    _seed_state(outbox, tomorrow)
    (outbox / "sender_profile.json").write_text(json.dumps(PROFILE, indent=2), encoding="utf-8")

    assert _run(outbox, "run", "--today", date.today().isoformat()).returncode == 0

    assert not list(outbox.glob(f"{date.today().isoformat()}/Test_Buyer_day*.eml"))
    assert _state(outbox)["enrolled"]["1"]["done"] == []


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
