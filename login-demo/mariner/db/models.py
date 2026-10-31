from sqlalchemy import JSON, Integer, String, UniqueConstraint, LargeBinary
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Record:
    id: Mapped[str] = mapped_column(String, primary_key=True)
    business_date: Mapped[str] = mapped_column(String, index=True)
    payload: Mapped[dict] = mapped_column(JSON)


class Order(Record, Base):
    __tablename__ = "orders"


class ImpactRun(Record, Base):
    __tablename__ = "impact_runs"


class Impact(Record, Base):
    __tablename__ = "impacts"
    run_id: Mapped[str] = mapped_column(String, index=True)
    order_id: Mapped[str] = mapped_column(String, index=True)
    __table_args__ = (UniqueConstraint("run_id", "order_id"),)


class Decision(Record, Base):
    __tablename__ = "decisions"


class AuditEvent(Base):
    __tablename__ = "audit_events"
    seq: Mapped[int] = mapped_column(Integer, primary_key=True)
    payload: Mapped[dict] = mapped_column(JSON)


class RuleVersion(Base):
    __tablename__ = "rule_versions"
    seq: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rule_kind: Mapped[str] = mapped_column(String)
    rule_id: Mapped[str] = mapped_column(String)
    version: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String)
    source: Mapped[str] = mapped_column(String)
    business_date: Mapped[str] = mapped_column(String)
    payload: Mapped[dict] = mapped_column(JSON)
    change_type: Mapped[str | None] = mapped_column(String, nullable=True)
    __table_args__ = (UniqueConstraint("rule_kind", "rule_id", "version"),)


class PolicyDocument(Record, Base):
    __tablename__ = "policy_documents"


class TriageRecord(Record, Base):
    __tablename__ = "triage_records"


class AgentStep(Record, Base):
    __tablename__ = "agent_steps"


class HtsRelease(Record, Base):
    __tablename__ = "hts_releases"


class LlmSettings(Record, Base):
    __tablename__ = "llm_settings"


class RuleDraft(Record, Base):
    __tablename__ = "rule_drafts"


class PipelineRun(Record, Base):
    __tablename__ = "pipeline_runs"


class Brief(Record, Base):
    __tablename__ = "briefs"


class KbEntry(Record, Base):
    __tablename__ = "kb_entries"


class ChatConversation(Record, Base):
    __tablename__ = "chat_conversations"


class ChatMessage(Record, Base):
    __tablename__ = "chat_messages"
    conversation_id: Mapped[str] = mapped_column(String, index=True)


class ImportJob(Record, Base):
    __tablename__ = "import_jobs"
    content: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
