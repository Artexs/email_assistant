/// <reference types="bun" />
import { ApiError } from "./api";
import { mailOAuthResultCodes } from "@ea/core/web";
import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ConnectForm } from "../components/mailboxes/ConnectDialog";
import { OAuthResultBanner } from "../components/mailboxes/OAuthBanner";
import { OAuthSignIn } from "../components/mailboxes/OAuthSignIn";
import { setLocaleForTest, t, type TextKey } from "../i18n";
import { en } from "../i18n/en";
import { pl } from "../i18n/pl";

import {
  connectProviders,
  oauthBanner,
  type OAuthBanner,
  readConnectProviders,
  startOAuth,
  startErrorText,
  takeOAuthBanner,
  watchPageRestore,
  withoutOAuthQuery,
} from "./mail-oauth";

afterEach(() => setLocaleForTest("en"));

const options = (microsoft: boolean, google: boolean) => ({
  providers: [
    { provider: "microsoft", connect: microsoft, reconnect: true },
    { provider: "google", connect: google, reconnect: true },
  ],
});

const shown = (search: string) => {
  const banner = oauthBanner(search);
  if (banner === null) throw new Error(`no banner for ${search}`);
  return banner;
};

// The server escapes the apostrophe of "Google's".
const escaped = (text: string) => text.replaceAll("'", "&#x27;");

const buttons = (html: string) => [...html.matchAll(/<button[^>]*>.*?<\/button>/g)].map((match) => match[0]);

describe("sign-in buttons (rule 1)", () => {
  test("only a provider with connect: true gets a button", () => {
    expect(connectProviders(options(true, false))).toEqual(["microsoft"]);
    expect(connectProviders(options(false, true))).toEqual(["google"]);
    expect(connectProviders(options(true, true))).toEqual(["microsoft", "google"]);
    // `reconnect: true` alone is not a new connect.
    expect(connectProviders(options(false, false))).toEqual([]);
    expect(connectProviders({ providers: "x" })).toEqual([]);
    expect(connectProviders(null)).toEqual([]);
  });

  test("a failed read gives no button; a good read gives the list", async () => {
    const fail = (async () => {
      throw new ApiError(500, "internal");
    }) as never;
    expect(await readConnectProviders(fail)).toEqual([]);
    const seen: string[] = [];
    const ok = (async (path: string) => {
      seen.push(path);
      return options(true, false);
    }) as never;
    expect(await readConnectProviders(ok)).toEqual(["microsoft"]);
    expect(seen).toEqual(["/api/mailboxes/oauth/options"]);
  });

  test("Microsoft on, Google off: one Microsoft button, no Google button, no Google hint", () => {
    const html = renderToStaticMarkup(
      <OAuthSignIn
        providers={connectProviders(options(true, false))}
        disabled={false}
        error={null}
        onStart={() => undefined}
      />
    );
    expect(buttons(html)).toHaveLength(1);
    expect(html).toContain("Sign in with Microsoft");
    expect(html).not.toContain("Sign in with Google");
    expect(html).not.toContain(escaped(en.oauth_google_hint));
    expect(html).toContain("Or connect with a password");
  });

  test("Google button: the hint is its description; every button is a plain button", () => {
    const html = renderToStaticMarkup(
      <OAuthSignIn providers={["microsoft", "google"]} disabled={false} error={null} onStart={() => undefined} />
    );
    const found = buttons(html);
    expect(found).toHaveLength(2);
    for (const button of found) expect(button).toContain('type="button"');
    const google = found.find((button) => button.includes("Sign in with Google")) ?? "";
    expect(google).toContain('aria-describedby="connect-oauth-google-hint"');
    expect(html).toContain('<p id="connect-oauth-google-hint"');
    expect(html).toContain(escaped(en.oauth_google_hint));
    expect(found.find((button) => button.includes("Microsoft"))).not.toContain("aria-describedby");
  });

  test("no provider: nothing renders, so no 'Or connect with a password' line", () => {
    const html = renderToStaticMarkup(
      <OAuthSignIn providers={[]} disabled={false} error={null} onStart={() => undefined} />
    );
    expect(html).toBe("");
  });

  test("a pending start disables the buttons; an error shows as an alert", () => {
    const html = renderToStaticMarkup(
      <OAuthSignIn providers={["google"]} disabled error="oauth_err_unavailable" onStart={() => undefined} />
    );
    expect(buttons(html)[0]).toContain('disabled=""');
    expect(html).toContain('role="alert"');
    expect(html).toContain(en.oauth_err_unavailable);
  });

  test("the dialog form shows the buttons above the password presets, which stay", () => {
    const render = (initialOauthProviders: ("microsoft" | "google")[]) =>
      renderToStaticMarkup(
        <ConnectForm
          pending={false}
          setPending={() => undefined}
          onConnected={() => undefined}
          onClose={() => undefined}
          sentSyncLine={false}
          initialOauthProviders={initialOauthProviders}
        />
      );
    const withMicrosoft = render(["microsoft"]);
    expect(withMicrosoft).toContain("Sign in with Microsoft");
    expect(withMicrosoft).not.toContain("Sign in with Google");
    expect(withMicrosoft.indexOf("Sign in with Microsoft")).toBeLessThan(
      withMicrosoft.indexOf('id="connect-provider"')
    );
    expect(withMicrosoft.indexOf("Or connect with a password")).toBeLessThan(
      withMicrosoft.indexOf('id="connect-provider"')
    );
    for (const html of [withMicrosoft, render([])]) {
      expect(html).toContain('id="connect-provider"');
      expect(html).toContain(t("provider_label"));
      expect(html).toContain(t("preset_interia"));
      expect(html).toContain('id="connect-password"');
    }
    expect(render([])).not.toContain("Sign in with");
    expect(render([])).not.toContain("Or connect with a password");
  });
});

describe("a tap on a button (rule 2)", () => {
  test("POSTs start with the body {} and assigns the returned URL", async () => {
    const calls: { path: string; method?: string; body?: unknown }[] = [];
    const assigned: string[] = [];
    const api = (async (path: string, _schema: unknown, init: { method?: string; body?: unknown } = {}) => {
      calls.push({ path, method: init.method, body: init.body });
      return { url: "https://login.example.test/authorize?state=x" };
    }) as never;
    const result = await startOAuth("microsoft", { api, assign: (url) => assigned.push(url) });
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([{ path: "/api/mailboxes/oauth/microsoft/start", method: "POST", body: {} }]);
    expect(assigned).toEqual(["https://login.example.test/authorize?state=x"]);
    await startOAuth("google", { api, assign: () => undefined });
    expect(calls[1]?.path).toBe("/api/mailboxes/oauth/google/start");
  });

  test("a Reconnect sends the mailbox id; a new connect sends none", async () => {
    const bodies: unknown[] = [];
    const api = (async (_path: string, _schema: unknown, init: { body?: unknown } = {}) => {
      bodies.push(init.body);
      return { url: "https://login.example.test/authorize?state=x" };
    }) as never;
    const mailboxId = "6f1d0b3c-8a2e-4f7a-9d55-3b1c2a4e5f60";
    await startOAuth("google", { api, assign: () => undefined }, mailboxId);
    await startOAuth("google", { api, assign: () => undefined });
    expect(bodies).toEqual([{ mailboxId }, {}]);
  });

  test("a start error shows the text of its code and assigns nothing", async () => {
    const assigned: string[] = [];
    const failWith = (status: number, code: string) =>
      startOAuth("google", {
        api: (async () => {
          throw new ApiError(status, code);
        }) as never,
        assign: (url) => assigned.push(url),
      });
    expect(await failWith(404, "feature_off")).toEqual({ ok: false, key: "oauth_err_unavailable" });
    expect(await failWith(404, "not_configured")).toEqual({ ok: false, key: "oauth_err_unavailable" });
    expect(await failWith(403, "org_suspended")).toEqual({ ok: false, key: "err_org_suspended" });
    expect(await failWith(403, "owner_only")).toEqual({ ok: false, key: "owner_only" });
    expect(await failWith(500, "internal")).toEqual({ ok: false, key: "error_generic" });
    expect(startErrorText(new Error("network"))).toBe("error_generic");
    expect(assigned).toEqual([]);
  });

  test("an address that is not https is never followed", async () => {
    const assigned: string[] = [];
    for (const url of [
      "http://login.example.test/authorize",
      "javascript:alert(1)",
      "data:text/html,x",
      "not a url",
      "",
    ]) {
      const result = await startOAuth("microsoft", {
        api: (async () => ({ url })) as never,
        assign: (value) => assigned.push(value),
      });
      expect([url, result.ok]).toEqual([url, false]);
    }
    expect(assigned).toEqual([]);
  });
});

describe("the result banner (rule 3)", () => {
  const expected: Record<string, [TextKey, "success" | "error"]> = {
    connected: ["oauth_ok_connected", "success"],
    reconnected: ["oauth_ok_reconnected", "success"],
    oauth_cancelled: ["oauth_err_cancelled", "error"],
    oauth_state_invalid: ["oauth_err_state", "error"],
    oauth_state_expired: ["oauth_err_state", "error"],
    oauth_code_invalid: ["oauth_err_failed", "error"],
    oauth_failed: ["oauth_err_failed", "error"],
    oauth_scope_missing: ["oauth_err_scope", "error"],
    oauth_wrong_account: ["oauth_err_wrong_account", "error"],
    mailbox_exists: ["err_mailbox_exists", "error"],
    mailbox_limit: ["err_mailbox_limit", "error"],
    admin_consent_required: ["oauth_err_admin", "error"],
    protocol_disabled: ["oauth_err_protocol", "error"],
    feature_off: ["oauth_err_unavailable", "error"],
    not_configured: ["oauth_err_unavailable", "error"],
  };

  test("every code of the redirect has the text of stage 16", () => {
    expect(Object.keys(expected).sort()).toEqual([...mailOAuthResultCodes].sort());
    for (const [code, [text, tone]] of Object.entries(expected)) {
      expect([code, oauthBanner(`?oauth=${code}`)]).toEqual([code, { tone, text }]);
    }
  });

  test("an unknown or odd code gives the oauth_failed text; no oauth key gives no banner", () => {
    const failed: OAuthBanner = { tone: "error", text: "oauth_err_failed" };
    for (const search of ["?oauth=nope", "?oauth=", "?oauth=__proto__", "?oauth=constructor", "?oauth=CONNECTED"]) {
      expect([search, oauthBanner(search)]).toEqual([search, failed]);
    }
    expect(oauthBanner("")).toBeNull();
    expect(oauthBanner("?connect=1")).toBeNull();
  });

  test("a success is a status, a failure is an alert; the value of the address never shows", () => {
    const hostile = encodeURIComponent("<img src=x onerror=alert(1)>");
    const html = renderToStaticMarkup(
      <OAuthResultBanner banner={shown(`?oauth=${hostile}`)} onClose={() => undefined} />
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain(en.oauth_err_failed);
    expect(html).not.toContain("onerror");
    const ok = renderToStaticMarkup(<OAuthResultBanner banner={shown("?oauth=connected")} onClose={() => undefined} />);
    expect(ok).toContain('role="status"');
    expect(ok).not.toContain('role="alert"');
    expect(ok).toContain(en.oauth_ok_connected);
    expect(buttons(ok)[0]).toContain('type="button"');
  });

  test("the banner shows the Polish text with the language switched", () => {
    setLocaleForTest("pl");
    const html = renderToStaticMarkup(
      <OAuthResultBanner banner={shown("?oauth=oauth_wrong_account")} onClose={() => undefined} />
    );
    expect(html).toContain("Zalogowano się na inne konto. Zaloguj się adresem tej skrzynki.");
  });
});

describe("the query is removed after the banner shows (rule 4)", () => {
  const page = (search: string) => {
    const urls: string[] = [];
    return {
      urls,
      page: {
        location: { search, pathname: "/mailboxes", hash: "#top" },
        history: { replaceState: (_data: null, _unused: string, url: string) => urls.push(url) },
      },
    };
  };

  test("oauth, mailbox and provider go; other keys and the hash stay", () => {
    const one = page("?oauth=connected&mailbox=0190f5a0-0000-7000-8000-000000000003");
    expect(takeOAuthBanner(one.page)).toEqual({ tone: "success", text: "oauth_ok_connected" });
    expect(one.urls).toEqual(["/mailboxes#top"]);
    const two = page("?oauth=admin_consent_required&provider=microsoft&x=1");
    expect(takeOAuthBanner(two.page)?.text).toBe("oauth_err_admin");
    expect(two.urls).toEqual(["/mailboxes?x=1#top"]);
    expect(withoutOAuthQuery("?connect=1&oauth=oauth_failed")).toBe("?connect=1");
  });

  test("no oauth key: no banner and the address stays", () => {
    const none = page("?x=1");
    expect(takeOAuthBanner(none.page)).toBeNull();
    expect(none.urls).toEqual([]);
  });
});

describe("a page restored from the bfcache (N6)", () => {
  const fakeWindow = () => {
    const listeners = new Set<(event: Event) => void>();
    return {
      listeners,
      target: {
        addEventListener: (_type: "pageshow", listener: (event: Event) => void) => listeners.add(listener),
        removeEventListener: (_type: "pageshow", listener: (event: Event) => void) => listeners.delete(listener),
      },
      fire: (persisted: boolean) => {
        for (const listener of listeners) listener(Object.assign(new Event("pageshow"), { persisted }));
      },
    };
  };

  test("only a persisted pageshow calls back; the cleanup removes the listener", () => {
    const page = fakeWindow();
    let calls = 0;
    const stop = watchPageRestore(page.target, () => (calls += 1));
    page.fire(false);
    expect(calls).toBe(0);
    page.fire(true);
    expect(calls).toBe(1);
    stop();
    expect(page.listeners.size).toBe(0);
    page.fire(true);
    expect(calls).toBe(1);
  });
});

describe("texts (rule 5)", () => {
  const keys = Object.keys(en).filter((key) => key.startsWith("oauth_")) as TextKey[];

  test("14 keys, in en and pl, never the same text in both", () => {
    expect(keys).toHaveLength(14);
    for (const key of keys) {
      expect(pl[key]).toBeString();
      expect(pl[key]).not.toBe(en[key]);
    }
  });

  test("the Polish and English texts of stage 16, word for word", () => {
    expect(pl.oauth_btn_microsoft).toBe("Zaloguj się przez Microsoft");
    expect(pl.oauth_btn_google).toBe("Zaloguj się przez Google");
    expect(pl.oauth_or_password).toBe("Albo połącz hasłem");
    expect(pl.oauth_google_hint).toBe(
      "Dopóki aplikacja jest w trybie testowym Google, Google co 7 dni prosi o ponowne zalogowanie. Hasło aplikacji nie wygasa."
    );
    expect(pl.oauth_err_wrong_account).toBe("Zalogowano się na inne konto. Zaloguj się adresem tej skrzynki.");
    expect(pl.oauth_err_unavailable).toBe("Logowanie przez tego dostawcę nie jest tu dostępne.");
    expect(en.oauth_err_scope).toBe(
      "The mailbox needs every permission on the sign-in page. Start again and allow all of them."
    );
    expect(en.oauth_ok_reconnected).toBe("Mailbox reconnected. Sync starts again within a few minutes.");
  });

  test("no new text promises a Reconnect button (it comes in stage 18)", () => {
    for (const key of keys) {
      expect(en[key]).not.toMatch(/reconnect(?!ed)/i);
      expect(pl[key]).not.toMatch(/połącz ponownie/i);
    }
  });
});
