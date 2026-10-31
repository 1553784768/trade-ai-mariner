"use client";
import { t, currentLanguage } from "@/i18n/runtime";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconCheck, IconX, IconInfoCircle, IconArrowUpRight } from "@tabler/icons-react";
import { api, type Schema } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { changeLabels, draftLabels, legalLabels, validationLabels } from "@/lib/labels";
import { Shell } from "@/components/shell";
import {
  EmptyPanel,
  ErrorBanner,
  LoadingPanel,
  DecisionButton,
  Tag,
  Tabs,
  SeverityGrid,
  amountTone,
  stateTone,
} from "@/components/ui";
function highlighted(value: Schema<"RuleDraftDetail">) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const h of [...value.highlights].sort((a, b) => a.start - b.start)) {
    if (h.start < cursor) continue;
    parts.push(value.source_text.slice(cursor, h.start));
    parts.push(
      <mark className="mark" key={`${h.start}-${h.field}`} title={h.field}>
        {value.source_text.slice(h.start, h.end)}
      </mark>,
    );
    cursor = h.end;
  }
  parts.push(value.source_text.slice(cursor));
  return parts;
}
function DraftTags({ draft }: { draft: Schema<"RuleDraft"> }) {
  return (
    <div className="chips">
      <Tag tone="outline">{legalLabels[draft.legal_status]}</Tag>
      <Tag tone="outline">{changeLabels[draft.change.change_type]}</Tag>
      <Tag tone={stateTone[draft.status]}>{draftLabels[draft.status]}</Tag>
    </div>
  );
}
function Review() {
  const params = useSearchParams(),
    router = useRouter(),
    cache = useQueryClient();
  const [tab, setTab] = useState("validation");
  const cards = useQuery({ queryKey: ["drafts"], queryFn: () => api<Schema<"RuleDraft">[]>("/rule-drafts") });
  const id = params.get("draft") || cards.data?.[0]?.id;
  useEffect(() => {
    if (!params.get("draft") && id)
      router.replace(`/tariff/review?draft=${encodeURIComponent(id)}`, { scroll: false });
  }, [id, params, router]);
  const detail = useQuery({
    queryKey: ["draft", id],
    enabled: !!id,
    queryFn: () => api<Schema<"RuleDraftDetail">>(`/rule-drafts/${id}`),
  });
  const review = useMutation({
    mutationFn: (action: Schema<"ReviewRequest">["action"]) =>
      api(`/rule-drafts/${id}/review`, { method: "POST", body: JSON.stringify({ action }) }),
    onSuccess: () => cache.invalidateQueries(),
  });
  const draft = detail.data,
    disabled = review.isPending || !draft || ["approved", "rejected"].includes(draft.status);
  const error = cards.error || detail.error || review.error;
  const na = draft?.validation.filter((v) => v.status === "n/a").map((v) => v.check);
  return (
    <Shell title={t("规则审核")}>
      <div className="filter-row">
        {(["draft", "needs_detail", "approved", "rejected"] as const).map((status) => (
          <span className="stat-chip" key={status}>
            <span className={`dot ${stateTone[status]}`} />
            <b>{cards.data?.filter((d) => d.status === status).length ?? 0}</b>
            {draftLabels[status]}
          </span>
        ))}
      </div>
      {error && (
        <ErrorBanner
          error={error}
          retry={() => {
            void cards.refetch();
            if (id) void detail.refetch();
          }}
        />
      )}
      <div className="panels fill">
        <aside className="metrics-list">
          {cards.isPending && <LoadingPanel />}
          {cards.data?.length === 0 && <EmptyPanel>{t("暂无待确认的规则草稿")}</EmptyPanel>}
          {cards.data?.map((d) => (
            <button
              type="button"
              key={d.id}
              className={`metric-card${id === d.id ? " active" : ""}`}
              style={{ textAlign: "left" }}
              data-draft={d.id}
              onClick={() =>
                router.replace(`/tariff/review?draft=${encodeURIComponent(d.id)}`, { scroll: false })
              }
            >
              <div className="metric-label clamp">
                {d.source_document_number} · {d.title}
              </div>
              <div className="metric-value-row">
                <span
                  className={`metric-value tone-${d.impact_preview ? amountTone(d.impact_preview.profit_delta_usd) : "muted"}`}
                >
                  {d.impact_preview ? formatMoney(d.impact_preview.profit_delta_usd, true) : "—"}
                </span>
                <span className="metric-unit">{t("预估影响 · USD")}</span>
              </div>
              <DraftTags draft={d} />
            </button>
          ))}
        </aside>
        <article className="detail-panel">
          {id && detail.isPending && <LoadingPanel />}
          {!id && !cards.isPending && <EmptyPanel>{t("暂无待确认的规则草稿")}</EmptyPanel>}
          {draft && (
            <>
              <div className="detail-top">
                <div className="detail-left">
                  <div className="device-tag">{draft.source_document_number}</div>
                  <h2 className="detail-heading">{draft.title}</h2>
                  <DraftTags draft={draft} />
                  <p className="detail-copy hint">
                    {t("原文标题：")}
                    {draft.original_title}
                  </p>
                  <p className="detail-copy">{draft.summary_zh}</p>
                  <a href={draft.source_url} target="_blank" rel="noreferrer" className="learn-link">
                    {t("原文")}
                    <IconArrowUpRight />
                  </a>
                </div>
                <div className="detail-actions">
                  <div className="row">
                    <DecisionButton
                      tone="ok"
                      disabled={disabled || draft.validation.some((v) => v.status === "fail")}
                      icon={<IconCheck />}
                      onClick={() => review.mutate("approve")}
                    >
                      {t("确认规则")}
                    </DecisionButton>
                    <DecisionButton
                      tone="bad"
                      disabled={disabled}
                      icon={<IconX />}
                      onClick={() => review.mutate("reject")}
                    >
                      {t("驳回")}
                    </DecisionButton>
                    <DecisionButton
                      tone="warn"
                      disabled={disabled}
                      icon={<IconInfoCircle />}
                      onClick={() => review.mutate("needs_detail")}
                    >
                      {t("需补充")}
                    </DecisionButton>
                  </div>
                </div>
              </div>
              <Tabs
                value={tab}
                onChange={setTab}
                items={[
                  { id: "validation", label: t("校验结果") },
                  { id: "source", label: t("原文") },
                  { id: "impact", label: t("预估影响") },
                ]}
              />
              {tab === "validation" && (
                <>
                  <SeverityGrid
                    checks={draft.validation
                      .filter((v) => v.status !== "n/a")
                      .map((v) => ({
                        key: v.check,
                        label: `${v.check} ${validationLabels[v.check]}`,
                        status: v.status,
                      }))}
                  />
                  {!!na?.length && (
                    <div className="tab-body" style={{ paddingTop: 12 }}>
                      <span className="route-visits">
                        {t("不适用：{list}", { list: na.join(currentLanguage() === "en" ? ", " : "、") })}
                      </span>
                    </div>
                  )}
                </>
              )}
              {tab === "source" && (
                <div className="tab-body" style={{ paddingTop: 12 }}>
                  <div className="source-text" data-testid="source-text">
                    {highlighted(draft)}
                  </div>
                </div>
              )}
              {tab === "impact" && (
                <div className="tab-body">
                  <dl className="kv cols-2">
                    <div>
                      <dt>{t("受影响订单")}</dt>
                      <dd>{draft.impact_preview?.orders_affected ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>{t("利润变化")}</dt>
                      <dd>
                        {draft.impact_preview
                          ? formatMoney(draft.impact_preview.profit_delta_usd, true)
                          : "—"}
                      </dd>
                    </div>
                  </dl>
                </div>
              )}
            </>
          )}
        </article>
      </div>
    </Shell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingPanel />}>
      <Review />
    </Suspense>
  );
}
