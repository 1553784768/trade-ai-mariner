"use client";
import { Suspense } from "react";
import { TradeChat } from "@/components/trade-chat";
export default function Page() {
  return (
    <Suspense>
      <TradeChat daily />
    </Suspense>
  );
}
