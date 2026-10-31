"use client";
import { TradeChatProvider } from "./trade-chat";
import { I18nProvider, useI18n } from "@/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
function LocalizedProviders({ children }: { children: React.ReactNode }) {
  const { lang } = useI18n();
  return <QueryProvider key={lang}>{children}</QueryProvider>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider>
      <TradeChatProvider>
        <LocalizedProviders>{children}</LocalizedProviders>
      </TradeChatProvider>
    </I18nProvider>
  );
}
