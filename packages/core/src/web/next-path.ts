// The `next` target after a login: a same-origin path, else "/". The server's page gate and the login page use this one guard.
export function safeNextPath(raw: string | null | undefined): string {
  if (raw === null || raw === undefined || raw === "") return "/";
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
