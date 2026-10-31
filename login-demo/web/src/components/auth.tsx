"use client";
import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiFailure, tradeApi } from "@/lib/api";
import { LoadingPanel, ErrorBanner } from "./ui";
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => tradeApi<{ id: number; email: string }>("/me"),
    retry: false,
  });
}
export function AuthGate({ children }: { children: ReactNode }) {
  const pathname = usePathname(),
    params = useSearchParams(),
    router = useRouter(),
    cache = useQueryClient();
  const login = pathname === "/login";
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => tradeApi<{ id: number; email: string }>("/me"),
    enabled: !login,
    retry: false,
  });
  useEffect(() => {
    const expired = () => {
      if (!login) {
        cache.clear();
        router.replace(`/login?next=${encodeURIComponent(pathname + (params.size ? `?${params}` : ""))}`);
      }
    };
    if (me.error instanceof ApiFailure && me.error.status === 401) expired();
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, [login, pathname, params, router, cache, me.error]);
  if (login) return children;
  if (me.error && !(me.error instanceof ApiFailure && me.error.status === 401))
    return <ErrorBanner error={me.error} retry={() => me.refetch()} />;
  return me.data ? children : <LoadingPanel />;
}
