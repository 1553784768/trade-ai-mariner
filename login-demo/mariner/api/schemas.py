from typing import Literal, Any

from pydantic import BaseModel, Field

RiskLevel = Literal["红", "橙", "黄", "绿"]
DecisionKind = Literal["pending", "adopted", "dismissed", "needs_detail"]
LegalStatus = Literal["in_force", "signed_pending", "scheduled_expiry", "proposed", "investigation",
                      "negotiation_no_tariff", "court_ruling", "procedural"]
AgentKey = Literal["collector_fr", "collector_pi", "collector_usitc", "triage", "extract", "validate", "brief"]


class ApiErrorBody(BaseModel):
    code: str
    message: str
    details: Any = None


class ApiError(BaseModel):
    error: ApiErrorBody


class Counts(BaseModel):
    pending: int
    red: int
    orange: int
    yellow: int
    green: int
    urgent: int
    drafts_pending: int
    decisions_total: int


class Today(BaseModel):
    processed: int
    total: int
    adopted: int
    dismissed: int
    needs_detail: int


class RunRef(BaseModel):
    id: str
    created_at: str


class Meta(BaseModel):
    product_name: Literal["Mariner AI"] = "Mariner AI"
    hts_release: str
    as_of: str
    llm_configured: bool
    counts: Counts
    today: Today
    latest_run: RunRef | None


class Order(BaseModel):
    order_id: str
    product: str
    hts10: str
    origin: Literal["CN"]
    incoterm: Literal["EXW", "FCA", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"]
    channel: Literal["b2b", "ecom"]
    importer_of_record: Literal["seller", "buyer"]
    tariff_clause: str
    status: Literal["quoted", "confirmed", "shipped", "entered"]
    qty: float
    unit_price_usd: float
    purchase_cost_cny_per_unit: float
    other_cost_cny_per_unit: float
    fx_cny_per_usd: float
    intl_freight_usd: float
    insurance_usd: float
    us_side_cost_usd: float
    customs_value_usd: float
    transport_mode: Literal["ocean", "air", "postal"]
    quote_date: str
    load_date: str
    entry_date: str
    delivery_date: str
    baseline_duty_rate_pct: float
    target_margin_pct: float


class ImportErrorRow(BaseModel):
    row: int
    field: str
    message: str


class ImportResult(BaseModel):
    imported: int
    updated: int
    run_id: str | None
    errors: list[ImportErrorRow]


class ImpactRun(BaseModel):
    id: str
    as_of: str
    created_at: str
    order_count: int
    total_profit_delta_usd: float
    total_potential_refund_usd: float


class ChainNode(BaseModel):
    key: Literal["rules", "calc", "human"]
    state: Literal["done", "warn", "pending", "needs_detail", "todo"]


class Countdown(BaseModel):
    kind: Literal["entry", "rule_boundary", "entered"]
    days: int | None


class ImpactCard(BaseModel):
    run_id: str
    order_id: str
    product: str
    hts10: str
    incoterm: str
    channel: Literal["b2b", "ecom"]
    importer_of_record: Literal["seller", "buyer"]
    status: Literal["quoted", "confirmed", "shipped", "entered"]
    entry_date: str
    risk_level: RiskLevel
    tag: Literal["利好", ""]
    profit_delta_usd: float
    countdown: Countdown
    rate_baseline_user_pct: float
    rate_new_pct: float
    chain: list[ChainNode]
    decision: DecisionKind


class DutyLayer(BaseModel):
    id: str
    label: str
    heading: str
    rate_pct: float
    duty_usd: float
    refund_status: Literal["struck_down", "challenged_pending_appeal"] | None


class Check(BaseModel):
    key: Literal["rules_confirmed", "evidence", "hts_exists", "baseline_match", "unverified_fields"]
    status: Literal["pass", "warn", "fail"]
    value: str | None


class AgentChainNode(BaseModel):
    agent: Literal["collector", "triage", "extract", "impact", "human"]
    status: Literal["done", "skipped", "failed", "pending", "not_run"]
    at: str | None


class Source(BaseModel):
    rule_id: str
    title: str
    url: str


class OrderRef(BaseModel):
    load_date: str
    quote_date: str
    customs_value_usd: float
    transport_mode: str
    tariff_clause: str


class AdoptedAction(BaseModel):
    index: int
    text: str


class ImpactDetail(ImpactCard):
    as_of: str
    seller_cost_delta_usd: float
    margin_delta_pp: float
    adopted_actions: list[AdoptedAction] = Field(default_factory=list)
    note: str | None = None
    rate_baseline_rules_pct: float
    duty_baseline_usd: float
    duty_new_usd: float
    duty_delta_usd: float
    mpf_usd: float
    hmf_usd: float
    seller_profit_baseline_usd: float
    seller_profit_new_usd: float
    margin_baseline_pct: float
    margin_new_pct: float
    buyer_landed_cost_change_pct: float | None
    potential_refund_usd: float
    risk_reasons: str
    flags: list[str]
    actions: list[str]
    layers: list[DutyLayer]
    revenue_usd: float
    seller_cost_baseline_usd: float
    seller_cost_new_usd: float
    timing_boundary_date: str | None
    timing_saving_usd: float | None
    watch_ids: list[str]
    checks: list[Check]
    agent_chain: list[AgentChainNode]
    sources: list[Source]
    order: OrderRef


class DecisionRequest(BaseModel):
    decision: Literal["adopted", "dismissed", "needs_detail"]
    note: str | None = Field(default=None, max_length=500)
    action_indices: list[int] | None = None


class Decision(BaseModel):
    adopted_actions: list[AdoptedAction] = Field(default_factory=list)
    order_id: str
    run_id: str
    decision: DecisionKind
    note: str | None
    decided_at: str
    actor: Literal["本地用户"]
    audit_hash: str


class DecisionRow(Decision):
    product: str
    profit_delta_usd: float


class AuditEvent(BaseModel):
    summary_zh: str | None = None
    summary_en: str | None = None
    seq: int
    at: str
    business_date: str
    actor: str
    action: Literal["ORDERS_IMPORTED", "RUN_CREATED", "COLLECTED", "TRIAGED", "EXTRACTED", "VALIDATED",
                    "RULE_APPROVED", "RULE_REJECTED", "RULE_NEEDS_DETAIL", "BRIEF_PUBLISHED", "DECIDED",
                      "LLM_SETTINGS_CHANGED", "KB_EDITED", "KB_RESTORED", "KB_CREATED", "KB_DELETED",
                      "TRADE_LINK_CHANGED", "CHAT_ORDER_DATA_SENT", "IMPORT_SENT_TO_MODEL", "CHAT_DELETED", "KB_UNDELETED"]
    entity: str
    summary: str
    prev_hash: str
    hash: str


class RuleChange(BaseModel):
    change_type: Literal["program_add", "program_update", "hts_profile_update", "watch_item_upsert", "no_rate_change"]
    target_id: str | None
    payload: dict[str, Any]


class Evidence(BaseModel):
    field: str
    quote: str = Field(max_length=300)


class VerifiedEvidence(Evidence):
    verified: bool


class Validation(BaseModel):
    check: Literal["V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8", "V9"]
    status: Literal["pass", "warn", "fail", "n/a"]
    message: str


class ImpactPreview(BaseModel):
    orders_affected: int
    profit_delta_usd: float


class RuleDraft(BaseModel):
    id: str
    source_document_number: str
    source_url: str
    title: str
    original_title: str
    legal_status: LegalStatus
    change: RuleChange
    summary_zh: str
    evidence: list[VerifiedEvidence]
    validation: list[Validation]
    status: Literal["draft", "approved", "rejected", "needs_detail"]
    impact_preview: ImpactPreview | None
    created_at: str


class Highlight(BaseModel):
    start: int
    end: int
    field: str


class RuleDraftDetail(RuleDraft):
    source_text: str
    highlights: list[Highlight]


class WatchItem(BaseModel):
    id: str
    title: str
    summary: str
    legal_status: LegalStatus
    certainty: float
    next_milestone: str | None
    sources: list[str]
    affected_order_ids: list[str]
    impact_usd: float | None
    severity: RiskLevel


class StepCounts(BaseModel):
    input: int
    output: int
    skipped: int
    errors: int


class PipelineStep(BaseModel):
    agent: AgentKey
    status: Literal["pending", "running", "succeeded", "failed", "skipped_no_fixture"]
    started_at: str | None
    finished_at: str | None
    counts: StepCounts
    message: str | None


class PipelineRun(BaseModel):
    id: str
    trigger: Literal["schedule_0730", "manual"]
    status: Literal["running", "succeeded", "partial", "failed"]
    started_at: str
    finished_at: str | None
    steps: list[PipelineStep]


class LastTest(BaseModel):
    ok: bool
    message: str
    at: str
    latency_ms: float | None


class LlmSettings(BaseModel):
    configured: bool
    base_url: str | None
    model: str | None
    api_key_masked: str | None
    last_test: LastTest | None


class LlmSettingsRequest(BaseModel):
    base_url: str
    model: str
    api_key: str | None = None


class TestConnection(BaseModel):
    ok: bool
    message: str
    latency_ms: float | None


class ReviewRequest(BaseModel):
    action: Literal["approve", "reject", "needs_detail"]
    note: str | None = None


class BriefItem(BaseModel):
    kind: Literal["policy", "expiry", "watch", "preview_alert"]
    title: str
    original_title: str | None
    legal_status: LegalStatus | None
    summary: str
    affected_order_ids: list[str]
    impact_usd: float | None
    source_url: str | None
    published_at: str | None
    confirmed: bool
    draft_status: Literal["draft", "needs_detail", "approved", "rejected"] | None


class OrderSummary(BaseModel):
    total: int
    red: int
    orange: int
    yellow: int
    green: int
    profit_delta_usd: float
    refund_usd: float


class Brief(BaseModel):
    date: str
    generated_at: str
    conclusion: str
    items: list[BriefItem]
    order_summary: OrderSummary


class BriefDate(BaseModel):
    date: str
    item_count: int
