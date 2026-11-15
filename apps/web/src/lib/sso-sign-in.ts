import { forgotFormSchema, signInOptionsSchema, type SignInOptions } from "@ea/core/web";

import type { TextKey } from "../i18n";
import { ssoStartErrorText } from "./sso-errors";

// Where the callback sends a person that the sign-in refused (the server adds `&error=<code>`).
export const SSO_ERROR_CALLBACK = "/login?sso=failed";

// The page shows the company sign-in only for `{ sso: true }`. A failed or odd read is `{ sso: false }`: the password form stays the only way.
export async function readSignInOptions(fetchFn: typeof fetch = fetch): Promise<SignInOptions> {
  try {
    const res = await fetchFn("/api/sign-in-options", {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (!res.ok) return { sso: false };
    const parsed = signInOptionsSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : { sso: false };
  } catch {
    return { sso: false };
  }
}

export interface LoginSections {
  sso: boolean;
}

// Which optional blocks the login page renders for the options it read (`null` = not read yet or failed).
export function loginSections(options: SignInOptions | null): LoginSections {
  return { sso: options?.sso === true };
}

// The browser follows only an `https:` address (the IdP) or an address of this origin (`/api/auth/...`). A user name or a
// password in the address, `javascript:` and `http:` of another host never pass.
export function isSafeSsoUrl(raw: unknown, origin: string): boolean {
  if (typeof raw !== "string" || raw === "") return false;
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return false;
  }
  if (url.username !== "" || url.password !== "") return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && url.origin === new URL(origin).origin;
}

export type SsoStartResult = { ok: true; url: string } | { ok: false; key: TextKey };

// Starts the company sign-in: the server answers `{ url }` of the IdP. `next` is a path that `safeNextPath` already checked.
export async function startSsoSignIn(
  email: string,
  next: string,
  origin: string,
  fetchFn: typeof fetch = fetch
): Promise<SsoStartResult> {
  try {
    const res = await fetchFn("/api/auth/sign-in/sso", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ email, callbackURL: next, errorCallbackURL: SSO_ERROR_CALLBACK }),
    });
    if (!res.ok) return { ok: false, key: ssoStartErrorText(res.status) };
    const body = (await res.json()) as { url?: unknown };
    if (isSafeSsoUrl(body.url, origin)) return { ok: true, url: String(body.url) };
  } catch {
    // A network or JSON failure ends in the generic text below.
  }
  return { ok: false, key: "login_sso_error_generic" };
}

export type SsoEmailCheck = { ok: true; email: string } | { ok: false; key: TextKey };

export function checkSsoEmail(raw: string): SsoEmailCheck {
  const parsed = forgotFormSchema.safeParse({ email: raw });
  return parsed.success ? { ok: true, email: parsed.data.email } : { ok: false, key: "email_invalid" };
}
