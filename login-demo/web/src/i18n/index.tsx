"use client";
import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { changeLanguage, currentLanguage, subscribeLanguage, t, type Language } from "./runtime";

const Context = createContext<{ lang: Language; setLang: (value: Language) => void; t: typeof t }>({
  lang: "zh",
  setLang: () => {},
  t,
});
export function I18nProvider({ children }: { children: ReactNode }) {
  const lang = useSyncExternalStore(subscribeLanguage, currentLanguage, () => "zh" as Language);
  useEffect(() => {
    document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
  }, [lang]);
  const setLang = (value: Language) => {
    changeLanguage(value);
    localStorage.setItem("trade.lang", value);
    document.documentElement.lang = value === "en" ? "en" : "zh-CN";
  };
  return <Context.Provider value={{ lang, setLang, t }}>{children}</Context.Provider>;
}
export const useI18n = () => useContext(Context);
