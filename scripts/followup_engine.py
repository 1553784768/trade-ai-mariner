"""Follow-up sequence engine for the lighter campaign (draft-only).

Reads customers from the app database, tracks a per-customer first-touch date, and
materialises the Day 1 / 3 / 7 / 14 / 30 follow-up step as a ready-to-send .eml file
(or a LinkedIn note as .txt) inside an outbox folder.

This script NEVER sends anything. There is no SMTP, no API mail call, no credential
handling. Each run only writes files plus a digest; a human opens the .eml and hits
send from their own mailbox.

Usage:
    python scripts/followup_engine.py enroll --start 2026-11-02
    python scripts/followup_engine.py run
    python scripts/followup_engine.py status
    python scripts/followup_engine.py lint
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from datetime import date, datetime, timedelta
from email.message import EmailMessage
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTBOX = Path(os.environ.get("FOLLOWUP_OUTBOX") or (ROOT / "login-demo" / "data" / "outbox-lighters"))
DB_DEFAULT = ROOT / "login-demo" / "data" / "accounts.sqlite3"
STATE_FILE = OUTBOX / "sequence_state.json"
SENDER_FILE = OUTBOX / "sender_profile.json"

OFFSETS = [0, 3, 7, 14, 30]

SENDER_TEMPLATE = {
    "sender_name": "",
    "sender_company": "",
    "sender_phone": "",
    "sender_email": "",
    "postal_address": "",
    "product_kind": "lighters",
}

SIGNATURE_NOTE = (
    "[SENDER INFO MISSING - fill sender_profile.json "
    "(name / company / phone / email / postal_address) then re-run: run]"
)

# ---------------------------------------------------------------- copy (English)

DAY1 = {
    "Sunshine Wholesale": {
        "to_name": "Sam",
        "subject": "Tray pricing for Sunshine lighters",
        "alts": [
            "Question about your tray quantities",
            "Where Sunshine's lighter cost sits",
            "Sunshine Wholesale - lighter sourcing",
        ],
        "body": """Hi Sam,

You sell by the tray and print on a good part of the range - so the number that decides your margin is landed cost per tray, not per piece.

We're a lighter factory in China, quoting to US importers.

Tell me the tray pack count on the four or five SKUs you move hardest, and which of them you print in-house, and I'll come back with tray-level pricing plus the printable area each body allows.

If a 16 CFR 1210 test report belongs in your vendor file, say so and it travels with the sample.

Worth a look?""",
    },
    "AFG Distribution": {
        "to_name": "Shane",
        "subject": "Lighter vendor file for AFG",
        "alts": [
            "AFG vendor application follow-up",
            "Hazmat paperwork on lighters",
            "Question about AFG's lighter buying",
        ],
        "body": """Hi Shane,

AFG carries a very deep catalogue and charges a hazmat fee on lighters - which tells me a vendor conversation here starts with paperwork, not with price.

We're a lighter factory in China. What your product team would get:

- UN1057 shipping documents prepared on our side, so receiving isn't chasing them
- Blank and printed bodies from one production line, not two vendors
- A 16 CFR 1210 test report where your vendor file requires one

I'm filing the vendor application separately. If purchasing is the faster route for lighters, tell me who owns the category and I'll go direct.""",
    },
    "Simply Lighters": {
        "to_name": "Brian",
        "subject": "Body consistency for your print jobs",
        "alts": [
            "Printable area on your lighter bodies",
            "Question about your blank supply",
            "Small print area - body choice",
        ],
        "body": """Hi Brian,

Your about page names the two things that decide a lighter job: choosing the right body, and preparing artwork for a small print area.

Both get easier when the body is the same shipment after shipment. We're a lighter factory in China, supplying bodies to printers and importers in the US.

What I'd send:

- Printable area and curvature, dimensioned, for each body we make
- A blank sample set so your team can test registration before quoting a customer
- Colour held batch to batch, not only inside one run

Which body types do you buy most? I'll match them.""",
    },
    "Smoke Promos": {
        "to_name": "James",
        "subject": "Restocking the bodies you sell most",
        "alts": [
            "Smoke Promos lighter restock",
            "Ten-day promise - body supply",
        ],
        "body": """Hi James,

Straight question: who supplies your lighter bodies now, and how often does a restock land late?

We're a lighter factory in China, and the reason shops your size talk to us is restock reliability rather than price - printed and blank off one line, UN1057 documents prepared before shipment.

Tell me your two fastest-moving bodies and I'll send specs and a blank sample.""",
    },
}

GENERIC_DAY1 = {
    "to_name": "there",
    "subject": "Lighter sourcing question",
    "alts": ["Question on your lighter supply", "Lighters direct from the factory"],
    "body": """Hi,

Quick question about your lighter supply: are the bodies you sell bought direct from a factory, or through a US brand?

We're a lighter factory in China, supplying importers and distributors in the US - blank and printed bodies off one line, UN1057 documents prepared before shipment.

If it's worth a look, tell me the two or three bodies you move most and I'll send specs.""",
}

DAY3 = """Hi {first},

Just making sure this didn't get buried - I know {company}'s inbox isn't short of supplier notes.

Easier version: tell me the two bodies you buy most and I'll send the specs plus a blank sample, no quote needed yet.

If now isn't the time, say so and I'll stop chasing."""

DAY7_LINKEDIN = (
    "Hi {first}! I supply lighter bodies to US importers - blank and printed off "
    "one line, documents sorted before shipment. Open to connecting?"
)

DAY14 = """Hi {first},

One question, since it decides whether a second supplier is even useful to you:

when a lighter order lands at {company}, is the bigger problem landed cost per unit, or the body being different from the one you approved?

We're a factory in China and we get asked for both. If cost is the issue I'll send tray-level numbers on your top SKUs; if consistency is the issue I'll send dimensioned drawings and a blank sample set.

Which one is it?"""

DAY30 = """Hi {first},

I've written a few times and heard nothing - which is a perfectly good answer, so I'll close the file on my side.

If your China sourcing ever needs a second quote on lighter bodies, blank or printed, the door stays open. Just reply to this address and I'll pick it up.

Best of luck with the season."""

FOOTER = """--
{sender_name}
{sender_company} | {sender_phone}
{sender_email}
{postal_address}

If this isn't relevant, reply "no" and I won't contact you again."""


# ---------------------------------------------------------------- helpers

def load_sender() -> dict:
    OUTBOX.mkdir(parents=True, exist_ok=True)
    if not SENDER_FILE.exists():
        SENDER_FILE.write_text(json.dumps(SENDER_TEMPLATE, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        data = json.loads(SENDER_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        data = dict(SENDER_TEMPLATE)
    merged = dict(SENDER_TEMPLATE)
    merged.update({k: v for k, v in data.items() if k in SENDER_TEMPLATE})
    return merged


def sender_ready(sender: dict) -> bool:
    return all(sender.get(k) for k in ("sender_name", "sender_company", "postal_address", "sender_email"))


def load_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    return {"enrolled": {}, "runs": []}


def save_state(state: dict) -> None:
    OUTBOX.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def read_customers(db: Path) -> list[dict]:
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT id,name,contact,email,title,country,tier,buyer_type,main_category "
        "FROM customers WHERE tier IN ('A','B') AND email IS NOT NULL AND email<>'' "
        "ORDER BY CASE tier WHEN 'A' THEN 0 ELSE 1 END, id"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def copy_for(customer: dict) -> dict:
    """Resolve tailored copy, tolerating the name suffixes the CRM stores.

    Customer rows carry suffixes like "Simply Lighters (Simplylighters)", so an
    exact dict lookup silently falls back to the generic letter. Match on a
    normalised prefix instead, and fall back only when nothing matches.
    """
    name = (customer.get("name") or "").strip()
    if name in DAY1:
        return DAY1[name]
    lowered = name.lower()
    for key, copy in DAY1.items():
        k = key.lower()
        if lowered.startswith(k) or k in lowered:
            return copy
    return GENERIC_DAY1


def footer(sender: dict) -> str:
    """Signature + CAN-SPAM footer. Never emit an empty signature block."""
    if sender_ready(sender):
        return FOOTER.format(**sender)
    return "--\n" + SIGNATURE_NOTE + '\n\nIf this isn\'t relevant, reply "no" and I won\'t contact you again.'


def render(step: int, customer: dict, sender: dict) -> tuple[str, str, str]:
    """Return (kind, subject, body) for a step."""
    first = copy_for(customer).get("to_name", "there")
    company = customer["name"]
    if step == 0:
        c = copy_for(customer)
        body = c["body"] + "\n\n" + footer(sender)
        return "email", c["subject"], body
    if step == 3:
        subj = "Re: " + copy_for(customer)["subject"]
        body = DAY3.format(first=first, company=company) + "\n\n" + footer(sender)
        return "email", subj, body
    if step == 7:
        return "linkedin", "LinkedIn connection note", DAY7_LINKEDIN.format(first=first, company=company)
    if step == 14:
        body = DAY14.format(first=first, company=company) + "\n\n" + footer(sender)
        return "email", "Landed cost or consistency?", body
    body = DAY30.format(first=first, company=company) + "\n\n" + footer(sender)
    return "email", "Closing the file", body


def safe(name: str) -> str:
    return "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in name)


def rel(path: Path) -> str:
    """Display path relative to the repo when possible, else absolute."""
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def write_eml(path: Path, sender: dict, to_addr: str, subject: str, body: str) -> None:
    msg = EmailMessage()
    msg["From"] = f"{sender['sender_name']} <{sender['sender_email']}>" if sender["sender_name"] else "REPLACE-ME <you@example.com>"
    msg["To"] = to_addr
    msg["Subject"] = subject
    msg.set_content(body)
    path.write_bytes(msg.as_bytes())


SPAM_WORDS = [
    "free", "guaranteed", "no obligation", "100%", "winner", "limited time",
    "act now", "urgent", "as seen on", "best price", "lowest price", "million",
    "cash bonus", "extra income", "increase your",
]


def lint(subject: str, body: str) -> list[str]:
    issues = []
    for w in SPAM_WORDS:
        if w in subject.lower():
            issues.append(f"SPAM word in subject: {w}")
        if w in body.lower():
            issues.append(f"SPAM word in body: {w}")
    if any(ch.isupper() for ch in subject if ch.isalpha()) and subject.upper() == subject:
        issues.append("subject is ALL CAPS")
    if "!" in subject:
        issues.append("exclamation mark in subject")
    if len(subject) > 60:
        issues.append(f"subject is {len(subject)} chars (>60)")
    return issues


# ---------------------------------------------------------------- commands

def cmd_enroll(args) -> int:
    sender = load_sender()
    state = load_state()
    customers = read_customers(Path(args.db))
    start = args.start or date.today().isoformat()
    added = 0
    for c in customers:
        key = str(c["id"])
        if key in state["enrolled"]:
            continue
        state["enrolled"][key] = {
            "name": c["name"],
            "email": c["email"],
            "tier": c["tier"],
            "first_touch": start,
            "done": [],
        }
        added += 1
    save_state(state)
    print(f"enrolled {added} new customer(s); total {len(state['enrolled'])}; first touch {start}")
    if not sender_ready(sender):
        print("WARNING: sender_profile.json incomplete -> drafts will be marked NEEDS-INFO")
    return 0


def cmd_run(args) -> int:
    sender = load_sender()
    ready = sender_ready(sender)
    state = load_state()
    if not state["enrolled"]:
        print("no customers enrolled - run: enroll --start YYYY-MM-DD")
        return 1
    today = date.fromisoformat(args.today) if args.today else date.today()
    day_dir = OUTBOX / today.isoformat()
    day_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = day_dir / "manifest.json"
    # A second run on the same day must not erase the first run's manifest: the send
    # gate reads that file, and a wiped manifest silently unsends the day's batch.
    carried: list[dict] = []
    if manifest_path.exists():
        try:
            carried = json.loads(manifest_path.read_text(encoding="utf-8")).get("produced") or []
        except json.JSONDecodeError:
            carried = []
    produced = []

    for key, rec in state["enrolled"].items():
        first = date.fromisoformat(rec["first_touch"])
        for step in OFFSETS:
            if step in rec["done"]:
                continue
            due = first + timedelta(days=step)
            if due > today:
                continue
            kind, subject, body = render(step, rec, sender)
            issues = lint(subject, body) if kind == "email" else []
            suffix = "" if ready else "_NEEDS-INFO"
            fname = f"{safe(rec['name'])}_day{step}{suffix}." + ("eml" if kind == "email" else "txt")
            path = day_dir / fname
            if kind == "email":
                write_eml(path, sender, rec["email"], subject, body)
            else:
                path.write_text(f"LinkedIn note for {rec['email']}\nSubject: {subject}\n\n{body}\n", encoding="utf-8")
            # Only a draft that could actually be sent consumes the step. Without a
            # complete sender_profile the body still carries the [SENDER INFO MISSING]
            # signature, the gate refuses it, and burning the step here would mean the
            # real draft is never rendered again - the campaign dies on Day 0 forever.
            if ready:
                rec["done"].append(step)
            produced.append({
                "customer": rec["name"], "customer_id": key, "step": step, "due": due.isoformat(),
                "kind": kind, "subject": subject, "file": rel(path),
                "to": rec["email"], "tier": rec.get("tier"), "lint": issues, "body": body,
            })
    state["runs"].append({"date": today.isoformat(), "produced": len(produced)})
    state["runs"] = state["runs"][-50:]
    save_state(state)

    merged: dict[tuple[str, int], dict] = {}
    for item in carried + produced:
        merged[(str(item.get("customer_id")), int(item.get("step", -1)))] = item
    day_items = sorted(merged.values(),
                       key=lambda x: (int(x.get("step", 0)), str(x.get("customer") or "")))

    digest = day_dir / "DIGEST.md"
    lines = [f"# Follow-up digest {today.isoformat()}", ""]
    if not ready:
        lines += ["> 发件人信息未填（sender_profile.json），以下均为草稿，签名与 From 需补齐。", ""]
    if not day_items:
        lines.append("今天没有到期步骤。")
    for p in day_items:
        lines += [
            f"## {p['customer']} - Day {p['step']} ({p['kind']})",
            f"- To: {p['to']}",
            f"- Subject: {p['subject']}",
            f"- File: `{p['file']}`",
        ]
        if p["lint"]:
            lines.append(f"- LINT: {'; '.join(p['lint'])}")
        lines.append("")
    digest.write_text("\n".join(lines), encoding="utf-8")

    # One copy-paste sheet per day so a send run needs no file hunting.
    batch = day_dir / "SEND_BATCH.txt"
    email_count = sum(1 for p in day_items if p["kind"] == "email")
    blocks = [
        f"今日待发 {today.isoformat()} — 邮件 {email_count} 封，另有 "
        f"{len(day_items) - email_count} 条非邮件渠道",
        "用法：逐块复制主题与正文，用你自己的邮箱发出。本文件只排版，不会自动发送。",
        "",
    ]
    if not ready:
        blocks += ["[注意] sender_profile.json 未填：From 与签名需你自己补。", ""]
    for i, p in enumerate(day_items, 1):
        if p["kind"] != "email":
            blocks += [
                f"--- {i}. {p['customer']} / Day {p['step']} / LinkedIn（非邮件）---",
                f"收件人: {p['to']}",
                p["body"],
                "",
            ]
            continue
        blocks += [
            f"--- {i}. {p['customer']} / Day {p['step']} ---",
            f"收件人: {p['to']}",
            f"主题: {p['subject']}",
            "",
            p["body"],
            "",
        ]
    batch.write_text("\n".join(blocks), encoding="utf-8")

    # Machine-readable manifest: the send gate consumes this, not the prose files.
    manifest = manifest_path
    manifest.write_text(
        json.dumps({"date": today.isoformat(), "sender_ready": ready, "produced": day_items},
                   ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"date={today} produced={len(produced)} outbox={day_dir}")
    for p in produced:
        print(f"  D{p['step']:<2} {p['customer'][:34]:<34} -> {p['to']}  [{p['kind']}] {p['file']}")
        for i in p["lint"]:
            print(f"       lint: {i}")
    print(f"digest: {rel(digest)}")
    print(f"batch : {rel(batch)}")
    print("NOTE: nothing was sent. Open each .eml and send from your own mailbox.")
    return 0


def cmd_status(args) -> int:
    state = load_state()
    if not state["enrolled"]:
        print("no customers enrolled")
        return 0
    today = date.today()
    print(f"{'customer':<36}{'tier':<5}{'first':<12}{'done':<14}{'next':<12}")
    for key, rec in state["enrolled"].items():
        first = date.fromisoformat(rec["first_touch"])
        nxt = None
        for step in OFFSETS:
            if step not in rec["done"]:
                nxt = first + timedelta(days=step)
                break
        label = f"D{nxt.isoformat()}" if nxt else "complete"
        if nxt and nxt <= today:
            label += " DUE"
        print(f"{rec['name'][:35]:<36}{rec['tier']:<5}{rec['first_touch']:<12}{str(rec['done']):<14}{label:<12}")
    return 0


def cmd_lint(args) -> int:
    sender = load_sender()
    bad = 0
    for name in list(DAY1) + ["<generic>"]:
        c = {"name": name} if name != "<generic>" else {"name": "Generic Co"}
        for step in (0, 3, 14, 30):
            kind, subject, body = render(step, c, sender)
            issues = lint(subject, body)
            if issues:
                bad += 1
                print(f"{name} D{step}: {'; '.join(issues)}")
    print(f"lint done, {bad} finding(s)")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["enroll", "run", "status", "lint"])
    ap.add_argument("--db", default=str(DB_DEFAULT))
    ap.add_argument("--start")
    ap.add_argument("--today")
    args = ap.parse_args()
    return {"enroll": cmd_enroll, "run": cmd_run, "status": cmd_status, "lint": cmd_lint}[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
