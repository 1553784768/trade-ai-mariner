"use client";
import { Suspense } from "react";
import { Research } from "@/components/trade-tools";
export default function Page() {
  return (
    <Suspense>
      <Research />
    </Suspense>
  );
}
