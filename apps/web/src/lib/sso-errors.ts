import type { TextKey } from "../i18n";

// The refusal codes of the company sign-in that have their own text (`SsoRefusal` in `@ea/core/web`). Every other value,
// also `email_unverified` and `no_provider`, gets the generic text: the page never shows a value from the address bar.
const CODE_TEXT: Readonly<Record<string, TextKey>> = {
  not_a_member: "login_sso_error_not_member",
  domain_mismatch: "login_sso_error_domain",
  identity_mismatch: "login_sso_error_identity",
  sso_off: "login_sso_error_off",
};

// `Object.hasOwn`: a code such as `constructor` or `__proto__` is not a key of the table.
export function ssoErrorText(code: string | null | undefined): TextKey {
  if (typeof code !== "string" || !Object.hasOwn(CODE_TEXT, code)) return "login_sso_error_generic";
  return CODE_TEXT[code] ?? "login_sso_error_generic";
}

// The text for a return from the callback: `/login?sso=failed&error=<code>`. `null` when the address holds neither key.
// `error_description` is never read.
export function ssoReturnError(search: string): TextKey | null {
  const params = new URLSearchParams(search);
  const error = params.get("error");
  if (error === null && params.get("sso") !== "failed") return null;
  return ssoErrorText(error);
}

// Maps the status of a failed `POST /api/auth/sign-in/sso` to a text. A missing provider answers 404, an unproved
// domain 401, a bad address 400: for the person all of them are "not set up for this address".
export function ssoStartErrorText(status: number): TextKey {
  if (status === 429) return "login_sso_error_rate";
  if (status === 400 || status === 401 || status === 403 || status === 404) return "login_sso_error_no_provider";
  return "login_sso_error_generic";
}
