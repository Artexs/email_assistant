import { z } from "./zod";

// Why the sign-in with a company identity provider (SSO) refuses a person (`SsoResolution` in `platform/auth-sso.ts`).
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

// What the IdP says about the person. `null` = the IdP sent no such claim.
export interface SsoIdentity {
  providerId: string;
  issuer: string;
  subject: string;
  email: string;
  emailVerified: boolean | null;
  hostedDomain: string | null;
}

// `orgId` is the organization of the provider; `null` only when no provider matches. A resolver never answers
// the plugin's `continue`: with `requestSignUp: true` that makes a user (`spike.md` finding on the resolver).
export type SsoResolution =
  | { kind: "link"; userId: string; orgId: string; firstLink: boolean }
  | { kind: "reject"; code: SsoRefusal; orgId: string | null };

// GET /api/sign-in-options: public, before the session guard. One bit for every caller: it holds no
// organization id, domain or count, and it never depends on an address.
export const signInOptionsSchema = z.strictObject({ sso: z.boolean() });
export type SignInOptions = z.infer<typeof signInOptionsSchema>;
