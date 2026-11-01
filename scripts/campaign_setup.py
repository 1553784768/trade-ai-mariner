"""Finish the lighter campaign setup: identity, Google auth, arming, self-test.

Everything that must be true before an email can leave the building lives here, so
setup is one command instead of five, and every gate is checked rather than assumed.

    # 1. write the CAN-SPAM identity block
    python scripts/campaign_setup.py --name "Zhang Wei" --company "Wangdiao Trading"
        --phone "+86 ..." --email "we@example.com" --address "Real postal address"

    # 2. point Hermes at the Google OAuth client (Desktop app JSON from Cloud Console)
    python scripts/campaign_setup.py --client-secret /path/to/client_secret.json

    # 3. print the consent URL, then paste back the redirect URL / code
    python scripts/campaign_setup.py --auth-url
    python scripts/campaign_setup.py --auth-code "http://localhost:1/?code=..."

    # 4. prove it works without touching a prospect: send one draft to yourself
    python scripts/campaign_setup.py --selftest
    python scripts/campaign_setup.py --arm          # only passes once 1-3 are done
    python scripts/campaign_setup.py --check
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import send_gate  # noqa: E402
import send_via_gmail as transport  # noqa: E402

OUTBOX = send_gate.OUTBOX
PROFILE = send_gate.PROFILE
SETUP = Path(transport.HERMES_HOME) / "skills" / "productivity" / "google-workspace" / "scripts" / "setup.py"
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[a-z]{2,}$", re.I)


def _setup(*args: str, timeout: int = 180) -> subprocess.CompletedProcess:
    # setup.py imports Hermes' `pm` package; without hermes-agent on PYTHONPATH it
    # refuses with "run this script in the Hermes environment" even under the venv python.
    env = dict(os.environ)
    agent_dir = Path(transport.HERMES_HOME) / "hermes-agent"
    if agent_dir.exists():
        prior = env.get("PYTHONPATH")
        env["PYTHONPATH"] = str(agent_dir) + ((os.pathsep + prior) if prior else "")
    return subprocess.run([sys.executable, str(SETUP), *args],
                          capture_output=True, text=True, encoding="utf-8",
                          timeout=timeout, env=env)


def load_profile() -> dict:
    if not PROFILE.exists():
        return {}
    try:
        return json.loads(PROFILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def write_profile(**values) -> dict:
    prof = load_profile()
    for key, value in values.items():
        if value is not None:
            prof[key] = str(value).strip()
    OUTBOX.mkdir(parents=True, exist_ok=True)
    PROFILE.write_text(json.dumps(prof, ensure_ascii=False, indent=2), encoding="utf-8")
    return prof


def profile_problems(prof: dict) -> list[str]:
    problems = []
    for key, label in (("sender_name", "发件人姓名"), ("sender_company", "公司英文名"),
                       ("sender_email", "发件邮箱"), ("postal_address", "邮寄地址")):
        if not str(prof.get(key) or "").strip():
            problems.append(f"{label}({key}) 为空")
    email = str(prof.get("sender_email") or "")
    if email and not EMAIL_RE.match(email):
        problems.append(f"sender_email 不是合法地址: {email}")
    if 0 < len(str(prof.get("postal_address") or "").strip()) < 10:
        problems.append("postal_address 太短 - CAN-SPAM 要求可定位的真实地址")
    return problems


def first_due_draft() -> dict | None:
    day_dirs = sorted((p for p in OUTBOX.iterdir() if p.is_dir() and p.name[:2] == "20"), reverse=True)
    for day_dir in day_dirs:
        manifest = day_dir / "manifest.json"
        if not manifest.exists():
            continue
        try:
            items = json.loads(manifest.read_text(encoding="utf-8")).get("produced") or []
        except json.JSONDecodeError:
            continue
        for item in items:
            if item.get("kind") == "email" and item.get("body"):
                return item
    return None


def cmd_check(args) -> int:
    prof = load_profile()
    problems = profile_problems(prof)
    ok, detail = transport.check_auth()
    print(f"profile : {'ok' if not problems else 'INCOMPLETE'}")
    for p in problems:
        print(f"          - {p}")
    print(f"google  : {'ready' if ok else 'missing'} ({detail})")
    print(f"armed   : {send_gate.ARM.exists()}")
    print(f"stop    : {send_gate.STOP.exists()}")
    draft = first_due_draft()
    if draft:
        print(f"drafts  : {draft.get('customer')} D{draft.get('step')}")
    else:
        print("drafts  : none queued")
    ready = not problems and ok
    print(f"\nRESULT  : {'READY - --arm is safe' if ready else 'NOT READY - see above'}")
    return 0 if ready else 2


def cmd_selftest(args) -> int:
    prof = load_profile()
    problems = profile_problems(prof)
    if problems:
        print("先补齐署名信息：" + "; ".join(problems))
        return 2
    ok, detail = transport.check_auth()
    if not ok:
        print(f"Google 未授权：{detail}")
        return 2
    draft = first_due_draft()
    if not draft:
        print("没有可用草稿 - 先运行 python scripts/campaign_run.py draft")
        return 2
    to = str(args.to or prof.get("sender_email") or "").strip()
    if not to:
        print("没有自测收件地址 - 用 --to 指定，或先填 sender_email")
        return 2
    subject = "[SELF-TEST] " + str(draft.get("subject"))
    body = ("这是一封自测邮件，用来确认署名、正文排版与 Gmail 通道可用。\n"
            "它不是发给客户的邮件。\n\n"
            "----------------------------------------\n"
            f"原始草稿：{draft.get('customer')} / Day {draft.get('step')}\n"
            "----------------------------------------\n\n" + str(draft.get("body")))
    sent, mid, err = transport.send_one(to, subject, body)
    if sent:
        print(f"self-test SENT to {to} id={mid}  -> 去收件箱看排版与首行预览")
        send_gate.audit({"event": "selftest", "to": to, "message_id": mid})
        return 0
    print(f"self-test FAILED: {err}")
    return 4


def cmd_arm(args) -> int:
    prof = load_profile()
    problems = profile_problems(prof)
    ok, detail = transport.check_auth()
    if problems or not ok:
        print("拒绝 arm - 条件不满足：")
        for p in problems:
            print(f"  - {p}")
        if not ok:
            print(f"  - Google 未授权：{detail}")
        return 2
    send_gate.ARM.write_text("armed by campaign_setup\n", encoding="utf-8")
    send_gate.audit({"event": "arm", "sender": prof.get("sender_email")})
    print("armed - 09:00 的 lighter-send-0900 会真的发信。要撤销：删除 "
          f"{send_gate.ARM}")
    return 0


def cmd_disarm(args) -> int:
    if send_gate.ARM.exists():
        send_gate.ARM.unlink()
        send_gate.audit({"event": "disarm"})
        print("disarmed - 不会再自动发信，出稿照旧")
    else:
        print("已经是 disarmed")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    for flag in ("name", "company", "phone", "email", "address"):
        ap.add_argument(f"--{flag}")
    ap.add_argument("--client-secret")
    ap.add_argument("--auth-url", action="store_true")
    ap.add_argument("--auth-code")
    ap.add_argument("--services", default="email")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--to")
    ap.add_argument("--arm", action="store_true")
    ap.add_argument("--disarm", action="store_true")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    touched_profile = any([args.name, args.company, args.phone, args.email, args.address])
    if touched_profile:
        prof = write_profile(sender_name=args.name, sender_company=args.company,
                             sender_phone=args.phone, sender_email=args.email,
                             postal_address=args.address)
        print(f"profile written: {PROFILE}")
        for key in ("sender_name", "sender_company", "sender_phone", "sender_email", "postal_address"):
            print(f"  {key:<16}{prof.get(key) or '(空)'}")
        return 0
    if args.client_secret:
        proc = _setup("--client-secret", args.client_secret)
        sys.stdout.write(proc.stdout or "")
        sys.stderr.write(proc.stderr or "")
        return proc.returncode
    if args.auth_url:
        proc = _setup("--auth-url")
        sys.stdout.write(proc.stdout or "")
        sys.stderr.write(proc.stderr or "")
        return proc.returncode
    if args.auth_code:
        proc = _setup("--auth-code", args.auth_code)
        sys.stdout.write(proc.stdout or "")
        sys.stderr.write(proc.stderr or "")
        return proc.returncode
    if args.selftest:
        return cmd_selftest(args)
    if args.arm:
        return cmd_arm(args)
    if args.disarm:
        return cmd_disarm(args)
    return cmd_check(args)


if __name__ == "__main__":
    sys.exit(main())
