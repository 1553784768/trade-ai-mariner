"""Send gate for the lighter follow-up campaign.

This script is the decision layer, NOT the transport. It answers one question:
"which of today's drafts is allowed to leave the building, and which is not".

Transport is the Gmail/Outlook connector that the Hermes cron run calls; there is
no SMTP client here and no credential handling in this file. If the connector is
unavailable the run stops and the drafts stay drafts.

Hard rules (each one blocks, none is advisory):
  * STOP file present            -> nothing sends today
  * AUTOSEND_ARMED file absent   -> nothing sends (default state is disarmed)
  * sender_profile.json incomplete -> nothing sends (CAN-SPAM needs a postal address)
  * tier must be A               -> B/C stay manual
  * one email per domain per day
  * a given (customer, step) is never sent twice, ever
  * daily cap (default 5)
  * body must carry the postal address and an opt-out line
  * platform / directory / competitor domains are refused

Usage:
    python scripts/send_gate.py preflight [--date YYYY-MM-DD] [--max 5]
    python scripts/send_gate.py record --date D --customer-id 1 --step 0 \
        --to a@b.com --subject "..." --message-id "<...>" --status sent
    python scripts/send_gate.py status
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTBOX = Path(os.environ.get("FOLLOWUP_OUTBOX") or (ROOT / "login-demo" / "data" / "outbox-lighters"))
PROFILE = OUTBOX / "sender_profile.json"
LEDGER = OUTBOX / "sent.json"
ARM = OUTBOX / "AUTOSEND_ARMED"
STOP = OUTBOX / "STOP"
AUDIT = OUTBOX / "audit.log"

ALLOWED_STEPS = {0, 3, 14, 30}
ALLOWED_TIERS = {"A"}
MAX_PER_DAY = 5
MAX_PER_DOMAIN_PER_DAY = 1
REQUIRED_PROFILE = ("sender_name", "sender_company", "sender_email", "postal_address")
OPT_OUT_MARKERS = ('reply "no"', "unsubscribe", "opt out", "opt-out")
BLOCKED_DOMAINS = {
    "alibaba.com", "made-in-china.com", "tradekey.com", "globalsources.com",
    "yellowpages.com", "yelp.com", "opencorporates.com", "linkedin.com",
    "facebook.com", "gmail.com", "yahoo.com", "hotmail.com", "outlook.com",
}
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[a-z]{2,}$", re.I)


def domain_of(addr: str) -> str:
    return (addr or "").rsplit("@", 1)[-1].strip().lower()


def load_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return default


def save_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def audit(event: dict) -> None:
    event = {"at": datetime.now().isoformat(timespec="seconds"), **event}
    with AUDIT.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(event, ensure_ascii=False) + "\n")


def profile_status() -> tuple[dict, list[str]]:
    prof = load_json(PROFILE, {})
    missing = [k for k in REQUIRED_PROFILE if not str(prof.get(k) or "").strip()]
    return prof, missing


def ledger_entries() -> list[dict]:
    return load_json(LEDGER, {"sent": []}).get("sent", [])


def already_sent(customer_id: str, step: int) -> bool:
    return any(
        str(e.get("customer_id")) == str(customer_id)
        and int(e.get("step", -1)) == int(step)
        and e.get("status") == "sent"
        for e in ledger_entries()
    )


def sent_on(day: str) -> list[dict]:
    return [e for e in ledger_entries() if e.get("date") == day and e.get("status") == "sent"]


def cmd_preflight(args) -> int:
    day = args.date or date.today().isoformat()
    prof, missing = profile_status()
    day_dir = OUTBOX / day
    manifest = load_json(day_dir / "manifest.json", {})
    plan = {"date": day, "generated_at": datetime.now().isoformat(timespec="seconds"),
            "aborted": None, "allowed": [], "blocked": []}

    abort = None
    if STOP.exists():
        abort = "STOP file present - campaign halted by user"
    elif not ARM.exists():
        abort = "AUTOSEND_ARMED missing - sending is disarmed"
    elif missing:
        abort = "sender_profile.json missing: " + ", ".join(missing)
    elif not (day_dir / "manifest.json").exists():
        abort = f"no manifest for {day} - run campaign_run.py draft first"
    elif not manifest.get("produced"):
        abort = "nothing produced today - nothing to send"

    if abort:
        plan["aborted"] = abort
        save_json(day_dir / "SENDS_TODAY.json", plan)
        audit({"event": "preflight_abort", "date": day, "reason": abort})
        print(f"ABORT: {abort}")
        print(f"-> nothing will be sent; drafts stay in {day_dir}")
        quiet = abort.startswith("nothing produced")
        return 0 if quiet else 3

    used_today = sent_on(day)
    domains_today = {domain_of(e.get("to", "")) for e in used_today}
    remaining_cap = max(0, args.max - len(used_today))
    postal = str(prof.get("postal_address") or "").strip()
    email_from = str(prof.get("sender_email") or "").strip()

    for item in manifest["produced"]:
        cid, step = str(item.get("customer_id")), int(item.get("step", -1))
        to = str(item.get("to") or "").strip()
        body = str(item.get("body") or "")
        dom = domain_of(to)
        reason = None
        if item.get("kind") != "email":
            reason = "non-email channel (LinkedIn) - manual only"
        elif str(item.get("tier")) not in ALLOWED_TIERS:
            reason = f"tier {item.get('tier')} - auto-send restricted to A"
        elif step not in ALLOWED_STEPS:
            reason = f"step {step} not in {sorted(ALLOWED_STEPS)}"
        elif already_sent(cid, step):
            reason = "already sent previously - never re-sent"
        elif "[SENDER INFO MISSING" in body:
            reason = "draft still carries the missing-signature placeholder"
        elif not EMAIL_RE.match(to):
            reason = f"recipient address not sendable: {to!r}"
        elif dom in BLOCKED_DOMAINS:
            reason = f"blocked domain: {dom}"
        elif dom == domain_of(email_from):
            reason = "recipient is our own domain"
        elif postal not in body:
            reason = "footer is missing the postal address"
        elif not any(m in body.lower() for m in OPT_OUT_MARKERS):
            reason = "footer is missing an opt-out line"
        elif dom in domains_today:
            reason = f"{dom} already contacted today (1/domain/day)"
        elif len(plan["allowed"]) >= remaining_cap:
            reason = f"daily cap reached ({args.max})"

        row = {
            "customer_id": cid, "customer": item.get("customer"), "step": step,
            "due": item.get("due"), "to": to, "domain": dom,
            "subject": item.get("subject"), "file": item.get("file"),
            "body": body, "kind": item.get("kind"),
        }
        if reason:
            plan["blocked"].append({**row, "reason": reason})
        else:
            plan["allowed"].append(row)
            domains_today.add(dom)

    save_json(day_dir / "SENDS_TODAY.json", plan)
    audit({"event": "preflight", "date": day,
           "allowed": len(plan["allowed"]), "blocked": len(plan["blocked"])})

    print(f"date={day} allowed={len(plan['allowed'])} blocked={len(plan['blocked'])} "
          f"cap={args.max} used_today={len(used_today)}")
    for r in plan["allowed"]:
        print(f"  SEND  D{r['step']:<2} {str(r['customer'])[:34]:<34} -> {r['to']}  | {r['subject']}")
    for r in plan["blocked"]:
        print(f"  HOLD  D{r['step']:<2} {str(r['customer'])[:34]:<34} -> {r['to']}  | {r['reason']}")
    print(f"plan: {(day_dir / 'SENDS_TODAY.json')}")
    return 0


def cmd_record(args) -> int:
    ledger = load_json(LEDGER, {"sent": []})
    entry = {
        "date": args.date, "customer_id": str(args.customer_id), "customer": args.customer,
        "step": int(args.step), "to": args.to, "domain": domain_of(args.to),
        "subject": args.subject, "message_id": args.message_id,
        "status": args.status, "error": args.error,
        "at": datetime.now().isoformat(timespec="seconds"),
    }
    ledger["sent"].append(entry)
    save_json(LEDGER, ledger)
    audit({"event": "record", **entry})
    print(f"recorded {args.status}: customer={args.customer_id} step={args.step} to={args.to} "
          f"msgid={args.message_id or '-'}")
    if args.status == "sent" and not args.message_id:
        print("WARNING: no message_id - a 'sent' record without a provider id is unverified")
    return 0


def cmd_status(args) -> int:
    entries = ledger_entries()
    sent = [e for e in entries if e.get("status") == "sent"]
    failed = [e for e in entries if e.get("status") != "sent"]
    print(f"armed={ARM.exists()} stop={STOP.exists()} sent={len(sent)} failed={len(failed)}")
    _, missing = profile_status()
    print(f"profile={'ok' if not missing else 'INCOMPLETE: ' + ', '.join(missing)}")
    per_day: dict[str, int] = {}
    for e in sent:
        per_day[e["date"]] = per_day.get(e["date"], 0) + 1
    for d in sorted(per_day):
        print(f"  {d}: {per_day[d]}")
    for e in failed[-10:]:
        print(f"  FAIL {e['date']} D{e['step']} {e.get('to')} {e.get('error') or ''}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="command", required=True)
    p = sub.add_parser("preflight")
    p.add_argument("--date")
    p.add_argument("--max", type=int, default=MAX_PER_DAY)
    p.set_defaults(func=cmd_preflight)
    r = sub.add_parser("record")
    r.add_argument("--date", required=True)
    r.add_argument("--customer-id", required=True)
    r.add_argument("--step", required=True)
    r.add_argument("--to", required=True)
    r.add_argument("--subject", default="")
    r.add_argument("--customer", default="")
    r.add_argument("--message-id", default="")
    r.add_argument("--status", default="sent", choices=["sent", "failed"])
    r.add_argument("--error", default="")
    r.set_defaults(func=cmd_record)
    s = sub.add_parser("status")
    s.set_defaults(func=cmd_status)
    args = ap.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
