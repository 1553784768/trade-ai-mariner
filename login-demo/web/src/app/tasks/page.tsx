"use client";
import { Suspense } from "react";
import { Tasks } from "@/components/trade-tools";
export default function Page() {
  return (
    <Suspense>
      <Tasks />
    </Suspense>
  );
}
