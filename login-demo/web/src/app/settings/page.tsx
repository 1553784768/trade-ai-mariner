"use client";
import { Suspense } from "react";
import { SettingsPage } from "@/components/trade-settings";
export default function Page() {
  return (
    <Suspense>
      <SettingsPage />
    </Suspense>
  );
}
