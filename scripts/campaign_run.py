"""One entry point for the daily lighter follow-up run.

    python scripts/campaign_run.py draft             # render today's drafts + gate verdict
    python scripts/campaign_run.py send              # send what the gate allowed (needs auth)
    python scripts/campaign_run.py status            # state, auth, ledger in one screen
    python scripts/campaign_run.py reconcile         # show steps consumed but never sent
    python scripts/campaign_run.py reconcile --apply # release those steps so they re-render

`draft` never sends. `send` never re-renders: it acts on the manifest `draft`
already produced for the same day, so a failed send cannot silently skip a step.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import followup_engine as engine  # noqa: E402
import send_gate  # noqa: E402
import send_via_gmail as transport  # noqa: E402

OUTBOX = send_gate.OUTBOX


def _py(script: str, *args: str) -> int:
    proc = subprocess.run([sys.executable, str(ROOT / "scripts" / script), *args],
                          capture_output=True, text=True, encoding="utf-8")
    sys.stdout.write(proc.stdout)
    if proc.returncode != 0 and proc.stderr:
        sys.stdout.write(proc.stderr)
    return proc.returncode


def cmd_draft(args) -> int:
    day = args.date or date.today().isoformat()
    rc = _py("followup_engine.py", "run", "--today", day)
    if rc != 0:
        return rc
    print()
    return _py("send_gate.py", "preflight", "--date", day, "--max", str(args.max))


def cmd_send(args) -> int:
    day = args.date or date.today().isoformat()
    return _py("send_via_gmail.py", *(["--date", day] + (["--dry-run"] if args.dry_run else [])))


def cmd_status(args) -> int:
    print("=== sequence ===")
    _py("followup_engine.py", "status")
    print("=== gate ===")
    _py("send_gate.py", "status")
    print("=== transport ===")
    ok, detail = transport.check_auth()
    print(("google_ready " if ok else "google_missing ") + detail)
    print(f"armed={send_gate.ARM.exists()} stop={send_gate.STOP.exists()} outbox={OUTBOX}")
    return 0


def cmd_reconcile(args) -> int:
    """Find steps marked done whose email never actually left, and release them."""
    state = engine.load_state()
    released = []
    for day_dir in sorted(p for p in OUTBOX.iterdir() if p.is_dir() and p.name[:2] == "20"):
        manifest = day_dir / "manifest.json"
        if not manifest.exists():
            continue
        try:
            produced = json.loads(manifest.read_text(encoding="utf-8")).get("produced") or []
        except json.JSONDecodeError:
            continue
        for item in produced:
            if item.get("kind") != "email":
                continue
            cid, step = str(item.get("customer_id")), int(item.get("step", -1))
            if send_gate.already_sent(cid, step):
                continue
            failed = [e for e in send_gate.ledger_entries()
                      if str(e.get("customer_id")) == cid and int(e.get("step", -1)) == step
                      and e.get("status") != "sent"]
            if failed:
                note = "recorded failure"
            else:
                note = "produced but never attempted"
            released.append({"customer_id": cid, "customer": item.get("customer"),
                             "step": step, "date": day_dir.name, "note": note})

    if not released:
        print("nothing to reconcile - every produced email has a sent record")
        return 0

    print(f"{len(released)} step(s) consumed without a send:")
    for r in released:
        print(f"  D{r['step']:<2} {str(r['customer'])[:34]:<34} produced {r['date']}  ({r['note']})")

    if not args.apply:
        print("\n(dry run - pass --apply to release these steps so the next `draft` re-renders them)")
        return 0

    for r in released:
        rec = state["enrolled"].get(r["customer_id"])
        if rec and r["step"] in rec["done"]:
            rec["done"].remove(r["step"])
    engine.save_state(state)
    send_gate.audit({"event": "reconcile", "released": released})
    print(f"\nreleased {len(released)} step(s); next `draft` run will re-produce them")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["draft", "send", "status", "reconcile"])
    ap.add_argument("--date")
    ap.add_argument("--max", type=int, default=send_gate.MAX_PER_DAY)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    return {"draft": cmd_draft, "send": cmd_send,
            "status": cmd_status, "reconcile": cmd_reconcile}[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
