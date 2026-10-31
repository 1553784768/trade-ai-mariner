"use client";
import { t } from "@/i18n/runtime";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconCheck, IconX, IconInfoCircle, IconCalendar, IconRefresh } from "@tabler/icons-react";
import { api, type Schema } from "@/lib/api";
import { modifierLabel } from "@/lib/platform";
import { decisionLabels } from "@/lib/labels";
import { useTradeQuery } from "@/components/trade-ui";
import type { TariffLink } from "@/lib/trade-types";
import { TariffCustomerLink } from "@/components/tariff-bridge";
import { Shell, useMeta } from "@/components/shell";
import { ImportDialog } from "@/components/import-dialog";
import {
  ImpactCard,
  ImpactDocument,
  DecisionHistoryTable,
  CriticalEventsPanel,
  Tabs,
  PrimaryButton,
  ErrorBanner,
  EmptyPanel,
  LoadingPanel,
  Tag,
  stateTone,
  riskTone,
} from "@/components/ui";
function Inbox() {
  const router = useRouter(),
    params = useSearchParams(),
    cache = useQueryClient(),
    meta = useMeta();
  const [actionIndices, setActionIndices] = useState<number[]>([]),
    [noteOpen, setNoteOpen] = useState(false),
    [note, setNote] = useState(""),
    [hint, setHint] = useState(false),
    [group, setGroup] = useState("all"),
    [importOpen, setImportOpen] = useState(false);
  const tab = params.get("tab") === "urgent" ? "urgent" : "all",
    query = params.get("q") || "";
  const cards = useQuery({
    queryKey: ["impacts", tab, group, query],
    queryFn: () =>
      api<Schema<"ImpactCard">[]>(
        `/impacts?incoterm_group=${group}&q=${encodeURIComponent(query)}${tab === "urgent" ? "&risk=红,橙&decision=pending" : ""}`,
      ),
  });
  const all = useQuery({
    queryKey: ["impacts", "all", "all", ""],
    queryFn: () => api<Schema<"ImpactCard">[]>("/impacts"),
  });
  const links = useTradeQuery<TariffLink[]>("/trade-tariff/links");
  const selected = params.get("order") || cards.data?.[0]?.order_id;
  const detail = useQuery({
    queryKey: ["impact", selected],
    enabled: !!selected && !!cards.data?.length,
    queryFn: () => api<Schema<"ImpactDetail">>(`/impacts/${selected}`),
  });
  const history = useQuery({
    queryKey: ["decisions", 4],
    queryFn: () => api<Schema<"DecisionRow">[]>("/decisions?limit=4"),
  });
  const watches = useQuery({
    queryKey: ["watches"],
    queryFn: () => api<Schema<"WatchItem">[]>("/watch-items"),
  });
  const recalc = useMutation({
    mutationFn: () => api("/runs", { method: "POST" }),
    onSuccess: () => cache.invalidateQueries(),
  });
  const decision = useMutation({
    mutationFn: (kind: Schema<"DecisionRequest">["decision"]) =>
      api(`/impacts/${selected}/decision`, {
        method: "POST",
        body: JSON.stringify({
          decision: kind,
          ...(kind === "adopted"
            ? { action_indices: actionIndices }
            : kind === "needs_detail"
              ? { note }
              : {}),
        }),
      }),
    onSuccess: () => {
      setNoteOpen(false);
      setNote("");
      cache.invalidateQueries();
    },
  });
  const [previousSelected, setPreviousSelected] = useState(selected);
  if (previousSelected !== selected) {
    setPreviousSelected(selected);
    setActionIndices([]);
    setNoteOpen(false);
    setNote("");
    setHint(false);
  }
  useEffect(() => {
    if (!params.get("order") && cards.data?.length) {
      const next = new URLSearchParams(params.toString());
      next.set("order", cards.data[0].order_id);
      router.replace(`/tariff/inbox?${next}`, { scroll: false });
    }
  }, [params, cards.data, router]);
  useEffect(() => {
    if (!hint) return;
    const timer = setTimeout(() => setHint(false), 2000);
    return () => clearTimeout(timer);
  }, [hint]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest("input,textarea,select,[contenteditable],[role=dialog]") ||
        !(e.ctrlKey || e.metaKey) ||
        !selected ||
        importOpen ||
        decision.isPending ||
        !detail.data ||
        !cards.data?.length
      )
        return;
      const kind =
        e.key === "Enter"
          ? "adopted"
          : e.key === "Backspace"
            ? "dismissed"
            : e.key.toLowerCase() === "d"
              ? "needs_detail"
              : null;
      if (kind) {
        e.preventDefault();
        if (kind === "needs_detail") setNoteOpen(true);
        else if (kind === "adopted" && !actionIndices.length) setHint(true);
        else decision.mutate(kind);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selected, importOpen, decision, detail.data, actionIndices, cards.data]);
  const setFilter = (id: string) => {
    const next = new URLSearchParams(params.toString());
    if (id === "urgent") next.set("tab", "urgent");
    else next.delete("tab");
    next.delete("order");
    router.replace(`/tariff/inbox?${next}`, { scroll: false });
  };
  const error =
    cards.error || detail.error || recalc.error || decision.error || history.error || watches.error;
  const retry = () => {
    void cards.refetch();
    void detail.refetch();
    void history.refetch();
    void watches.refetch();
    if (recalc.error) recalc.mutate();
    if (decision.error && decision.variables) decision.mutate(decision.variables);
  };
  const v = detail.data;
  return (
    <Shell title={t("订单风险收件箱")}>
      <div className="filter-row">
        <Tabs
          segmented
          value={tab}
          onChange={setFilter}
          items={[
            { id: "all", label: t("全部") },
            { id: "urgent", label: t("紧急"), count: meta.data?.counts.urgent },
          ]}
        />
        <label className="dropdown">
          <span className="dropdown-label">{t("贸易术语")}</span>
          <select
            aria-label={t("贸易术语")}
            value={group}
            onChange={(e) => {
              setGroup(e.target.value);
              const next = new URLSearchParams(params.toString());
              next.delete("order");
              router.replace(`/tariff/inbox?${next}`, { scroll: false });
            }}
          >
            <option value="all">{t("全部")}</option>
            <option value="ddp">DDP</option>
            <option value="non_ddp">{t("非 DDP")}</option>
          </select>
        </label>
        <span className="spacer" />
        <span className="date-range">
          <IconCalendar />
          {t("规则快照")} {meta.data?.as_of || "—"}
        </span>
        <button className="btn" disabled={recalc.isPending} onClick={() => recalc.mutate()}>
          <IconRefresh />
          {t("重新计算")}
        </button>
        <PrimaryButton onClick={() => setImportOpen(true)}>{t("+ 导入订单")}</PrimaryButton>
      </div>
      {error && <ErrorBanner error={error} retry={retry} />}
      <div className="panels fill">
        <section className="metrics-list">
          <div className="list-head">
            <span className="route-visits">{t("排序：预计入境 最近优先 ↓")}</span>
          </div>
          {cards.isPending && <LoadingPanel />}
          {cards.data?.map((card) => (
            <ImpactCard
              key={card.order_id}
              value={card}
              customerName={links.data?.find((link) => link.tariff_order_id === card.order_id)?.customer_name}
              selected={card.order_id === selected}
              onClick={() => {
                const next = new URLSearchParams(params.toString());
                next.set("order", card.order_id);
                router.replace(`/tariff/inbox?${next}`, { scroll: false });
              }}
            />
          ))}
        </section>
        {cards.data?.length === 0 ? (
          <EmptyPanel>{t("暂无订单，请先导入 CSV")}</EmptyPanel>
        ) : v ? (
          <ImpactDocument
            key={v.order_id}
            value={v}
            linkedCustomer={<TariffCustomerLink id={v.order_id} />}
            actionHint={hint}
            selected={actionIndices}
            onToggle={(i) =>
              setActionIndices((current) =>
                current.includes(i) ? current.filter((v) => v !== i) : [...current, i].sort((a, b) => a - b),
              )
            }
            actions={
              <aside className="detail-actions">
                <span data-testid="decision-state">
                  <Tag tone={stateTone[v.decision]}>{decisionLabels[v.decision]}</Tag>
                </span>
                {!!v.adopted_actions?.length && (
                  <p className="decision-explanation" style={{ fontSize: 12, color: "var(--color-ink-500)" }}>
                    {t("已采纳：第 {p0} 条", {
                      p0: v.adopted_actions.map((a) => String(a.index + 1).padStart(2, "0")).join(t("、")),
                    })}
                  </p>
                )}
                {v.note && (
                  <p
                    className="decision-explanation"
                    title={v.note}
                    style={{
                      fontSize: 12,
                      color: "var(--color-ink-500)",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                      maxWidth: 330,
                    }}
                  >
                    {t("补充说明：")}
                    {v.note}
                  </p>
                )}
                <div className="row">
                  <button
                    className="btn btn-good"
                    disabled={decision.isPending || !actionIndices.length}
                    onClick={() => decision.mutate("adopted")}
                  >
                    <IconCheck />
                    {t("采纳建议（{n}）", { n: actionIndices.length })}
                  </button>
                  <button
                    className="btn btn-bad-outline"
                    disabled={decision.isPending}
                    onClick={() => decision.mutate("dismissed")}
                  >
                    <IconX />
                    {t("不处理")}
                  </button>
                  <button
                    className="btn btn-warn-outline"
                    disabled={decision.isPending}
                    onClick={() => setNoteOpen(true)}
                  >
                    <IconInfoCircle />
                    {t("需补充")}
                  </button>
                </div>
                <div className="row kbd-hint">
                  {["Enter", "Backspace", "D"].map((key) => (
                    <kbd className="kbd font-sans" key={key}>
                      {modifierLabel()} {key}
                    </kbd>
                  ))}
                </div>
              </aside>
            }
            notePanel={
              noteOpen && (
                <section className="inline-panel">
                  <div className="field">
                    <label htmlFor="detail-note">{t("补充说明（必填）")}</label>
                    <textarea
                      className="textarea"
                      rows={4}
                      id="detail-note"
                      value={note}
                      maxLength={500}
                      autoFocus
                      onChange={(e) => setNote(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.stopPropagation();
                          setNoteOpen(false);
                        }
                        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                          e.preventDefault();
                          e.stopPropagation();
                          if (note.trim() && !decision.isPending) decision.mutate("needs_detail");
                        }
                      }}
                    />
                    <small className="field-help" style={{ textAlign: "right" }}>
                      {note.length}/500
                    </small>
                  </div>
                  <div className="row">
                    <button
                      className="btn btn-warn"
                      disabled={!note.trim() || decision.isPending}
                      onClick={() => decision.mutate("needs_detail")}
                    >
                      {t("提交")}
                    </button>
                    <button className="btn" onClick={() => setNoteOpen(false)}>
                      {t("取消")}
                    </button>
                  </div>
                </section>
              )
            }
          />
        ) : (
          <LoadingPanel />
        )}
      </div>
      {watches.data && <CriticalEventsPanel items={watches.data} />}{" "}
      {history.data && (
        <DecisionHistoryTable
          decisions={history.data}
          risks={Object.fromEntries(
            (all.data || []).map((card) => [card.order_id, riskTone[card.risk_level]]),
          )}
        />
      )}
      {importOpen && <ImportDialog close={() => setImportOpen(false)} />}
    </Shell>
  );
}
export default function Page() {
  return (
    <Suspense fallback={<LoadingPanel />}>
      <Inbox />
    </Suspense>
  );
}
