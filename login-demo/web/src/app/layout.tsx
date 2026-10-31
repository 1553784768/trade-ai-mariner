import { BRAND } from "@/lib/brand";
import type { Metadata } from "next";
import "./globals.css";
import "./trade.css";
import { AuthGate } from "@/components/auth";
import { Suspense } from "react";
import { ToastProvider } from "@/components/trade-ui";
import { Providers } from "@/components/providers";

export const metadata: Metadata = { title: BRAND.name, icons: { icon: BRAND.logo } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <Providers>
          <ToastProvider>
            <Suspense>
              <AuthGate>{children}</AuthGate>
            </Suspense>
          </ToastProvider>
        </Providers>
      </body>
    </html>
  );
}
