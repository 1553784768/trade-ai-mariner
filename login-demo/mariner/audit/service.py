import hashlib
import json

from sqlalchemy import select

from mariner.db.models import AuditEvent
from mariner.settings import now


def audit_hash(event):
    body = {k: v for k, v in event.items() if k != "hash"}
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256((body["prev_hash"] + canonical).encode("utf-8")).hexdigest()


def append(session, today, action, actor, entity, summary):
    from mariner.localization import audit_en
    # Allocate under SQLite's write lock before reading the preceding event.
    record = AuditEvent(payload={})
    session.add(record)
    session.flush()
    last = session.scalar(select(AuditEvent).where(AuditEvent.seq < record.seq).order_by(AuditEvent.seq.desc()).limit(1))
    event = dict(seq=record.seq, at=now(), business_date=today,
                 actor=actor, action=action, entity=entity, summary=summary,
                 summary_zh=summary, summary_en=audit_en(summary),
                 prev_hash=last.payload["hash"] if last else "0" * 64)
    event["hash"] = audit_hash(event)
    record.payload = event
    session.flush()
    return event
