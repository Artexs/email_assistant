// The browser twin of `safeNext` in apps/server/src/platform/http.ts: keep both in step.
export function safeNextPath(raw: string | null): string {
  if (raw === null || raw === "") return "/";
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return "/";
  }
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/";
  const url = new URL(raw, "http://x.invalid");
  if (url.origin !== "http://x.invalid") return "/";
  if (url.pathname.startsWith("//")) return "/";
  if (url.pathname.startsWith("/login") || url.pathname.startsWith("/setup")) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}
