import zh from "./zh";
import en from "./en";
import tradeEn from "./trade-en";
export type Language = "zh" | "en";
let language: Language = "zh";
const listeners = new Set<() => void>();
export const subscribeLanguage = (listener: () => void) => {
  listeners.add(listener);
  queueMicrotask(() => {
    const saved =
      (localStorage.getItem("trade.lang") ?? localStorage.getItem("mariner.lang")) === "en" ? "en" : "zh";
    if (saved !== language) changeLanguage(saved);
  });
  return () => {
    listeners.delete(listener);
  };
};
export const currentLanguage = () => language;
export const changeLanguage = (value: Language) => {
  language = value;
  listeners.forEach((listener) => listener());
};
export function t(key: string, params: Record<string, unknown> = {}): string {
  const table: Record<string, string> = language === "en" ? { ...en, ...tradeEn } : zh;
  return (table[key] ?? key).replace(/\{(\w+)\}/g, (match, name) =>
    name in params ? String(params[name]) : match,
  );
}
