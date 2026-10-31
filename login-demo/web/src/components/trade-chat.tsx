"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { t } from "@/i18n/runtime";
import { tradeApi, jsonBody } from "@/lib/api";
import type {
  CustomerPage,
  DocumentFile,
  Library,
  ModelSettings,
  TradeConversation,
  TradeMessage,
} from "@/lib/trade-types";
import { BRAND } from "@/lib/brand";
import { CONTEXTS } from "@/lib/trade-contexts";
import { shouldUseHermesTools } from "@/lib/chat-state";
import { readSSE } from "@/lib/sse";
import {
  applyToolEvent,
  thinkingStage,
  thinkingText,
  toolStatusLabel,
  type Thinking,
  type ToolEvent,
} from "@/lib/thinking";
import { Shell } from "./shell";
import { Tag } from "./ui";
import { Markdown, useToast, useTradeQuery } from "./trade-ui";
import { TariffSummaryCard } from "./tariff-bridge";

type Message = TradeMessage & { thinkingState?: Thinking; sources?: { title: string; url: string }[] };
type ChatState = {
  cid: number | null;
  messages: Message[];
  busy: boolean;
  controller: AbortController | null;
  lastToolFailed: boolean;
};
const initial: ChatState = { cid: null, messages: [], busy: false, controller: null, lastToolFailed: false };
const ChatContext = createContext<{ state: ChatState; setState: Dispatch<SetStateAction<ChatState>> }>({
  state: initial,
  setState: () => {},
});
export function TradeChatProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(initial);
  return <ChatContext.Provider value={{ state, setState }}>{children}</ChatContext.Provider>;
}
export const useTradeChat = () => useContext(ChatContext);
const busyMessage = "当前回复还在进行中，请等待完成或点击停止后再操作。";
function ThinkingPanel({ value }: { value: Thinking }) {
  const [now, setNow] = useState(value.startedAt);
  useEffect(() => {
    if (!value.active) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [value.active]);
  return (
    <details className="thinking" open={value.active || undefined}>
      <summary>
        {value.active && <span className="spinner" />}{" "}
        {value.active
          ? t(value.statusText || thinkingStage(now - value.startedAt))
          : `${t(value.state === "failed" ? "处理未完成" : "已完成思考")}${value.tools?.length ? ` · ${t("{n} 个工具", { n: value.tools.length })}` : ""} · ${t("{n} 秒", { n: Math.max(1, Math.round((value.durationMs ?? now - value.startedAt) / 1000)) })}`}
      </summary>
      <pre>{t(thinkingText(value))}</pre>
      {!!value.tools?.length && (
        <ul className="tool-list">
          {value.tools.map((tool) => (
            <li key={tool.id}>
              <strong>{t(tool.label)}</strong> · {t(toolStatusLabel(tool.status))}
              <p>{tool.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
export function TradeChat({ daily = false }: { daily?: boolean }) {
  const params = useSearchParams(),
    router = useRouter(),
    cache = useQueryClient(),
    toast = useToast();
  const contextKey = daily ? "daily" : params.get("ctx") || "lead",
    context = CONTEXTS[contextKey] || CONTEXTS.daily;
  const { state, setState } = useTradeChat(),
    stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const [content, setContent] = useState(""),
    [customerId, setCustomerId] = useState(params.get("customer") || ""),
    [libraryId, setLibraryId] = useState(""),
    [documentId, setDocumentId] = useState(params.get("doc") || ""),
    [webSearch, setWebSearch] = useState(true),
    [hermes, setHermes] = useState(true),
    [includeTariff, setIncludeTariff] = useState(false);
  const customers = useTradeQuery<CustomerPage>("/customers?limit=100"),
    libraries = useTradeQuery<Library[]>("/libraries"),
    model = useTradeQuery<ModelSettings>("/model-settings"),
    files = useTradeQuery<DocumentFile[]>(`/libraries/${libraryId}/files`, !!libraryId);
  const requested = params.get("c"),
    loaded = useRef<string | null>(null),
    end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!requested || requested === loaded.current) return;
    const current = stateRef.current;
    if (current.busy && String(current.cid) !== requested) {
      toast(t(busyMessage), true);
      return;
    }
    loaded.current = requested;
    if (String(current.cid) === requested) return;
    let active = true;
    tradeApi<TradeConversation>(`/conversations/${requested}`)
      .then((v) => {
        if (active) {
          setState({ ...initial, cid: v.id, messages: v.messages || [] });
          setCustomerId(String(v.customer_id || ""));
        }
      })
      .catch((e) => toast(e.message, true));
    return () => {
      active = false;
    };
  }, [requested, setState, toast]);
  const requestedCustomer = params.get("customer");
  useEffect(() => {
    if (!requestedCustomer || requested) return;
    if (stateRef.current.busy) {
      toast(t(busyMessage), true);
      return;
    }
    setState(initial);
    setCustomerId(requestedCustomer);
  }, [requestedCustomer, requested, setState, toast]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [state.messages]);
  function patchAssistant(update: (m: Message) => Message) {
    setState((current) => ({
      ...current,
      messages: current.messages.map((m, i) => (i === current.messages.length - 1 ? update(m) : m)),
    }));
  }
  async function send() {
    if (!content.trim() || stateRef.current.busy) return;
    if (!model.data?.has_key) {
      toast(t("请先配置对话模型"), true);
      router.push("/settings?tab=chat");
      return;
    }
    const text = content.trim(),
      controller = new AbortController(),
      start = Date.now();
    const tools = shouldUseHermesTools(hermes, text, state.lastToolFailed),
      force = state.lastToolFailed && tools;
    let cid = state.cid;
    setState((s) => ({ ...s, busy: true, controller }));
    setContent("");
    try {
      if (!cid) {
        const conversation = await tradeApi<TradeConversation>(
          "/conversations",
          jsonBody("POST", {
            title: text.slice(0, 80),
            ...(customerId ? { customer_id: Number(customerId) } : {}),
          }),
        );
        cid = conversation.id;
      }
      const activeCid = cid;
      setState((s) => ({
        ...s,
        cid: activeCid,
        messages: [
          ...s.messages,
          { role: "user", content: text },
          { role: "assistant", content: "", thinkingState: { active: true, startedAt: start, tools: [] } },
        ],
      }));
      const response = await tradeApi<Response>(`/conversations/${cid}/${tools ? "hermes" : "stream"}`, {
        ...jsonBody("POST", {
          content: text,
          skill_id: context.skill,
          document_ids: documentId ? [Number(documentId)] : [],
          web_search: webSearch,
          force_tools: force,
          include_tariff: includeTariff,
        }),
        signal: controller.signal,
        raw: true,
      });
      await readSSE(response, (type, data) => {
        if (type === "delta" || type === "replace")
          patchAssistant((m) => ({
            ...m,
            content: type === "replace" ? String(data.content || "") : m.content + String(data.content || ""),
          }));
        if (type === "reasoning")
          patchAssistant((m) => ({
            ...m,
            thinkingState: {
              ...m.thinkingState!,
              thinking: (m.thinkingState?.thinking || "") + String(data.content || ""),
            },
          }));
        if (type === "status")
          patchAssistant((m) => ({
            ...m,
            thinkingState: { ...m.thinkingState!, statusText: String(data.label || "") },
          }));
        if (type === "tool_start" || type === "tool_result")
          patchAssistant((m) => {
            const thinking = {
              ...m.thinkingState!,
              tools: m.thinkingState?.tools?.map((v) => ({ ...v })) || [],
            };
            applyToolEvent(thinking, type, data as ToolEvent);
            return { ...m, thinkingState: thinking };
          });
        if (type === "sources")
          patchAssistant((m) => ({ ...m, sources: data.sources as Message["sources"] }));
      });
      setState((s) => ({ ...s, lastToolFailed: false }));
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        toast((error as Error).message, true);
        patchAssistant((m) => ({
          ...m,
          thinkingState: { ...m.thinkingState!, state: "failed", statusText: (error as Error).message },
        }));
        setState((s) => ({ ...s, lastToolFailed: tools }));
      }
    } finally {
      patchAssistant((m) => ({
        ...m,
        thinkingState: { ...m.thinkingState!, active: false, durationMs: Date.now() - start },
      }));
      setState((s) => ({ ...s, busy: false, controller: null }));
      void cache.invalidateQueries();
    }
  }
  function newChat() {
    if (state.busy) {
      toast(t(busyMessage), true);
      return;
    }
    setState(initial);
    loaded.current = null;
    const next = new URLSearchParams(params);
    next.delete("c");
    router.replace(`${daily ? "/" : "/chat"}?${next}`);
  }
  async function stop() {
    state.controller?.abort();
    if (state.cid)
      try {
        await tradeApi(`/conversations/${state.cid}/cancel`, jsonBody("POST"));
      } catch (error) {
        toast((error as Error).message, true);
      }
  }
  return (
    <Shell
      title={t(context.title)}
      actions={
        <>
          <Tag>{context.skill}</Tag>
          <span className="spacer" />
          <button className="btn" onClick={newChat}>
            {t("新对话")}
          </button>
        </>
      }
    >
      <div className="chat-stage">
        <div className="chat-feed">
          {!state.messages.length ? (
            <div className="chat-welcome">
              <div className="device-tag">
                {BRAND.name} · {t("业务工作台")}
              </div>
              <h2>{t(context.title)}</h2>
              <p>{t(context.intro)}</p>
              {daily && <TariffSummaryCard />}
              <div className="prompt-chips">
                {[...context.prompts, ...(daily ? ["结合关税风险生成今日简报"] : [])].map((p) => (
                  <button
                    className="btn"
                    key={p}
                    onClick={() => {
                      setContent(t(p));
                      if (p === "结合关税风险生成今日简报") setIncludeTariff(true);
                    }}
                  >
                    {t(p)}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            state.messages.map((m, i) => (
              <article className={`chat-message ${m.role}`} key={m.id || i}>
                <div className="chat-message-label">{t(m.role === "user" ? "你" : "助手")}</div>
                {m.thinkingState && <ThinkingPanel value={m.thinkingState} />}
                <Markdown text={m.content} />
                {m.sources && (
                  <div className="toolbar">
                    {m.sources.map((s) => (
                      <a key={s.url} href={s.url} target="_blank" rel="noreferrer">
                        {s.title}
                      </a>
                    ))}
                  </div>
                )}
                {!state.busy && m.role === "assistant" && (
                  <button
                    className="btn"
                    onClick={() =>
                      navigator.clipboard
                        .writeText(m.content)
                        .then(() => toast(t("已复制")))
                        .catch(() => toast(t("复制失败，请手动复制"), true))
                    }
                  >
                    {t("复制")}
                  </button>
                )}
              </article>
            ))
          )}
          <div ref={end} />
        </div>
        <form
          className="chat-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <div className="chat-options">
            <select
              className="select"
              aria-label={t("关联客户")}
              disabled={!!state.cid || state.busy}
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              <option value="">{t("不关联客户")}</option>
              {customers.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              className="select"
              aria-label={t("参考文档库")}
              value={libraryId}
              onChange={(e) => {
                setLibraryId(e.target.value);
                setDocumentId("");
              }}
            >
              <option value="">{t("选择文档库")}</option>
              {libraries.data?.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            {libraryId && (
              <select
                className="select"
                aria-label={t("参考文档")}
                value={documentId}
                onChange={(e) => setDocumentId(e.target.value)}
              >
                <option value="">{t("不引用文档")}</option>
                {files.data?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.filename}
                  </option>
                ))}
              </select>
            )}
          </div>
          <textarea
            aria-label={t("消息")}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t("输入你的问题…")}
            maxLength={20000}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
          {includeTariff && (
            <div className="banner info">
              {t("开启后，本轮将向对话模型发送关税订单和利润数据，并记录审计。")}
            </div>
          )}
          <div className="toolbar">
            <div className="chat-options">
              <label>
                <input type="checkbox" checked={webSearch} onChange={(e) => setWebSearch(e.target.checked)} />
                {t("联网搜索")}
              </label>
              <label>
                <input type="checkbox" checked={hermes} onChange={(e) => setHermes(e.target.checked)} />
                {t("Hermes 工具")}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={includeTariff}
                  onChange={(e) => setIncludeTariff(e.target.checked)}
                />
                {t("引用关税数据")}
              </label>
            </div>
            <span className="spacer" />
            {state.busy ? (
              <button className="btn" type="button" onClick={() => void stop()}>
                {t("停止")}
              </button>
            ) : (
              <button className="btn btn-primary" disabled={!content.trim()}>
                {t("发送")}
              </button>
            )}
          </div>
        </form>
      </div>
    </Shell>
  );
}
