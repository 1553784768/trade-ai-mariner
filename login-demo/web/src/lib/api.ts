import { t, currentLanguage } from "@/i18n/runtime";
import type { components } from "./api-types";
export type Schema<K extends keyof components["schemas"]> = components["schemas"][K];
export type { components };
export class ApiFailure extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export async function request<T>(url: string, init?: RequestInit & { raw?: boolean }): Promise<T> {
  const { raw, ...options } = init || {};
  const response = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) window.dispatchEvent(new Event("session-expired"));
    const message =
      body.error?.message || (typeof body.detail === "string" ? body.detail : body.detail?.message);
    throw new ApiFailure(
      response.status,
      message || t("输入内容有误，请检查必填项和字段格式。"),
      body.error?.details ?? body.detail?.errors,
    );
  }
  return raw ? (response as T) : response.status === 204 ? (undefined as T) : response.json();
}
export function api<T>(path: string, init?: RequestInit & { raw?: boolean }) {
  const url = new URL(`/api/tariff${path}`, window.location.origin);
  url.searchParams.set("lang", currentLanguage());
  return request<T>(url.toString(), init);
}
export function tradeApi<T>(path: string, init?: RequestInit & { raw?: boolean }) {
  const separator = path.includes("?") ? "&" : "?";
  return request<T>(`/api${path}${separator}lang=${currentLanguage()}`, init);
}
export const jsonBody = (method: string, value?: unknown): RequestInit => ({
  method,
  ...(value === undefined ? {} : { body: JSON.stringify(value) }),
});
