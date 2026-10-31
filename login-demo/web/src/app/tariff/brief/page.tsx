"use client";
import { t } from "@/i18n/runtime";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconClock, IconArrowUpRight } from "@tabler/icons-react";
import { api, ApiFailure, type Schema } from "@/lib/api";
import { legalLabels } from "@/lib/labels";
import { formatMoney, formatTime } from "@/lib/format";
import { Shell } from "@/components/shell";
import { EmptyPanel, ErrorBanner, LoadingPanel, Tag, Tabs, MetricCard, amountTone } from "@/components/ui";
export default function Page() {
  const [selected, setSelected] = useState(""),
    [tab, setTab] = useState("all");
  const dates = useQuery({ queryKey: ["brief-dates"], queryFn: () => api<Schema<"BriefDate">[]>("/briefs") });
  const day = selected || dates.data?.[0]?.date;
  const brief = useQuery({
    queryKey: ["brief", day],
    enabled: !!day,
    queryFn: () => api<Schema<"Brief">>(`/briefs/${day}`),
  });
  const kinds: Record<string, string> = {
    policy: t("政策"),
    expiry: t("到期"),
    watch: t("观察"),
    preview_alert: t("预警（尚未正式发布）"),
  };
  const error = dates.error || brief.error,
    b = brief.data,
    summary = b?.order_summary;
  return (
    <Shell title={t("政策日报")}>
      <div className="filter-row">
        {day && (
          <label className="dropdown">
            <span className="dropdown-label">{t("日期")}</span>
            <select value={day} aria-label={t("日期")} onChange={(e) => setSelected(e.target.value)}>
              {dates.data?.map((d) => (
                <option key={d.date}>{d.date}</option>
              ))}
            </select>
          </label>
        )}
        <span className="spacer" />
        {b && (
          <span className="date-range">
            <IconClock />
            {t("生成于 {date}", { date: formatTime(b.generated_at).slice(5) })}
          </span>
        )}
      </div>
      {error && !(error instanceof ApiFailure && error.status === 404) && (
        <ErrorBanner
          error={error}
          retry={() => {
            void dates.refetch();
            void brief.refetch();
          }}
        />
      )}
      <div className="panels fill">
        {b && summary ? (
          <>
            <aside className="metrics-list">
              <div className="list-head">
                <span className="chart-title">{t("订单汇总")}</span>
              </div>
              <MetricCard label={t("订单总数")} value={summary.total} unit={t("单")} />
              {(["red", "orange", "yellow", "green"] as const).map((key, i) => (
                <MetricCard
                  key={key}
                  label={t(["红", "橙", "黄", "绿"][i])}
                  value={summary[key]}
                  unit={t("单")}
                  tone={["bad", "warn", "caution", "good"][i]}
                  bar={summary.total ? (summary[key] / summary.total) * 100 : 0}
                />
              ))}
              <MetricCard
                label={t("合计利润变化")}
                value={formatMoney(summary.profit_delta_usd, true)}
                unit="USD"
                tone={amountTone(summary.profit_delta_usd)}
              />
              <MetricCard
                label={t("潜在退款")}
                value={formatMoney(summary.refund_usd)}
                unit="USD"
                tone={summary.refund_usd > 0 ? "good" : ""}
              />
            </aside>
            <article className="detail-panel">
              <div className="detail-top">
                <div className="detail-left wide">
                  <div className="device-tag">{t("美国关税政策日报")}</div>
                  <h2 className="detail-heading">{b.date}</h2>
                  <div className="score-status">{b.conclusion}</div>
                  <p className="detail-copy hint">
                    {t("结论按生成时的订单状态计算，之后的决策和重算不会更新这句话。")}
                  </p>
                </div>
              </div>
              <Tabs
                value={tab}
                onChange={setTab}
                items={[
                  { id: "all", label: t("全部"), count: b.items.length },
                  ...Object.entries(kinds).map(([id, label]) => ({
                    id,
                    label,
                    count: b.items.filter((item) => item.kind === id).length,
                  })),
                ]}
              />
              <div className="tab-body" style={{ paddingTop: 16 }}>
                <div className="entry-list" data-testid="brief-items">
                  {b.items
                    .filter((item) => tab === "all" || item.kind === tab)
                    .map((item, i) => (
                      <section className="route-entry card-like" key={`${item.source_url}-${i}`}>
                        <div className="chips">
                          <Tag tone="outline">
                            {item.legal_status ? legalLabels[item.legal_status] : t("待读全文")}
                          </Tag>
                          <Tag>{kinds[item.kind]}</Tag>
                          {!item.confirmed && <Tag tone="warn">{t("待确认")}</Tag>}
                        </div>
                        <h3 className="entry-title">{item.title}</h3>
                        {item.original_title && (
                          <p className="route-visits" style={{ marginTop: 4 }}>
                            {t("原文标题：")}
                            {item.original_title}
                          </p>
                        )}
                        <p className="body-text" style={{ whiteSpace: "normal" }}>
                          {item.summary}
                        </p>
                        {item.affected_order_ids.length > 0 && (
                          <div className="metric-meta">
                            {t("受影响订单 ·")}
                            {item.affected_order_ids.join(" · ")}
                            {item.impact_usd !== null && (
                              <span className={`tone-${amountTone(item.impact_usd)}`}>
                                {formatMoney(item.impact_usd, true)}
                              </span>
                            )}
                          </div>
                        )}
                        {item.source_url && (
                          <a
                            className="learn-link"
                            style={{ marginTop: 2 }}
                            href={item.source_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {t("原文")}
                            <IconArrowUpRight />
                          </a>
                        )}
                      </section>
                    ))}
                </div>
              </div>
            </article>
          </>
        ) : (
          <div style={{ gridColumn: "1 / -1" }}>
            {dates.isPending || (day && brief.isPending) ? (
              <LoadingPanel />
            ) : (
              <EmptyPanel>{t("还没有日报")}</EmptyPanel>
            )}
          </div>
        )}
      </div>
    </Shell>
  );
}
