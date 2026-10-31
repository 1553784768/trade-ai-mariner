"use client";
import { t } from "@/i18n/runtime";
import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import {
  IconPaperclip,
  IconTrash,
  IconNews,
  IconRefresh,
  IconSend,
  IconAlertTriangle,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiFailure, type Schema } from "@/lib/api";
import type { ChatMessage, Conversation } from "@/lib/v02";
import { useRouter, useSearchParams } from "next/navigation";
import type { ConversationSummary } from "@/lib/v02";
import { formatTime } from "@/lib/format";
import { useI18n } from "@/i18n";
import { Shell, useMeta } from "@/components/shell";
import { ImportPreview } from "@/components/import-preview";
import { ErrorBanner, LoadingPanel, PrimaryButton, EmptyPanel, Switch } from "@/components/ui";

function Workbench() {
  const { lang } = useI18n(),
    cache = useQueryClient(),
    meta = useMeta();
  const [text, setText] = useState(""),
    [orderData, setOrderData] = useState(false);
  const [uploadError, setUploadError] = useState<Error | null>(null);
  const attachment = useRef<HTMLInputElement>(null);
  const router = useRouter(),
    params = useSearchParams();
  const selected = params.get("c");
  const navigating = useRef(false);
  const conversations = useQuery({
    queryKey: ["conversations", lang],
    queryFn: () => api<ConversationSummary[]>("/chat/conversations?limit=50"),
  });
  const conversation = useQuery({
    queryKey: ["conversation", selected || "latest"],
    queryFn: async () => {
      try {
        return await api<Conversation>(
          `/chat/conversations/${selected ? encodeURIComponent(selected) : "latest"}`,
        );
      } catch (error) {
        if (!selected && error instanceof ApiFailure && error.status === 404) return null;
        throw error;
      }
    },
  });
  useEffect(() => {
    if (!selected && conversation.data && !navigating.current) {
      cache.setQueryData(["conversation", conversation.data.id], conversation.data);
      router.replace(`/tariff?c=${encodeURIComponent(conversation.data.id)}`, { scroll: false });
    }
  }, [selected, conversation.data, cache, router]);
  const settings = useQuery({
    queryKey: ["llm-settings"],
    queryFn: () => api<Schema<"LlmSettings">>("/settings/llm"),
  });
  const brief = useQuery({
    queryKey: ["latest-brief"],
    queryFn: async () => {
      try {
        return await api<Schema<"Brief">>("/briefs/latest");
      } catch (error) {
        if (error instanceof ApiFailure && error.status === 404) return null;
        throw error;
      }
    },
  });
  const watches = useQuery({
    queryKey: ["watches"],
    queryFn: () => api<Schema<"WatchItem">[]>("/watch-items"),
  });
  const append = (cid: string, messages: ChatMessage[]) => {
    cache.setQueryData<Conversation>(["conversation", cid], (current) =>
      current ? { ...current, messages: [...current.messages, ...messages] } : current,
    );
    cache.invalidateQueries({ queryKey: ["conversations"] });
  };
  const send = useMutation({
    mutationFn: ({ cid, question }: { cid: string; question: string }) =>
      api<{ user: ChatMessage; assistant: ChatMessage }>(`/chat/conversations/${cid}/messages`, {
        method: "POST",
        body: JSON.stringify({ text: question, lang, use_order_data: orderData }),
      }),
    onSuccess: (value, variables) => {
      append(variables.cid, [value.user, value.assistant]);
      setText("");
    },
  });
  const fresh = useMutation({
    mutationFn: () => {
      navigating.current = true;
      return api<{ id: string }>("/chat/conversations", { method: "POST" });
    },
    onError: () => {
      navigating.current = false;
    },
    onSuccess: (value) => {
      cache.setQueryData(["conversation", "latest"], { ...value, messages: [] });
      cache.setQueryData(["conversation", value.id], { ...value, messages: [] });
      cache.invalidateQueries({ queryKey: ["conversations"] });
      router.replace(`/tariff?c=${value.id}`, { scroll: false });
      setText("");
    },
  });
  const remove = useMutation({
    mutationFn: (cid: string) => api(`/chat/conversations/${cid}`, { method: "DELETE" }),
    onSuccess: (_, cid) => {
      const list = conversations.data || [];
      const position = list.findIndex((v) => v.id === cid);
      const remaining = list.filter((v) => v.id !== cid);
      cache.setQueryData(["conversations", lang], remaining);
      cache.removeQueries({ queryKey: ["conversation", cid] });
      if (conversation.data?.id === cid) {
        const next = remaining[position] || remaining[0];
        cache.setQueryData(["conversation", "latest"], null);
        router.replace(next ? `/tariff?c=${next.id}` : "/tariff", { scroll: false });
      }
      cache.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
  const upload = useMutation({
    mutationFn: async ({ file, cid }: { file: File; cid: string }) => {
      if (file.size > 10 * 1024 * 1024) throw new Error(t("文件过大（上限 10 MB）"));
      const data = new FormData();
      data.append("file", file);
      data.append("conversation_id", cid);
      return api<{ messages: ChatMessage[] }>("/import-jobs", { method: "POST", body: data });
    },
    onSuccess: (value, variables) => append(variables.cid, value.messages),
    onError: (error) => setUploadError(error),
  });
  const pending = send.isPending || upload.isPending || fresh.isPending || remove.isPending;
  const busy = pending || !conversation.data || (!!selected && conversation.data.id !== selected);
  const submit = () => {
    if (text.trim() && !busy) send.mutate({ cid: conversation.data!.id, question: text.trim() });
  };
  const active = conversations.data?.find((item) => item.id === conversation.data?.id);
  const error =
    conversations.error ||
    conversation.error ||
    fresh.error ||
    remove.error ||
    send.error ||
    uploadError ||
    watches.error ||
    brief.error;
  return (
    <Shell title={t("工作台")}>
      <div className="filter-row">
        <Link className="stat-chip" href="/tariff/inbox">
          <span className="dot muted" />
          <b>{meta.data?.counts.pending ?? "—"}</b>
          {t("待处理")}
        </Link>
        <span className="stat-chip">
          <span className="dot bad" />
          <b>{meta.data?.counts.red ?? "—"}</b>
          {t("红色")}
        </span>
        <Link className="stat-chip" href="/tariff/inbox?tab=urgent">
          <span className="dot warn" />
          <b>{meta.data?.counts.urgent ?? "—"}</b>
          {t("紧急")}
        </Link>
        <Link className="stat-chip" href="/tariff/inbox#watch-events">
          <span className="dot caution" />
          <b>{watches.data?.length ?? "—"}</b>
          {t("临界事件")}
        </Link>
        <span className="spacer" />
        {brief.data && (
          <Link className="date-range" href="/tariff/brief">
            <IconNews />
            {t("政策日报 {date}", { date: brief.data.date })}
          </Link>
        )}
      </div>
      {error && (
        <ErrorBanner
          error={error}
          retry={() => {
            void conversation.refetch();
            void conversations.refetch();
            void brief.refetch();
            void watches.refetch();
            if (fresh.error) fresh.mutate();
            if (remove.error && remove.variables) remove.mutate(remove.variables);
            if (send.error && send.variables) send.mutate(send.variables);
            if (uploadError && upload.variables) upload.mutate(upload.variables);
          }}
        />
      )}
      <div className="panels fill">
        <aside className="metrics-list" aria-label={t("对话记录")}>
          <div className="list-head">
            <button className="btn btn-block" disabled={pending} onClick={() => fresh.mutate()}>
              {t("+ 新对话")}
            </button>
          </div>
          {conversations.isPending && <LoadingPanel />}
          {conversations.data?.length === 0 && <EmptyPanel>{t("还没有对话")}</EmptyPanel>}
          {conversations.data?.map((item) => (
            <div
              className={`conv-item${item.id === conversation.data?.id ? " active" : ""}`}
              data-active={item.id === conversation.data?.id}
              key={item.id}
            >
              <button
                className="conv-text"
                style={{ textAlign: "left" }}
                disabled={pending}
                onClick={() => {
                  setText("");
                  router.push(`/tariff?c=${item.id}`, { scroll: false });
                }}
              >
                <span className="conv-title">{item.title}</span>
                <span className="conv-time" style={{ display: "block" }}>
                  {formatTime(item.updated_at).slice(5)}
                </span>
              </button>
              <button
                className="icon-btn ghost"
                aria-label={`${t("删除")} ${item.title}`}
                disabled={pending}
                onClick={() => {
                  if (confirm(t("确定删除这段对话吗？"))) remove.mutate(item.id);
                }}
              >
                <IconTrash />
              </button>
            </div>
          ))}
        </aside>
        <section className="chat">
          {conversation.data && (
            <div className="chat-head">
              <h2 className="chat-title">{active?.title || t("新对话")}</h2>
              <span className="device-tag" style={{ marginBottom: 0 }}>
                {active?.created_at
                  ? formatTime(active.created_at).slice(5)
                  : conversation.data.created_at
                    ? formatTime(conversation.data.created_at).slice(5)
                    : "—"}
              </span>
            </div>
          )}
          <div className="chat-scroll" aria-live="polite">
            {!meta.data?.llm_configured && (
              <div className="banner warn">
                <IconAlertTriangle />
                {t("未配置模型：只能回答内置示例问题。")}
                <span className="spacer" />
                <Link href="/settings?tab=tariff">{t("去配置 →")}</Link>
              </div>
            )}
            {conversation.isPending && <LoadingPanel />}
            {conversation.data?.messages.map((message, index) => (
              <article
                key={message.id}
                className={`msg ${message.error ? "error" : message.role}`}
                style={message.import_job_id ? { maxWidth: "100%", width: "100%" } : undefined}
              >
                {message.guard && !message.guard.ok && (
                  <div className="banner bad">
                    {t("回答中有知识库里找不到的数字：")}
                    {message.guard.unknown_numbers.join(t("、"))}
                    {t("，请以订单影响单为准")}
                  </div>
                )}
                {!message.import_job_id && <p>{message.text}</p>}
                {message.error && (
                  <button
                    className="btn"
                    style={{ marginTop: 8 }}
                    disabled={busy}
                    onClick={() => {
                      const question = conversation
                        .data!.messages.slice(0, index)
                        .reverse()
                        .find((v) => v.role === "user")?.text;
                      if (question) send.mutate({ cid: conversation.data!.id, question });
                    }}
                  >
                    <IconRefresh />
                    {t("重试")}
                  </button>
                )}
                {!!message.citations.length && (
                  <div className="chips">
                    {message.citations.map((citation) => (
                      <Link
                        className="chip brand"
                        key={citation.id}
                        href={`/tariff/knowledge?id=${encodeURIComponent(citation.id)}`}
                      >
                        {citation.title}
                      </Link>
                    ))}
                  </div>
                )}
                {message.import_job_id && <ImportPreview id={message.import_job_id} />}
              </article>
            ))}
            {send.isPending && (
              <div className="msg assistant" style={{ color: "var(--color-ink-400)" }} role="status">
                {t("思考中…")}
              </div>
            )}
          </div>
          <div className="chat-input">
            <Switch checked={orderData} onChange={setOrderData}>
              {t("对话可使用订单数据")}
            </Switch>
            {orderData && (
              <div className="banner info">
                {t("开启后，检索到的订单和影响单内容会发送给模型")} {settings.data?.model || t("内置夹具")}
              </div>
            )}
            <textarea
              className="textarea"
              disabled={busy}
              rows={3}
              placeholder={t("输入问题，或上传订单文件…")}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <div className="row">
              <input
                ref={attachment}
                type="file"
                hidden
                accept=".csv,.xlsx,.pdf,.png,.jpg,.jpeg"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setUploadError(null);
                    upload.mutate({ file, cid: conversation.data!.id });
                  }
                  e.target.value = "";
                }}
              />
              <button
                aria-label="attachment"
                className="icon-btn"
                disabled={busy}
                onClick={() => attachment.current?.click()}
              >
                <IconPaperclip />
              </button>
              <span className="spacer" />
              <PrimaryButton disabled={busy || !text.trim()} onClick={submit}>
                <IconSend />
                {t("发送")}
              </PrimaryButton>
            </div>
          </div>
        </section>
      </div>
    </Shell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingPanel />}>
      <Workbench />
    </Suspense>
  );
}
