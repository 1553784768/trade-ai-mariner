"use client";
import { t, currentLanguage } from "@/i18n/runtime";
export function ringGeometry(rate: number, baseline: number | null) {
  const circumference = 2 * Math.PI * 27;
  const angle = baseline === null ? null : (Math.min(baseline, 100) / 100) * 2 * Math.PI;
  return {
    circumference,
    offset: circumference * (1 - Math.min(rate, 100) / 100),
    marker:
      angle === null
        ? null
        : {
            x1: 33 + 21.5 * Math.sin(angle),
            y1: 33 - 21.5 * Math.cos(angle),
            x2: 33 + 32.5 * Math.sin(angle),
            y2: 33 - 32.5 * Math.cos(angle),
            degrees: (angle * 180) / Math.PI,
          },
  };
}
export function ScoreRing({ rate, baseline, tone }: { rate: number; baseline: number | null; tone: string }) {
  const g = ringGeometry(rate, baseline);
  return (
    <svg
      data-testid="score-ring"
      width="66"
      height="66"
      viewBox="0 0 66 66"
      style={{ flexShrink: 0 }}
      role="img"
      aria-label={t("综合税率 {new}（原 {base}）", {
        new: `${rate.toFixed(1)}%`,
        base: baseline === null ? "—" : `${baseline.toFixed(1)}%`,
      })}
    >
      <circle cx="33" cy="33" r="27" fill="none" stroke="#eef0f4" strokeWidth="7" />
      <circle
        data-progress
        cx="33"
        cy="33"
        r="27"
        fill="none"
        stroke={`var(--color-${tone})`}
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={g.circumference}
        strokeDashoffset={g.offset}
        transform="rotate(-90 33 33)"
      />
      {g.marker && (
        <line
          data-baseline
          data-degrees={g.marker.degrees}
          x1={g.marker.x1}
          y1={g.marker.y1}
          x2={g.marker.x2}
          y2={g.marker.y2}
          stroke="var(--color-ink-800)"
          strokeWidth="2"
          strokeLinecap="round"
        />
      )}
      <text x="33" y="38" textAnchor="middle" fill="var(--color-ink-900)" fontSize="15" fontWeight="700">
        {rate.toFixed(1)}
        <tspan fontSize="10" fontWeight="600">
          %
        </tspan>
      </text>
    </svg>
  );
}
export type TimelineValue = {
  order: { quote_date: string | null; load_date: string | null };
  as_of: string;
  entry_date: string | null;
  timing_boundary_date: string | null;
  status: string;
  risk_level: string;
};
const dayMs = 86400000;
const day = (s: string) => Date.parse(`${s}T00:00:00Z`) / dayMs;
export function timelineGeometry(value: TimelineValue) {
  const raw = [
    { key: "quote", date: value.order.quote_date, label: "报价日", r: 3.5, color: "ink-300" },
    { key: "load", date: value.order.load_date, label: "装船日", r: 3.5, color: "ink-400" },
    { key: "today", date: value.as_of, label: "今天", r: 4.5, color: "brand" },
    {
      key: "entry",
      date: value.entry_date,
      label: value.status === "entered" ? "已入境" : "预计入境日",
      r: 5,
      color: ({ 红: "bad", 橙: "warn", 黄: "caution", 绿: "good" } as Record<string, string>)[
        value.risk_level
      ],
    },
  ];
  const points = raw.filter((p): p is typeof p & { date: string } => !!p.date);
  const dates = [
    ...points.map((p) => day(p.date)),
    ...(value.timing_boundary_date ? [day(value.timing_boundary_date)] : []),
  ];
  const lo = Math.min(...dates) - 4,
    hi = Math.max(...dates) + 6,
    x = (date: string) => 30 + ((day(date) - lo) / (hi - lo)) * 840;
  const sorted = [...points].sort((a, b) => day(a.date) - day(b.date));
  const ticks: { x: number; month: number }[] = [];
  const first = new Date(lo * dayMs);
  let tick = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1) / dayMs;
  while (tick <= hi) {
    if (tick >= lo)
      ticks.push({ x: 30 + ((tick - lo) / (hi - lo)) * 840, month: new Date(tick * dayMs).getUTCMonth() });
    const d = new Date(tick * dayMs);
    tick = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / dayMs;
  }
  return {
    lo,
    hi,
    points: sorted.map((p, i) => ({ ...p, x: x(p.date), labelY: i % 2 ? 96 : 52 })),
    legend: points,
    ticks,
    boundary: value.timing_boundary_date
      ? { x: x(value.timing_boundary_date), date: value.timing_boundary_date }
      : null,
  };
}
export function KeyDatesTimeline({ value }: { value: TimelineValue }) {
  const g = timelineGeometry(value),
    monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const legend = [
    ...g.legend.filter((p) => p.key !== "entry"),
    ...(g.boundary ? [{ key: "boundary", label: "规则边界", color: "warn" }] : []),
    ...g.legend.filter((p) => p.key === "entry"),
  ];
  return (
    <section className="chart-wrap">
      <div className="chart-head">
        <h3 className="chart-title">{t("关键日期")}</h3>
        <div className="legend-row">
          {legend.map((p) => (
            <span
              key={p.key}
              className={`legend-item${p.key === "today" ? " active" : p.key === "boundary" ? " warn" : ""}`}
            >
              <span
                className={`legend-dot ${p.key === "boundary" ? "dashed" : p.key === "today" ? "" : "fill"}`}
                style={
                  p.key !== "today" && p.key !== "boundary" ? { color: `var(--color-${p.color})` } : undefined
                }
              />
              {t(p.label)}
            </span>
          ))}
        </div>
      </div>
      <svg
        data-testid="timeline"
        data-range-days={g.hi - g.lo}
        className="chart-svg"
        viewBox="0 0 900 120"
        role="img"
        aria-label={t("关键日期")}
      >
        <line x1="30" y1="70" x2="870" y2="70" stroke="var(--color-ink-200)" />
        {g.ticks.map((p) => (
          <g key={p.month}>
            <line x1={p.x} x2={p.x} y1="66" y2="74" stroke="var(--color-ink-300)" />
            <text x={p.x} y="112" textAnchor="middle" fontSize="12" fill="var(--color-ink-400)">
              {currentLanguage() === "en" ? monthNames[p.month] : `${p.month + 1}月`}
            </text>
          </g>
        ))}
        {g.boundary && (
          <g data-point="boundary" data-x={g.boundary.x}>
            <line
              x1={g.boundary.x}
              x2={g.boundary.x}
              y1="18"
              y2="84"
              stroke="var(--color-warn)"
              strokeWidth="1.5"
              strokeDasharray="4 4"
            />
            <text
              x={g.boundary.x}
              y="12"
              textAnchor="middle"
              fill="var(--color-warn)"
              fontSize="12"
              fontWeight="600"
            >
              {t("规则边界 {date}", { date: g.boundary.date.slice(5) })}
            </text>
          </g>
        )}
        {g.points.map((p) => (
          <g key={p.key} data-point={p.key} data-x={p.x}>
            <circle cx={p.x} cy="70" r={p.r} fill={`var(--color-${p.color})`} />
            <text
              x={p.x}
              y={p.labelY}
              textAnchor="middle"
              fontSize="12"
              fontWeight="600"
              fill="var(--color-ink-700)"
            >
              {t(p.label)}
              <tspan fill="var(--color-ink-400)" fontWeight="400">
                {" "}
                {p.date.slice(5)}
              </tspan>
            </text>
          </g>
        ))}
      </svg>
    </section>
  );
}
