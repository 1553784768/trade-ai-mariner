"use client";
import { Suspense } from "react";
import { Documents } from "@/components/trade-documents";
export default function Page() {
  return (
    <Suspense>
      <Documents />
    </Suspense>
  );
}
