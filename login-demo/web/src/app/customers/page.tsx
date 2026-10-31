"use client";
import { Suspense } from "react";
import { Customers } from "@/components/trade-customers";
export default function Page() {
  return (
    <Suspense>
      <Customers />
    </Suspense>
  );
}
