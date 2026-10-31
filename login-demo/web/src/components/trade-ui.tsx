"use client";
import {
  createContext,
  cloneElement,
  isValidElement,
  type ReactElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { t } from "@/i18n/runtime";
import { tradeApi } from "@/lib/api";
import { EmptyPanel, ErrorBanner, LoadingPanel } from "./ui";

const ToastContext = createContext<(message: string, error?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastContext);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<{ id: number; text: string; error: boolean }[]>([]);
  const sequence = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const notify = useCallback((text: string, error = false) => {
    const id = ++sequence.current;
    setMessages((m) => [...m, { id, text, error }]);
    timers.current.push(setTimeout(() => setMessages((m) => m.filter((v) => v.id !== id)), 4000));
  }, []);
  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {messages.map((m) => (
          <div key={m.id} className={`toast${m.error ? " error" : ""}`}>
            {m.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export function Field({ label, children, help }: { label: string; children: ReactNode; help?: string }) {
  return (
    <label className="field">
      <span>{t(label)}</span>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{ "aria-label"?: string }>, {
            "aria-label": (children.props as { "aria-label"?: string })["aria-label"] || t(label),
          })
        : children}
      {help && <span className="field-help">{t(help)}</span>}
    </label>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null),
    heading = useId(),
    close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.querySelector<HTMLElement>("input,select,textarea,button")?.focus();
    const keyboard = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
      if (e.key === "Tab") {
        const items = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]",
          ) || [],
        );
        const first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("keydown", keyboard);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal${wide ? " wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={heading}
      >
        <div className="modal-head">
          <h2 id={heading}>{t(title)}</h2>
          <button type="button" className="btn" aria-label={t("关闭")} onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
export function Markdown({ text }: { text: string }) {
  const html =
    typeof window === "undefined"
      ? ""
      : DOMPurify.sanitize(marked.parse(text || "", { breaks: true, gfm: true, async: false }));
  return <div className="md-body" dangerouslySetInnerHTML={{ __html: html }} />;
}
export function ListDetail({ list, children }: { list: ReactNode; children: ReactNode }) {
  return (
    <div className="panels fill">
      <aside className="metrics-list">{list}</aside>
      <article className="detail-panel trade-detail">{children}</article>
    </div>
  );
}
export function SelectCard({
  active,
  title,
  children,
  onClick,
}: {
  active: boolean;
  title: string;
  children?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`metric-card compact${active ? " active" : ""}`} onClick={onClick}>
      <strong>{title}</strong>
      <div className="card-meta">{children}</div>
    </button>
  );
}
export function QueryState({
  query,
}: {
  query: { isPending: boolean; error: Error | null; refetch: () => unknown };
}) {
  return query.isPending ? (
    <LoadingPanel />
  ) : query.error ? (
    <ErrorBanner error={query.error} retry={() => query.refetch()} />
  ) : null;
}
export function useTradeQuery<T>(path: string, enabled = true) {
  return useQuery({ queryKey: ["trade", path], queryFn: () => tradeApi<T>(path), enabled });
}
export function useAction() {
  const toast = useToast(),
    cache = useQueryClient(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Error | null>(null);
  async function run<T>(
    action: () => Promise<T>,
    message = "已保存",
    after?: (result: T) => void,
    invalidate = true,
  ) {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (invalidate) await cache.invalidateQueries();
      if (message) toast(t(message));
      after?.(result);
      return result;
    } catch (error) {
      setError(error as Error);
      toast((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error };
}
export function useSelection(key = "id") {
  const params = useSearchParams(),
    router = useRouter(),
    pathname = usePathname();
  return [
    params.get(key) || "",
    (value: string | number) => {
      const next = new URLSearchParams(params);
      next.set(key, String(value));
      router.replace(`${pathname}?${next}`, { scroll: false });
    },
  ] as const;
}
export function FileButton({
  label,
  accept,
  onFile,
}: {
  label: string;
  accept: string;
  onFile: (file: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        hidden
        ref={ref}
        type="file"
        accept={accept}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
      <button type="button" className="btn" onClick={() => ref.current?.click()}>
        {t(label)}
      </button>
    </>
  );
}
export function Blank() {
  return <EmptyPanel>{t("暂无记录")}</EmptyPanel>;
}
