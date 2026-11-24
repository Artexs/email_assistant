import {
  mailOAuthOptionsSchema,
  mailOAuthResultCodes,
  mailOAuthStartResultSchema,
  type MailOAuthProviderKey,
  type MailOAuthResultCode,
} from "@ea/core/web";

import type { TextKey } from "../i18n";
import { api as realApi, ApiError } from "./api";
import { errorText } from "./errors";

// The panel side of the mailbox OAuth sign-in: which buttons the connect dialog shows, what a tap does,
// and the banner after the redirect back to `/mailboxes?oauth=<code>`.

type Api = typeof realApi;

// A button for each provider the server lets this organization connect, in the order of the server. Anything else
// (a provider with `connect: false`, a failed or odd read) gives no button: the password form stays the only way.
export function connectProviders(options: unknown): MailOAuthProviderKey[] {
  const parsed = mailOAuthOptionsSchema.safeParse(options);
  if (!parsed.success) return [];
  return parsed.data.providers.filter((entry) => entry.connect).map((entry) => entry.provider);
}

export async function readConnectProviders(api: Api = realApi): Promise<MailOAuthProviderKey[]> {
  try {
    return connectProviders(await api("/api/mailboxes/oauth/options", mailOAuthOptionsSchema));
  } catch {
    return [];
  }
}

export const providerButtonText = {
  microsoft: "oauth_btn_microsoft",
  google: "oauth_btn_google",
} as const satisfies Record<MailOAuthProviderKey, TextKey>;

// The text of a failed `POST /api/mailboxes/oauth/:provider/start`. A closed flag or a missing config is the same
// "not available here"; every other code has its own text in `errorText` (a 403 `org_suspended`, a 403 `owner_only`).
export function startErrorText(error: unknown): TextKey {
  if (error instanceof ApiError && (error.code === "feature_off" || error.code === "not_configured")) {
    return "oauth_err_unavailable";
  }
  return errorText(error);
}

// The browser follows only an `https:` address: `http:`, `javascript:` and `data:` never pass. The host is the server's choice.
function isBrowsableUrl(raw: string): boolean {
  try {
    const { protocol } = new URL(raw);
    return protocol === "https:";
  } catch {
    return false;
  }
}

export type StartResult = { ok: true } | { ok: false; key: TextKey };

export interface StartDeps {
  api: Api;
  // Sends the browser to the provider. The URL holds the one-time `state`: nothing logs it.
  assign(url: string): void;
}

const browserDeps = (): StartDeps => ({ api: realApi, assign: (url) => location.assign(url) });

// A tap on a sign-in button: `POST /api/mailboxes/oauth/:provider/start` with the body `{}` (a new connect) or `{ mailboxId }`
// (a Reconnect of that mailbox), then the browser goes to the `{ url }` of the answer. On `{ ok: true }` the page is leaving.
// On a failure nothing was assigned.
export async function startOAuth(
  provider: MailOAuthProviderKey,
  deps: StartDeps = browserDeps(),
  mailboxId?: string
): Promise<StartResult> {
  try {
    const { url } = await deps.api(`/api/mailboxes/oauth/${provider}/start`, mailOAuthStartResultSchema, {
      method: "POST",
      // The route parses JSON: an empty body is a 400 `invalid_json`.
      body: mailboxId === undefined ? {} : { mailboxId },
    });
    if (!isBrowsableUrl(url)) return { ok: false, key: "error_generic" };
    deps.assign(url);
    return { ok: true };
  } catch (caught) {
    return { ok: false, key: startErrorText(caught) };
  }
}

export interface OAuthBanner {
  tone: "success" | "error";
  text: TextKey;
}

// `mailbox_exists` and `mailbox_limit` reuse the texts of the password connect. `admin_consent_required` shows `oauth_err_admin`.
const resultTexts = {
  connected: { tone: "success", text: "oauth_ok_connected" },
  reconnected: { tone: "success", text: "oauth_ok_reconnected" },
  oauth_cancelled: { tone: "error", text: "oauth_err_cancelled" },
  oauth_state_invalid: { tone: "error", text: "oauth_err_state" },
  oauth_state_expired: { tone: "error", text: "oauth_err_state" },
  oauth_code_invalid: { tone: "error", text: "oauth_err_failed" },
  oauth_failed: { tone: "error", text: "oauth_err_failed" },
  oauth_scope_missing: { tone: "error", text: "oauth_err_scope" },
  oauth_wrong_account: { tone: "error", text: "oauth_err_wrong_account" },
  mailbox_exists: { tone: "error", text: "err_mailbox_exists" },
  mailbox_limit: { tone: "error", text: "err_mailbox_limit" },
  admin_consent_required: { tone: "error", text: "oauth_err_admin" },
  protocol_disabled: { tone: "error", text: "oauth_err_protocol" },
  feature_off: { tone: "error", text: "oauth_err_unavailable" },
  not_configured: { tone: "error", text: "oauth_err_unavailable" },
} as const satisfies Record<MailOAuthResultCode, OAuthBanner>;

const failedBanner: OAuthBanner = resultTexts.oauth_failed;

const isResultCode = (code: string): code is MailOAuthResultCode =>
  (mailOAuthResultCodes as readonly string[]).includes(code);

// `null` when the address holds no `oauth` value. An unknown value gives the `oauth_failed` text: the page never shows a value from the address bar.
export function oauthBanner(search: string): OAuthBanner | null {
  const code = new URLSearchParams(search).get("oauth");
  if (code === null) return null;
  return isResultCode(code) ? resultTexts[code] : failedBanner;
}

// The query without the keys of the redirect (`oauth`, `mailbox`, `provider`), so a reload shows no banner again. Other keys stay.
export function withoutOAuthQuery(search: string): string {
  const params = new URLSearchParams(search);
  for (const key of ["oauth", "mailbox", "provider"]) params.delete(key);
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}

export interface BannerPage {
  location: { search: string; pathname: string; hash: string };
  history: { replaceState(data: null, unused: string, url: string): void };
}

// Reads the result once and drops the keys of the redirect from the address (the history entry is replaced, not added).
export function takeOAuthBanner(page: BannerPage): OAuthBanner | null {
  const { search, pathname, hash } = page.location;
  const banner = oauthBanner(search);
  if (banner === null) return null;
  page.history.replaceState(null, "", `${pathname}${withoutOAuthQuery(search)}${hash}`);
  return banner;
}

interface PageEvents {
  addEventListener(type: "pageshow", listener: (event: Event) => void): void;
  removeEventListener(type: "pageshow", listener: (event: Event) => void): void;
}

// Back from the provider, a browser may restore this page from its back/forward cache with the old state: a tap that already left
// for the provider still shows as pending. `pageshow` with `persisted` says the page came back from the cache. Returns the cleanup.
export function watchPageRestore(target: PageEvents, onRestore: () => void): () => void {
  const listener = (event: Event) => {
    if ((event as Event & { persisted?: boolean }).persisted === true) onRestore();
  };
  target.addEventListener("pageshow", listener);
  return () => target.removeEventListener("pageshow", listener);
}
