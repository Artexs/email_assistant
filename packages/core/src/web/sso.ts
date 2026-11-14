// Why the sign-in with a company identity provider (SSO) refuses a person (F119, `SsoResolution` in `platform/auth-sso.ts`).
// The code goes to the redirect URL (`/login?sso=failed&error=<code>`) and to the audit row `sso.refused`; it holds no person data.
export const ssoRefusals = [
  "no_provider",
  "sso_off",
  "domain_mismatch",
  "email_unverified",
  "not_a_member",
  "identity_mismatch",
] as const;

export type SsoRefusal = (typeof ssoRefusals)[number];
