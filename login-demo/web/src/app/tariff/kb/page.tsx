"use client";
import { IconSearch, IconPencil, IconRestore, IconTrash } from "@tabler/icons-react";
import { t } from "@/i18n/runtime";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatTime } from "@/lib/format";
import type { KnowledgeEntry } from "@/lib/v02";
import { useI18n } from "@/i18n";
import { Shell } from "@/components/shell";
import { EmptyPanel, ErrorBanner, LoadingPanel, PrimaryButton, Tag, Switch } from "@/components/ui";

function Knowledge() {
  const { lang } = useI18n();
  const params = useSearchParams(),
    router = useRouter(),
    cache = useQueryClient();
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [sensitive, setSensitive] = useState(false);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [system, setSystem] = useState(false);
  const [title, setTitle] = useState(""),
    [body, setBody] = useState("");
  const entries = useQuery({
    queryKey: ["kb", type, query, sensitive, lang],
    queryFn: () =>
      api<KnowledgeEntry[]>(
        `/kb?type=${type === "deleted" ? "" : type}&deleted=${type === "deleted"}&q=${encodeURIComponent(query)}&include_sensitive=${sensitive}&limit=200`,
      ),
  });
  const id = params.get("id") || entries.data?.[0]?.id;
  const detail = useQuery({
    queryKey: ["kb-detail", id, lang],
    enabled: !!id && !creating,
    queryFn: () => api<KnowledgeEntry>(`/kb/${encodeURIComponent(id!)}`),
  });
  const value = detail.data;
  const [previousId, setPreviousId] = useState(id);
  if (previousId !== id) {
    setPreviousId(id);
    setEditing(false);
    setSystem(false);
  }
  const mutation = useMutation({
    mutationFn: async (action: string) => {
      if (action === "create")
        return api<KnowledgeEntry>("/kb", {
          method: "POST",
          body: JSON.stringify({ [`title_${lang}`]: title, [`body_${lang}`]: body }),
        });
      return api<KnowledgeEntry>(
        `/kb/${encodeURIComponent(id!)}${action === "undelete" ? "/undelete" : action === "restore" ? "/restore" : ""}`,
        {
          method:
            action === "delete" ? "DELETE" : action === "restore" || action === "undelete" ? "POST" : "PUT",
          ...(action !== "delete" ? { body: JSON.stringify({ lang, title, body }) } : {}),
        },
      );
    },
    onSuccess: (result, action) => {
      setEditing(false);
      setCreating(false);
      setSystem(false);
      if (action === "create") router.replace(`/tariff/knowledge?id=${encodeURIComponent(result.id)}`);
      if (action === "delete") {
        cache.setQueryData<KnowledgeEntry[]>(["kb", type, query, sensitive, lang], (current) =>
          (current || []).filter((entry) => entry.id !== id),
        );
        router.replace("/tariff/knowledge");
      }
      cache.invalidateQueries();
    },
  });
  const typeLabel = (key: string) =>
    ({
      policy: t("政策"),
      watch: t("观察项"),
      rule: t("规则"),
      brief: t("日报"),
      order: t("订单"),
      impact: t("影响单"),
      manual: t("手动"),
    })[key] || key;
  useEffect(() => {
    if (!params.get("id") && !creating && entries.data?.length) {
      router.replace(`/tariff/knowledge?id=${encodeURIComponent(entries.data[0].id)}`, { scroll: false });
    }
  }, [params, creating, entries.data, router]);
  const resetFilter = (next: string) => {
    setType(next);
    setCreating(false);
    setEditing(false);
    router.replace("/tariff/knowledge", { scroll: false });
  };
  const error = entries.error || mutation.error || (!creating ? detail.error : null);
  return (
    <Shell title={t("知识库")}>
      <div className="filter-row">
        <label className="dropdown">
          <span className="dropdown-label">{t("类型")}</span>
          <select aria-label={t("类型")} value={type} onChange={(e) => resetFilter(e.target.value)}>
            {[
              ["", t("全部")],
              ["policy", t("政策")],
              ["watch", t("观察项")],
              ["rule", t("规则")],
              ["brief", t("日报")],
              ["order", t("订单")],
              ["impact", t("影响单")],
              ["manual", t("手动")],
              ["deleted", t("已删除")],
            ].map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <Switch checked={sensitive} onChange={setSensitive}>
          {t("显示订单数据")}
        </Switch>
        <span className="spacer" />
        <PrimaryButton
          onClick={() => {
            setCreating(true);
            setEditing(true);
            setTitle("");
            setBody("");
          }}
        >
          {t("+ 新建条目")}
        </PrimaryButton>
      </div>
      {error && (
        <ErrorBanner
          error={error}
          retry={() => {
            void entries.refetch();
            void detail.refetch();
            if (mutation.error && mutation.variables) mutation.mutate(mutation.variables);
          }}
        />
      )}
      <div className="panels fill">
        <aside className="metrics-list">
          <div className="list-head">
            <div className="search-box" style={{ marginBottom: 0 }}>
              <IconSearch size={14} />
              <input
                placeholder={t("搜索知识库…")}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  router.replace("/tariff/knowledge", { scroll: false });
                }}
              />
            </div>
          </div>
          {entries.isPending && <LoadingPanel />}
          {entries.data?.length === 0 && <EmptyPanel>{t("暂无条目")}</EmptyPanel>}
          {entries.data?.map((entry) => (
            <button
              key={entry.id}
              className={`metric-card compact${entry.id === id ? " active" : ""}`}
              style={{ textAlign: "left" }}
              data-knowledge={entry.id}
              data-selected={entry.id === id}
              onClick={() => {
                setCreating(false);
                router.replace(`/tariff/knowledge?id=${encodeURIComponent(entry.id)}`, { scroll: false });
              }}
            >
              <div className="metric-label clamp" style={{ marginBottom: 8 }}>
                {entry.title}
              </div>
              <div className="chips">
                <Tag>{typeLabel(entry.source_type)}</Tag>
                {entry.edited && <Tag tone="brand">{t("已编辑")}</Tag>}
                {entry.source_changed && <Tag tone="warn">{t("来源已更新")}</Tag>}
                {!entry.editable && <Tag>{t("只读")}</Tag>}
              </div>
            </button>
          ))}
        </aside>
        <article className="detail-panel" data-testid="knowledge-detail">
          {detail.isPending && id && !creating && <LoadingPanel />}
          {!creating && !value && !entries.isPending && (!id || !detail.isPending) && (
            <EmptyPanel>{t("暂无条目")}</EmptyPanel>
          )}
          {value?.deleted && !creating && (
            <div className="detail-body" style={{ paddingTop: 22, paddingBottom: 0 }}>
              <div className="banner warn" data-testid="deleted-banner">
                <IconTrash />
                {t("已删除")}
                <span className="spacer" />
                <button
                  className="btn"
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate("undelete")}
                >
                  <IconRestore />
                  {t("恢复")}
                </button>
              </div>
            </div>
          )}
          {value?.source_changed && !value.deleted && !creating && (
            <div className="detail-body" style={{ paddingTop: 22, paddingBottom: 0 }}>
              <div className="banner warn">
                {t("来源已更新，当前显示的是你编辑过的版本")}
                <span className="spacer" />
                <button className="btn" onClick={() => setSystem(!system)}>
                  {t("查看系统版本")}
                </button>
                <button
                  className="btn"
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate("restore")}
                >
                  {t("恢复")}
                </button>
              </div>
            </div>
          )}
          {system && value && !value.deleted && !creating && (
            <section className="inline-panel" data-testid="system-version">
              <h3>{value[`auto_title_${lang}`]}</h3>
              <p className="body-text">{value[`auto_body_${lang}`]}</p>
            </section>
          )}
          {editing ? (
            <form
              className="detail-body"
              style={{ paddingTop: 22 }}
              onSubmit={(e) => {
                e.preventDefault();
                mutation.mutate(creating ? "create" : "edit");
              }}
            >
              <div className="field">
                <label htmlFor="knowledge-title">{t("标题")}</label>
                <input
                  id="knowledge-title"
                  className="input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="knowledge-body">{t("正文")}</label>
                <textarea
                  id="knowledge-body"
                  className="textarea"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  required
                  rows={12}
                />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <PrimaryButton disabled={mutation.isPending || !title.trim() || !body.trim()}>
                  {t("保存")}
                </PrimaryButton>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setEditing(false);
                    setCreating(false);
                  }}
                >
                  {t("取消")}
                </button>
              </div>
            </form>
          ) : (
            value && (
              <>
                <div className="detail-top">
                  <div className="detail-left wide">
                    <div className="device-tag">
                      {t("{type} · 更新于 {date}", {
                        type: typeLabel(value.source_type),
                        date: formatTime(value.updated_at).slice(5),
                      })}
                    </div>
                    <h2 className="detail-heading">{value[`title_${lang}`] || value.title_zh}</h2>
                  </div>
                  {!value.deleted && (
                    <aside className="detail-actions">
                      <div className="row">
                        {value.editable ? (
                          <button
                            className="btn"
                            onClick={() => {
                              setTitle(value[`title_${lang}`] || "");
                              setBody(value[`body_${lang}`] || "");
                              setEditing(true);
                            }}
                          >
                            <IconPencil />
                            {t("编辑")}
                          </button>
                        ) : (
                          <Tag>{t("系统生成，只读")}</Tag>
                        )}
                        {value.source_type !== "manual" && value[`edited_${lang}`] && (
                          <button
                            className="btn"
                            disabled={mutation.isPending}
                            onClick={() => mutation.mutate("restore")}
                          >
                            <IconRestore />
                            {t("恢复系统版本")}
                          </button>
                        )}
                        <button
                          className="btn btn-danger-text"
                          disabled={mutation.isPending}
                          onClick={() => {
                            const question =
                              value.source_type === "manual"
                                ? "确定删除这条知识吗？"
                                : "删除后，这条内容不再出现在知识库列表和对话中，可在「已删除」中恢复。不影响订单、规则和关税计算。确定删除吗？";
                            if (confirm(t(question))) mutation.mutate("delete");
                          }}
                        >
                          <IconTrash />
                          {t("删除")}
                        </button>
                      </div>
                    </aside>
                  )}
                </div>
                <div className="detail-body">
                  <p className="body-text" data-testid="knowledge-body">
                    {value[`body_${lang}`] || value.body_zh}
                  </p>
                </div>
              </>
            )
          )}
        </article>
      </div>
    </Shell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingPanel />}>
      <Knowledge />
    </Suspense>
  );
}
