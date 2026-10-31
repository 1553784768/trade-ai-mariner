export const normalizePath = (path: string) => path.replace(/\/+$/, "") || "/";
export const tariffHref = (path: string) => `/tariff${path === "/" ? "" : path}`;
export function safeNext(path: string | null) {
  return path?.startsWith("/") && !path.startsWith("//") && !path.includes("\\") ? path : "/";
}
