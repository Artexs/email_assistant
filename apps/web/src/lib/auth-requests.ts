import { TERMS_VERSION } from "@ea/core/web";

export type SetPasswordResult = { ok: true } | { ok: false; status: number; code: string | null };

// The Better Auth client types have no `termsVersion`, so the setup page posts the request itself (F082 L29).
export async function setPasswordWithTerms(input: { token: string; newPassword: string }): Promise<SetPasswordResult> {
  const res = await fetch("/api/auth/reset-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ newPassword: input.newPassword, token: input.token, termsVersion: TERMS_VERSION }),
  });
  if (res.ok) return { ok: true };
  let code: string | null = null;
  try {
    const body = (await res.json()) as { code?: unknown };
    if (typeof body.code === "string") code = body.code;
  } catch {
    // The answer has no JSON body: only the status is known.
  }
  return { ok: false, status: res.status, code };
}
