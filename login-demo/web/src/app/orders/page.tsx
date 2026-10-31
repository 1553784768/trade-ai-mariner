"use client";
import { Suspense } from "react";
import { Orders } from "@/components/trade-orders";
export default function Page() {
  return (
    <Suspense>
      <Orders />
    </Suspense>
  );
}
