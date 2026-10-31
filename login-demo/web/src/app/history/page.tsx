"use client";
import { Suspense } from "react";
import { History } from "@/components/trade-tools";
export default function Page() {
  return (
    <Suspense>
      <History />
    </Suspense>
  );
}
