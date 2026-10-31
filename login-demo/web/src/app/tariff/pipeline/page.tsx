"use client";
import { t } from "@/i18n/runtime";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconClock, IconRefresh } from "@tabler/icons-react";
import { api, ApiFailure, type Schema } from "@/lib/api";
import { agentLabels, statusLabels } from "@/lib/labels";
import { Shell, useMeta } from "@/components/shell";
import {
  AuditLog,
  EmptyPanel,
  LoadingPanel,
  ErrorBanner,
  PipelineFlow,
  PrimaryButton,
  Tag,
  Tabs,
  stateTone,
} from "@/components/ui";
function duration(step: Schema<"PipelineStep">) {
  return step.started_at && step.finished_at
    ? new Date(step.finished_at).getTime() - new Date(step.started_at).getTime()
    : "—";
}
function Pipeline() {
  const [id, setId] = useState("latest"),
    [tab, setTab] = useState("steps"),
    cache = useQueryClient(),
    meta = useMeta();
  const router = useRouter(),
    params = useSearchParams();
  const pipeline = useQuery({
    queryKey: ["pipeline", id],
    queryFn: () => api<Schema<"PipelineRun">>(`/pipeline/runs/${id}`),
    refetchInterval: (query) => (query.state.data?.status === "running" ? 2000 : false),
  });
  const audit = useQuery({
    queryKey: ["audit", 20, pipeline.data?.status],
    queryFn: () => api<Schema<"AuditEvent">[]>("/audit?limit=20"),
  });
  const run = useMutation({
    mutationFn: () => api<Schema<"PipelineRun">>("/pipeline/runs", { method: "POST" }),
    onSuccess: (value) => {
      cache.setQueryData(["pipeline", value.id], value);
      setId(value.id);
      void cache.invalidateQueries({ queryKey: ["meta"] });
      router.replace("/tariff/pipeline", { scroll: false });
    },
  });
  const data = pipeline.data,
    busy = run.isPending || data?.status === "running";
  const selected =
    data?.steps.find((s) => s.agent === params.get("step")) ||
    data?.steps.find((s) => s.status === "failed") ||
    data?.steps[0];
  const select = (agent: string) =>
    router.replace(`/tariff/pipeline?step=${encodeURIComponent(agent)}`, { scroll: false });
  useEffect(() => {
    if (selected && params.get("step") !== selected.agent)
      router.replace(`/tariff/pipeline?step=${encodeURIComponent(selected.agent)}`, { scroll: false });
  }, [selected, params, router]);
  useEffect(() => {
    if (pipeline.data && pipeline.data.status !== "running") {
      void cache.invalidateQueries({ queryKey: ["meta"] });
      void cache.invalidateQueries({ queryKey: ["drafts"] });
      void cache.invalidateQueries({ queryKey: ["brief-dates"] });
    }
  }, [pipeline.data, cache]);
  const error =
    run.error ||
    (pipeline.error instanceof ApiFailure && pipeline.error.status === 404 ? null : pipeline.error) ||
    (tab === "audit" ? audit.error : null);
  return (
    <Shell title={t("智能体流水线")}>
      <div className="filter-row">
        {data && (
          <>
            <Tag tone={stateTone[data.status]} large>
              {statusLabels[data.status]}
            </Tag>
            <span className="stat-chip">{data.trigger === "manual" ? t("手动") : t("每日 07:30")}</span>
            <span className="date-range">
              <IconClock />
              {data.id}
            </span>
          </>
        )}
        <span className="spacer" />
        <PrimaryButton disabled={busy} onClick={() => run.mutate()}>
          <IconRefresh />
          {t("立即运行")}
        </PrimaryButton>
      </div>
      {error && (
        <ErrorBanner
          error={error}
          retry={() => {
            void pipeline.refetch();
            void audit.refetch();
          }}
        />
      )}
      <div className="panels fill">
        {data ? (
          <>
            <aside className="metrics-list">
              {data.steps.map((s) => (
                <button
                  type="button"
                  key={s.agent}
                  data-step={s.agent}
                  className={`metric-card compact${selected?.agent === s.agent ? " active" : ""}`}
                  style={{ textAlign: "left" }}
                  onClick={() => select(s.agent)}
                >
                  <div className="metric-label" style={{ marginBottom: 6 }}>
                    {agentLabels[s.agent]}
                  </div>
                  <div className="metric-value-row" style={{ marginBottom: 8 }}>
                    <span className="metric-value sm">{duration(s)}</span>
                    <span className="metric-unit">ms</span>
                    <span className="tabs-spacer" />
                    <Tag tone={stateTone[s.status]}>{statusLabels[s.status]}</Tag>
                  </div>
                  <div className="metric-bar">
                    <i className={`tone-${stateTone[s.status] || "muted"}`} style={{ width: "100%" }} />
                  </div>
                </button>
              ))}
            </aside>
            <article className="detail-panel">
              {selected && (
                <div className="detail-top">
                  <div className="detail-left wide">
                    <div className="device-tag">
                      {t("智能体")} · {selected.agent}
                    </div>
                    <h2 className="detail-heading">{agentLabels[selected.agent]}</h2>
                    <dl className="kv cols-5">
                      {(["input", "output", "skipped", "errors"] as const).map((key, i) => (
                        <div key={key}>
                          <dt>{t(["输入", "输出", "跳过", "错误"][i])}</dt>
                          <dd className="big">{selected.counts[key]}</dd>
                        </div>
                      ))}
                      <div>
                        <dt>{t("耗时")}</dt>
                        <dd className="big">
                          {duration(selected)}
                          <span className="metric-unit"> ms</span>
                        </dd>
                      </div>
                    </dl>
                    {selected.message && (
                      <p className={selected.status === "failed" ? "banner bad" : "detail-copy"}>
                        {selected.message}
                      </p>
                    )}
                  </div>
                </div>
              )}
              <div className="chart-wrap">
                <div className="chart-head">
                  <span className="chart-title">{t("智能体流水线")}</span>
                </div>
                <PipelineFlow pipeline={data} drafts={meta.data?.counts.drafts_pending} />
              </div>
              <Tabs
                value={tab}
                onChange={setTab}
                items={[
                  { id: "steps", label: t("步骤") },
                  { id: "audit", label: t("审计日志") },
                ]}
                suffix={t("不可篡改 · SHA-256 链式")}
              />
              <div className="tab-body">
                {tab === "steps" ? (
                  <table className="table" data-testid="pipeline-steps">
                    <thead>
                      <tr>
                        {["智能体", "状态", "输入", "输出", "跳过", "错误", "耗时"].map((h, i) => (
                          <th key={h} className={i > 1 ? "num" : ""}>
                            {t(h)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.steps.map((s) => (
                        <tr
                          key={s.agent}
                          data-agent={s.agent}
                          className="clickable"
                          tabIndex={0}
                          onClick={() => select(s.agent)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              select(s.agent);
                            }
                          }}
                        >
                          <td>{agentLabels[s.agent]}</td>
                          <td>
                            <Tag tone={stateTone[s.status]}>{statusLabels[s.status]}</Tag>
                          </td>
                          {(["input", "output", "skipped", "errors"] as const).map((key) => (
                            <td className="num" key={key}>
                              {s.counts[key]}
                            </td>
                          ))}
                          <td className="num">
                            {duration(s)}
                            {s.finished_at && " ms"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : audit.isPending ? (
                  <LoadingPanel />
                ) : (
                  audit.data && <AuditLog events={audit.data} />
                )}
              </div>
            </article>
          </>
        ) : (
          <div style={{ gridColumn: "1 / -1" }}>
            {pipeline.isPending ? <LoadingPanel /> : <EmptyPanel>{t("还没有运行记录")}</EmptyPanel>}
          </div>
        )}
      </div>
    </Shell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingPanel />}>
      <Pipeline />
    </Suspense>
  );
}
