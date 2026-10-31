"use client";
import {
  forwardRef,
  Fragment,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import {
  IconSearch,
  IconClock,
  IconInbox,
  IconAlertTriangle,
  IconAlertCircle,
  IconCircleCheck,
  IconArrowNarrowRight,
  IconCheck,
  IconFlame,
} from "@tabler/icons-react";
import { t } from "@/i18n/runtime";
import { formatMoney, formatPercent, formatTime } from "@/lib/format";
import {
  auditLabels,
  checkLabels,
  decisionLabels,
  statusLabels,
  agentLabels,
  legalLabels,
} from "@/lib/labels";
import type { Schema } from "@/lib/api";
import { modifierLabel } from "@/lib/platform";
import { ScoreRing, KeyDatesTimeline } from "./visuals";
export const riskTone: Record<string, string> = { 红: "bad", 橙: "warn", 黄: "caution", 绿: "good" };
export const stateTone: Record<string, string> = {
  adopted: "good",
  dismissed: "bad",
  needs_detail: "warn",
  approved: "good",
  rejected: "bad",
  draft: "warn",
  pass: "good",
  warn: "warn",
  fail: "bad",
  succeeded: "good",
  failed: "bad",
  running: "warn",
  partial: "warn",
  skipped_no_fixture: "caution",
};
export const amountTone = (value: number) => (value < 0 ? "bad" : value > 0 ? "good" : "muted");
export function Tag({
  children,
  tone = "",
  large = false,
}: {
  children: ReactNode;
  tone?: string;
  large?: boolean;
}) {
  const mapped =
    ({ ok: "good", "warn-soft": "caution", canvas: "", paper: "" } as Record<string, string>)[tone] ?? tone;
  return <span className={`chip ${mapped}${large ? " lg" : ""}`}>{children}</span>;
}
export function PrimaryButton({
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} className={`btn btn-primary ${className}`}>
      {children}
    </button>
  );
}
export function DecisionButton({
  tone,
  shortcut,
  icon,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone: string; shortcut?: string; icon?: ReactNode }) {
  return (
    <button
      {...props}
      title={shortcut}
      className={`btn ${tone === "ok" || tone === "good" ? "btn-good" : tone === "bad" ? "btn-bad-outline" : "btn-warn-outline"}`}
    >
      {icon}
      {children}
    </button>
  );
}
export function Tabs({
  items,
  value,
  onChange,
  suffix,
  segmented = false,
}: {
  items: { id: string; label: string; count?: number }[];
  value: string;
  onChange: (id: string) => void;
  suffix?: ReactNode;
  segmented?: boolean;
}) {
  return (
    <div className={segmented ? "segmented" : "tabs-row"} role="tablist">
      {items.map((item) => (
        <button
          key={item.id}
          role="tab"
          aria-selected={item.id === value}
          className={`${segmented ? "" : "tab "}${item.id === value ? "active" : ""}`}
          onClick={() => onChange(item.id)}
        >
          {item.label}
          {item.count !== undefined && (
            <span className={segmented ? "seg-count" : "tab-count"}>{item.count}</span>
          )}
        </button>
      ))}
      {suffix && (
        <>
          <span className="tabs-spacer" />
          <span className="tabs-suffix">{suffix}</span>
        </>
      )}
    </div>
  );
}
export const SearchBox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function SearchBox(props, ref) {
    return (
      <div className="search-box">
        <IconSearch size={14} />
        <input ref={ref} placeholder={t("搜索订单号、品名、HS 编码…")} {...props} />
        <kbd className="kbd font-sans">{modifierLabel()} K</kbd>
      </div>
    );
  },
);
export function TextField({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="input" {...props} />
    </div>
  );
}
export function Switch({
  children,
  checked,
  onChange,
}: {
  children: ReactNode;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      className={`switch${checked ? " on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="track" />
      {children}
    </button>
  );
}
export function LoadingPanel() {
  return (
    <div className="loading" role="status">
      {t("加载中…")}
    </div>
  );
}
export function EmptyPanel({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <IconInbox />
      {children}
    </div>
  );
}
export function ErrorBanner({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <div className="banner bad" role="alert">
      <IconAlertTriangle />
      {error.message}
      <span className="spacer" />
      {retry && (
        <button className="btn" onClick={retry}>
          {t("重试")}
        </button>
      )}
    </div>
  );
}
export function SectionTitle({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <h3 className="card-head">
      {icon}
      {children}
    </h3>
  );
}
export function KeyValueGrid({ values }: { values: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="kv">
      {values.map((v) => (
        <div key={v.label}>
          <dt>{v.label}</dt>
          <dd>{v.value}</dd>
        </div>
      ))}
    </dl>
  );
}
export function MetricCard({
  label,
  value,
  unit,
  tone = "",
  bar,
  marker,
  small = false,
  children,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  tone?: string;
  bar?: number;
  marker?: number;
  small?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="metric-card static">
      <div className="metric-label">{label}</div>
      <div className="metric-value-row">
        <span className={`metric-value${small ? " sm" : ""} tone-${tone}`}>{value}</span>
        {unit && <span className="metric-unit">{unit}</span>}
      </div>
      {bar !== undefined && (
        <div className="metric-bar">
          <i className={`tone-${tone}`} style={{ width: `${bar}%` }} />
          {marker !== undefined && <b style={{ left: `${marker}%` }} />}
        </div>
      )}
      {children}
    </div>
  );
}
export function countdownLabel(value: Schema<"Countdown">) {
  return value.kind === "entered"
    ? t("已入境")
    : (value.days ?? 0) < 0 && value.kind === "entry"
      ? t("已过入境日")
      : value.kind === "rule_boundary"
        ? t("规则边界 {p0}天", { p0: value.days })
        : t("入境 {p0}天", { p0: value.days });
}
export function countdownTone(value: Schema<"Countdown">) {
  return value.kind === "entered"
    ? ""
    : (value.days ?? 0) < 0
      ? "bad"
      : (value.days ?? 0) <= 7
        ? "warn"
        : "outline";
}
export function ImpactCard({
  value: v,
  selected,
  onClick,
  customerName,
}: {
  value: Schema<"ImpactCard">;
  selected: boolean;
  customerName?: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`metric-card${selected ? " active" : ""}`}
      style={{ textAlign: "left" }}
      data-order={v.order_id}
      data-selected={selected}
      onClick={onClick}
    >
      <div className="metric-label clamp">
        {v.order_id} · {v.product}
      </div>
      <div className="metric-value-row">
        <span className={`metric-value tone-${riskTone[v.risk_level]}`}>
          {formatMoney(v.profit_delta_usd, true)}
        </span>
        <span className="metric-unit">USD</span>
      </div>
      <div className="metric-bar">
        <i
          className={`tone-${riskTone[v.risk_level]}`}
          style={{ width: `${Math.min(v.rate_new_pct, 100)}%` }}
        />
        <b style={{ left: `${Math.min(v.rate_baseline_user_pct, 100)}%` }} />
      </div>
      <div className="metric-meta">
        {t("税率 {base} → {new}", {
          base: formatPercent(v.rate_baseline_user_pct),
          new: formatPercent(v.rate_new_pct),
        })}
      </div>
      <div className="metric-meta chips">
        {customerName && <Tag>{customerName}</Tag>}
        <Tag tone={riskTone[v.risk_level]}>{t(v.risk_level)}</Tag>
        <Tag tone={countdownTone(v.countdown)}>
          <IconClock />
          {countdownLabel(v.countdown)}
        </Tag>
        {v.tag && <Tag tone="good">{t(v.tag)}</Tag>}
        {v.decision !== "pending" && <Tag tone={stateTone[v.decision]}>{decisionLabels[v.decision]}</Tag>}
      </div>
    </button>
  );
}
export function LayerTable({ value: v }: { value: Schema<"ImpactDetail"> }) {
  return (
    <table className="table" data-testid="layers">
      <thead>
        <tr>
          {[t("层"), t("第99章税号"), t("税率"), t("关税额")].map((h, i) => (
            <th className={i > 1 ? "num" : ""} key={h}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {v.layers.map((l) => (
          <tr key={l.id}>
            <td>{l.label}</td>
            <td>{l.heading}</td>
            <td className="num">{formatPercent(l.rate_pct)}</td>
            <td className="num">{formatMoney(l.duty_usd)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={3}>
            {t("基准关税（")}
            {formatPercent(v.rate_baseline_user_pct)}
            {t("）")}
          </td>
          <td className="num">{formatMoney(v.duty_baseline_usd)}</td>
        </tr>
        <tr>
          <td colSpan={3}>{t("新关税")}</td>
          <td className="num">{formatMoney(v.duty_new_usd)}</td>
        </tr>
        <tr className="total">
          <td colSpan={3}>{t("关税增量")}</td>
          <td
            className={`num ${v.duty_delta_usd > 0 ? "tone-bad" : v.duty_delta_usd < 0 ? "tone-good" : ""}`}
          >
            {formatMoney(v.duty_delta_usd, true)}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}
export function ProfitTable({ value: v }: { value: Schema<"ImpactDetail"> }) {
  return (
    <table className="table" data-testid="profits">
      <thead>
        <tr>
          {["", t("基准"), t("重算"), t("变化")].map((h, i) => (
            <th className={i ? "num" : ""} key={i}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>{t("收入")}</td>
          <td className="num">{formatMoney(v.revenue_usd)}</td>
          <td className="num">{formatMoney(v.revenue_usd)}</td>
          <td className="num">—</td>
        </tr>
        <tr>
          <td>{t("卖方成本")}</td>
          <td className="num">{formatMoney(v.seller_cost_baseline_usd)}</td>
          <td className="num">{formatMoney(v.seller_cost_new_usd)}</td>
          <td className="num">{formatMoney(v.seller_cost_delta_usd, true)}</td>
        </tr>
        <tr>
          <td>{t("利润")}</td>
          <td className="num">{formatMoney(v.seller_profit_baseline_usd)}</td>
          <td className={`num tone-${amountTone(v.seller_profit_new_usd)}`}>
            {formatMoney(v.seller_profit_new_usd)}
          </td>
          <td className={`num tone-${amountTone(v.profit_delta_usd)}`}>
            {formatMoney(v.profit_delta_usd, true)}
          </td>
        </tr>
        <tr>
          <td>{t("毛利率")}</td>
          <td className="num">{formatPercent(v.margin_baseline_pct)}</td>
          <td className="num">{formatPercent(v.margin_new_pct)}</td>
          <td className="num">{`${v.margin_delta_pp < 0 ? "−" : "+"}${Math.abs(v.margin_delta_pp).toFixed(1)}pp`}</td>
        </tr>
      </tbody>
    </table>
  );
}
export function ActionList({
  actions,
  selected = [],
  onToggle,
  hint = false,
}: {
  actions: string[];
  selected?: number[];
  onToggle?: (index: number) => void;
  hint?: boolean;
}) {
  return (
    <>
      {hint && (
        <div className="banner warn" role="status">
          {t("先勾选要采纳的建议")}
        </div>
      )}
      <ol className="entry-list action-list">
        {actions.map((action, i) => (
          <li key={action}>
            <button
              type="button"
              role="checkbox"
              aria-label={`action-${i + 1}`}
              aria-checked={selected.includes(i)}
              onClick={() => onToggle?.(i)}
              style={{ width: "100%", textAlign: "left" }}
              className={`route-entry selectable${selected.includes(i) ? " selected" : ""}`}
            >
              <span className="check">{selected.includes(i) && <IconCheck />}</span>
              <span className="entry-no">{String(i + 1).padStart(2, "0")}</span>
              <span style={{ fontSize: 14 }}>{action}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="disclaimer">
        {t("本工具不构成法律或报关意见；税号归类与最终税额以进口商/报关行申报为准。")}
      </p>
    </>
  );
}
export function Flow({ nodes }: { nodes: { name: string; tone?: string }[] }) {
  return (
    <div className="flow">
      {nodes.map((n, i) => (
        <Fragment key={`${n.name}-${i}`}>
          {i > 0 && (
            <span className="arrow">
              <IconArrowNarrowRight />
            </span>
          )}
          <span className={`flow-node ${n.tone || ""}`}>
            <span className="dot" />
            {n.name}
          </span>
        </Fragment>
      ))}
    </div>
  );
}
export function ProcessChain({ value: v }: { value: Schema<"ImpactDetail"> }) {
  const nodes = v.agent_chain.map((n) => ({
    name: agentLabels[n.agent],
    tone:
      n.status === "done"
        ? "good"
        : n.status === "failed"
          ? "bad"
          : n.agent === "human" && n.status === "pending"
            ? "brand"
            : "",
  }));
  if (v.checks.some((c) => c.key === "unverified_fields" && c.status === "warn"))
    nodes.push({ name: t("报关行复核（含未核实字段时）"), tone: "dashed" });
  return <Flow nodes={nodes} />;
}
export function SeverityGrid({
  checks,
}: {
  checks: { key: string; label?: string; status: string; value?: string | null }[];
}) {
  return (
    <div className="route-grid">
      {["fail", "warn", "pass"].map((status, i) => {
        const entries = checks.filter((c) => c.status === status),
          Icon = [IconAlertCircle, IconAlertTriangle, IconCircleCheck][i];
        return (
          <section className="route-col" key={status}>
            <div className="route-col-head">
              <span className={`tag ${stateTone[status]}`}>
                <Icon />
                {statusLabels[status]}
              </span>
              <span className="range">{entries.length}</span>
            </div>
            {entries.length ? (
              entries.map((c) => (
                <div className="route-entry" key={c.key}>
                  <span className="route-path">{c.label || checkLabels[c.key] || c.key}</span>
                  {c.value && <span className="route-score">{c.value}</span>}
                </div>
              ))
            ) : (
              <div className="route-empty">
                <IconCircleCheck />
                {t(["没有不通过项", "没有注意项", "没有通过项"][i])}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
export const RuleCheckPanel = SeverityGrid;
export function ImpactDocument({
  value: v,
  selected,
  onToggle,
  actionHint = false,
  actions,
  notePanel,
  linkedCustomer,
}: {
  value: Schema<"ImpactDetail">;
  selected?: number[];
  onToggle?: (i: number) => void;
  actionHint?: boolean;
  actions?: ReactNode;
  notePanel?: ReactNode;
  linkedCustomer?: ReactNode;
}) {
  const [tab, setTab] = useState("actions");
  const [previousHint, setPreviousHint] = useState(actionHint);
  if (previousHint !== actionHint) {
    setPreviousHint(actionHint);
    if (actionHint) setTab("actions");
  }
  const flag = countdownTone(v.countdown);
  return (
    <article className="detail-panel">
      <div className="detail-top">
        <div className="detail-left">
          <div className="device-tag">
            {v.order_id} · HTS {v.hts10} · {v.incoterm} · {v.channel === "b2b" ? "B2B" : t("电商")} ·{" "}
            {v.order.tariff_clause === "none"
              ? t("无关税条款")
              : t("关税增量我方承担 {p0}%", { p0: Number(v.order.tariff_clause.split(":")[1]) * 100 })}{" "}
            · {t("进口商：")}
            {v.importer_of_record === "seller" ? t("卖方") : t("买方")}
            {t("（")}
            {v.incoterm}
            {t("）")}
          </div>
          <h2 className="detail-heading">{v.product}</h2>
          <div className="score-row">
            <ScoreRing
              rate={v.rate_new_pct}
              baseline={v.rate_baseline_user_pct}
              tone={riskTone[v.risk_level]}
            />
            <div>
              <div className={`score-status tone-${riskTone[v.risk_level]}`}>
                {t(`${v.risk_level}色风险`)}
              </div>
              <div className={`score-flag ${flag === "bad" ? "bad" : flag === "warn" ? "" : "muted"}`}>
                {flag === "bad" || flag === "warn" ? <IconAlertTriangle /> : <IconClock />}
                {countdownLabel(v.countdown)}
              </div>
            </div>
          </div>
          <p className="detail-copy hint">{t("原因：{text}", { text: v.risk_reasons })}</p>
          <p className="detail-copy">
            {t("综合税率 {a} → {b}，关税增量 {d}；利润 {p0} → {p1}，毛利率 {m0} → {m1}。", {
              a: formatPercent(v.rate_baseline_user_pct),
              b: formatPercent(v.rate_new_pct),
              d: formatMoney(v.duty_delta_usd, true),
              p0: formatMoney(v.seller_profit_baseline_usd),
              p1: formatMoney(v.seller_profit_new_usd),
              m0: formatPercent(v.margin_baseline_pct),
              m1: formatPercent(v.margin_new_pct),
            })}
          </p>
        </div>
        {actions}
      </div>
      {linkedCustomer}
      {notePanel}
      <KeyDatesTimeline value={v} />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: "actions", label: t("可执行建议"), count: v.actions.length },
          { id: "layers", label: t("税率分层") },
          { id: "profit", label: t("利润") },
          { id: "checks", label: t("规则核验") },
          { id: "chain", label: t("处理链") },
        ]}
        suffix={v.run_id}
      />
      {tab === "checks" ? (
        <SeverityGrid checks={v.checks} />
      ) : (
        <div className="tab-body">
          {tab === "actions" && (
            <ActionList actions={v.actions} selected={selected} onToggle={onToggle} hint={actionHint} />
          )}{" "}
          {tab === "layers" && <LayerTable value={v} />} {tab === "profit" && <ProfitTable value={v} />}{" "}
          {tab === "chain" && <ProcessChain value={v} />}
        </div>
      )}
    </article>
  );
}
export function AuditLog({ events }: { events: Schema<"AuditEvent">[] }) {
  return (
    <table className="table" data-testid="audit-table">
      <thead>
        <tr>
          {["时间", "动作", "执行者", "摘要"].map((h) => (
            <th key={h}>{t(h)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {events.map((e) => (
          <tr key={e.seq}>
            <td>{formatTime(e.at, true)}</td>
            <td>{auditLabels[e.action] || e.action}</td>
            <td>{t(e.actor)}</td>
            <td>{e.summary}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
export function DecisionHistoryTable({
  decisions,
  risks = {},
}: {
  decisions: Schema<"DecisionRow">[];
  risks?: Record<string, string>;
}) {
  return (
    <section className="card">
      <SectionTitle icon={<IconClock />}>{t("最近处理")}</SectionTitle>
      {!decisions.length ? (
        <EmptyPanel>{t("暂无处理记录")}</EmptyPanel>
      ) : (
        <table className="table history-table">
          <thead>
            <tr>
              {["订单号", "品名", "利润变化", "处理人", "时间", "状态", "说明"].map((h) => (
                <th key={h}>{t(h)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {decisions.map((d) => (
              <tr key={d.audit_hash}>
                <td>{d.order_id}</td>
                <td>{d.product}</td>
                <td className={`num tone-${risks[d.order_id] || ""}`}>
                  {formatMoney(d.profit_delta_usd, true)}
                </td>
                <td>{t(d.actor)}</td>
                <td>{formatTime(d.decided_at)}</td>
                <td>
                  <Tag tone={stateTone[d.decision]}>{decisionLabels[d.decision]}</Tag>
                </td>
                <td title={d.note || undefined}>
                  {d.note
                    ? d.note.length > 40
                      ? d.note.slice(0, 40) + "…"
                      : d.note
                    : d.adopted_actions?.length
                      ? t("第 {p0} 条", {
                          p0: d.adopted_actions
                            .map((a) => String(a.index + 1).padStart(2, "0"))
                            .join(t("、")),
                        })
                      : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
export function PipelineFlow({
  pipeline,
  drafts = 0,
}: {
  pipeline?: Schema<"PipelineRun"> | null;
  drafts?: number;
}) {
  const steps = pipeline?.steps || [],
    collectors = steps.filter((s) => s.agent.startsWith("collector"));
  const collectState = collectors.some((s) => s.status === "failed")
    ? "failed"
    : collectors.some((s) => s.status === "skipped_no_fixture")
      ? "skipped_no_fixture"
      : collectors.some((s) => s.status === "running")
        ? "running"
        : collectors.length && collectors.every((s) => s.status === "succeeded")
          ? "succeeded"
          : "pending";
  return (
    <Flow
      nodes={[
        { name: t("触发") },
        { name: t("采集"), tone: stateTone[collectState] },
        ...["triage", "extract", "validate"].map((k) => ({
          name: agentLabels[k],
          tone: stateTone[steps.find((s) => s.agent === k)?.status || "pending"],
        })),
        {
          name: drafts ? t("人工确认 · {p0} 待确认", { p0: drafts }) : t("人工确认"),
          tone: drafts ? "warn" : "good",
        },
        { name: t("计算"), tone: "good" },
        { name: t("日报"), tone: stateTone[steps.find((s) => s.agent === "brief")?.status || "pending"] },
        { name: t("完成"), tone: stateTone[pipeline?.status || "pending"] },
      ]}
    />
  );
}
export function CriticalEventsPanel({ items }: { items: Schema<"WatchItem">[] }) {
  return (
    <section className="card" id="watch-events">
      <h3 className="card-head">
        <IconAlertTriangle />
        {t("临界事件")}
        <span className="suffix">{items.length}</span>
      </h3>
      {!items.length ? (
        <EmptyPanel>{t("暂无临界事件")}</EmptyPanel>
      ) : (
        <div className="route-grid">
          {items.map((w) => (
            <section className="route-col" key={w.id}>
              <div className="route-col-head">
                <span className={`tag ${riskTone[w.severity]}`}>
                  {w.severity === "红" ? <IconFlame /> : <IconAlertTriangle />}
                  {legalLabels[w.legal_status]}
                </span>
                <span className="range">{w.next_milestone || "—"}</span>
              </div>
              <div className="route-entry">
                <span className="route-path">{w.title}</span>
              </div>
              <div className="route-entry">
                <span className="route-visits">
                  {w.affected_order_ids.length
                    ? t("影响 {p0} 单 · {p1}", {
                        p0: w.affected_order_ids.length,
                        p1: w.impact_usd === null ? t("暂无税率") : formatMoney(w.impact_usd, true),
                      })
                    : t("暂无受影响订单")}
                </span>
                <span className="route-score">{w.affected_order_ids.join(" · ")}</span>
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
