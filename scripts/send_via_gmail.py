"""Gmail transport for the lighter follow-up campaign (OAuth, no SMTP, no passwords).

Reads the send gate's verdict (SENDS_TODAY.json) and sends only what the gate
allowed. Every send is written back into the ledger with the provider message id,
so a later run can never repeat it.

Auth is Hermes-managed Google OAuth: the token lives at
%LOCALAPPDATA%/hermes/google_token.json and is produced by the google-workspace
skill's setup.py. This file never sees a password and contains no smtplib import.

Usage:
    python scripts/send_via_gmail.py --check
    python scripts/send_via_gmail.py --dry-run
    python scripts/send_via_gmail.py --date 2026-11-02
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import date, datetime
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import send_gate  # noqa: E402  (decision layer, imported so rules stay in one place)

OUTBOX = send_gate.OUTBOX
HERMES_HOME = Path(os.environ.get("HERMES_HOME") or (Path.home() / ".hermes"))
if not (HERMES_HOME / "skills").exists():
    local = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local")) / "hermes"
    if (local / "skills").exists():
        HERMES_HOME = local
GOOGLE_API = Path(
    os.environ.get("GOOGLE_API_SCRIPT")
    or (HERMES_HOME / "skills" / "productivity" / "google-workspace" / "scripts" / "google_api.py")
)


def _run(parts: list[str], timeout: int = 120) -> subprocess.CompletedProcess:
    # -W ignore: google-api-core prints a Python-version FutureWarning on stderr that would
    # otherwise be mistaken for the real auth error.
    return subprocess.run([sys.executable, "-W", "ignore", *parts],
                          capture_output=True, text=True, encoding="utf-8", timeout=timeout)


def check_auth() -> tuple[bool, str]:
    if not GOOGLE_API.exists():
        return False, f"google_api.py not found at {GOOGLE_API}"
    proc = _run([str(GOOGLE_API), "gmail", "labels"], timeout=90)
    if proc.returncode == 0 and '"id"' in proc.stdout:
        return True, "authenticated"
    raw = (proc.stderr or "") + (proc.stdout or "")
    keys = ("NOT_AUTHENTICATED", "REFRESH_FAILED", "Insufficient Permission",
            "invalid_grant", "No token at")
    hit = [ln.strip() for ln in raw.splitlines() if any(k in ln for k in keys)]
    detail = hit[-1] if hit else " ".join(raw.split())[:240]
    return False, detail[:300]



def send_one(to: str, subject: str, body: str) -> tuple[bool, str, str]:
    """Return (ok, message_id, error)."""
    proc = _run([str(GOOGLE_API), "gmail", "send",
                 "--to", to, "--subject", subject, "--body", body], timeout=180)
    out = (proc.stdout or "").strip()
    err = (proc.stderr or "").strip()
    if proc.returncode == 0:
        try:
            payload = json.loads(out[out.index("{"):out.rindex("}") + 1])
        except (ValueError, json.JSONDecodeError):
            return False, "", f"unparseable provider output: {out[:200]}"
        if payload.get("status") == "sent" and payload.get("id"):
            return True, str(payload["id"]), ""
        return False, "", f"provider said: {payload}"
    return False, "", " ".join((err or out).split())[:400]


def record(day: str, item: dict, status: str, message_id: str, error: str) -> None:
    send_gate.cmd_record(SimpleNamespace(
        date=day, customer_id=str(item.get("customer_id")), customer=str(item.get("customer")),
        step=str(item.get("step")), to=str(item.get("to")), subject=str(item.get("subject")),
        message_id=message_id or "", status=status, error=error or "",
    ))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    if args.check:
        ok, detail = check_auth()
        print(("google_ready " if ok else "google_missing ") + detail)
        return 0 if ok else 2

    day = args.date or date.today().isoformat()
    plan_path = OUTBOX / day / "SENDS_TODAY.json"
    if not plan_path.exists():
        print(f"no send plan for {day} - run: python scripts/send_gate.py preflight --date {day}")
        return 1
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    if plan.get("aborted"):
        print(f"plan for {day} is ABORTED: {plan['aborted']}")
        print("nothing sent")
        return 3

    allowed = plan.get("allowed") or []
    print(f"date={day} gate_allowed={len(allowed)} blocked={len(plan.get('blocked') or [])}")
    if not allowed:
        print("nothing to send")
        return 0

    if not args.dry_run:
        ok, detail = check_auth()
        if not ok:
            print(f"google transport not ready: {detail}")
            print("-> nothing sent; plan kept so `campaign_run.py send` can be re-run after auth")
            return 2

    sent = failed = 0
    lines = [f"# Send run {day} ({datetime.now().isoformat(timespec='seconds')})", ""]
    for item in allowed:
        to, subject, body = str(item.get("to")), str(item.get("subject")), str(item.get("body"))
        if args.dry_run:
            print(f"  DRY   D{item.get('step')} {str(item.get('customer'))[:32]:<32} -> {to} | {subject}")
            continue
        ok, mid, err = send_one(to, subject, body)
        if ok:
            sent += 1
            record(day, item, "sent", mid, "")
            print(f"  SENT  D{item.get('step')} {str(item.get('customer'))[:32]:<32} -> {to}  id={mid}")
            lines.append(f"- SENT D{item.get('step')} {item.get('customer')} -> {to} id={mid}")
        else:
            failed += 1
            record(day, item, "failed", "", err)
            print(f"  FAIL  D{item.get('step')} {str(item.get('customer'))[:32]:<32} -> {to}  {err[:120]}")
            lines.append(f"- FAIL D{item.get('step')} {item.get('customer')} -> {to} :: {err[:200]}")

    if not args.dry_run:
        report = OUTBOX / day / "SEND_RESULTS.md"
        report.write_text("\n".join(lines) + f"\n\nsent={sent} failed={failed}\n", encoding="utf-8")
        print(f"sent={sent} failed={failed} report={report}")
        send_gate.audit({"event": "gmail_transport", "date": day, "sent": sent, "failed": failed})
    return 0 if failed == 0 else 4


if __name__ == "__main__":
    sys.exit(main())
