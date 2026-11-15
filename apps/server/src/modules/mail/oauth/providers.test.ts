import { randomBytes } from "node:crypto";

import { describe, expect, test } from "bun:test";

import { loadConfig, mailOAuthConfigured } from "../../../platform/config";

import { createMailOAuthClients } from "./clients";
import { mailOAuthProviders, missingResourceScopes, requiredResourceScopes } from "./providers";

const { microsoft, google } = mailOAuthProviders;
const GUID = "11111111-2222-4333-8444-555555555555";

describe("registry (D6)", () => {
  test("Microsoft values", () => {
    expect(microsoft.authorizeUrl).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    expect(microsoft.tokenUrl).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token");
    expect(microsoft.revokeUrl).toBeNull();
    expect(microsoft.authorizeScopes).toEqual([
      "openid",
      "email",
      "profile",
      "offline_access",
      "https://outlook.office.com/IMAP.AccessAsUser.All",
      "https://graph.microsoft.com/Mail.Send",
    ]);
    expect(microsoft.resourceScopes.mail).toEqual([
      "https://outlook.office.com/IMAP.AccessAsUser.All",
      "offline_access",
    ]);
    expect(microsoft.resourceScopes.graph).toEqual(["https://graph.microsoft.com/Mail.Send", "offline_access"]);
    expect(microsoft.authorizeParams).toEqual({ prompt: "select_account" });
    expect(microsoft.imap).toEqual({ host: "outlook.office365.com", port: 993 });
    expect(microsoft.smtp).toEqual({ host: "smtp.office365.com", port: 587, security: "starttls" });
    expect(microsoft.sendVia).toBe("graph");
    expect(microsoft.graphBaseUrl).toBe("https://graph.microsoft.com");
  });

  test("Google values", () => {
    expect(google.authorizeUrl).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(google.tokenUrl).toBe("https://oauth2.googleapis.com/token");
    expect(google.revokeUrl).toBe("https://oauth2.googleapis.com/revoke");
    expect(google.authorizeScopes).toEqual(["openid", "email", "https://mail.google.com/"]);
    expect(google.resourceScopes).toEqual({ mail: ["openid", "email", "https://mail.google.com/"], graph: null });
    expect(google.authorizeParams).toEqual({ access_type: "offline", prompt: "consent" });
    expect(google.imap).toEqual({ host: "imap.gmail.com", port: 993 });
    expect(google.smtp).toEqual({ host: "smtp.gmail.com", port: 465, security: "tls" });
    expect(google.sendVia).toBe("smtp");
    expect(google.graphBaseUrl).toBeNull();
  });

  test("issuerOk", () => {
    expect(microsoft.issuerOk(`https://login.microsoftonline.com/${GUID}/v2.0`)).toBe(true);
    expect(microsoft.issuerOk("https://login.microsoftonline.com/common/v2.0")).toBe(false);
    expect(microsoft.issuerOk(`https://evil.x.test/${GUID}/v2.0`)).toBe(false);
    expect(microsoft.issuerOk(`https://login.microsoftonline.com/${GUID}/v2.0/extra`)).toBe(false);
    expect(google.issuerOk("https://accounts.google.com")).toBe(true);
    expect(google.issuerOk("accounts.google.com")).toBe(true);
    expect(google.issuerOk("https://accounts.google.com.evil.x.test")).toBe(false);
  });
});

// Review N1: a grant check compares resource scopes only. Google may answer `email` as the userinfo.email URL, Microsoft may omit offline_access.
describe("granted scopes (N1)", () => {
  test("the required scopes are the resource scopes without the identity names", () => {
    expect(requiredResourceScopes(google, "mail")).toEqual(["https://mail.google.com/"]);
    expect(requiredResourceScopes(microsoft, "mail")).toEqual(["https://outlook.office.com/IMAP.AccessAsUser.All"]);
    expect(requiredResourceScopes(microsoft, "graph")).toEqual(["https://graph.microsoft.com/Mail.Send"]);
    expect(requiredResourceScopes(google, "graph")).toEqual([]);
  });

  test("Google answers email as the userinfo URL: nothing is missing", () => {
    const granted = ["openid", "https://www.googleapis.com/auth/userinfo.email", "https://mail.google.com/"];
    expect(missingResourceScopes(google, "mail", granted)).toEqual([]);
  });

  test("Microsoft leaves offline_access out and changes the case: nothing is missing", () => {
    expect(missingResourceScopes(microsoft, "mail", ["https://outlook.office.com/imap.accessasuser.all"])).toEqual([]);
  });

  test("a missing resource scope is named; an identity scope does not stand in for it", () => {
    expect(missingResourceScopes(google, "mail", ["openid", "email"])).toEqual(["https://mail.google.com/"]);
    expect(
      missingResourceScopes(microsoft, "mail", ["offline_access", "https://graph.microsoft.com/Mail.Send"])
    ).toEqual(["https://outlook.office.com/IMAP.AccessAsUser.All"]);
    expect(missingResourceScopes(google, "mail", [])).toEqual(["https://mail.google.com/"]);
  });
});

describe("config (D7)", () => {
  const base = {
    DATABASE_URL: "postgres://app:pw@127.0.0.1:5433/email_assistant",
    CREDENTIALS_KEY: randomBytes(32).toString("base64"),
    WEB_BASE_URL: "https://ea.x.test",
    WEB_AUTH_SECRET: randomBytes(32).toString("hex"),
  };

  test("configured = both keys and WEB_BASE_URL; a provider without keys has no client", () => {
    const config = loadConfig({ ...base, MAIL_OAUTH_GOOGLE_CLIENT_ID: "gid", MAIL_OAUTH_GOOGLE_CLIENT_SECRET: "gsec" });
    expect(mailOAuthConfigured(config, "google")).toBe(true);
    expect(mailOAuthConfigured(config, "microsoft")).toBe(false);
    const clients = createMailOAuthClients(config);
    expect(Object.keys(clients)).toEqual(["google"]);
    const url = new URL(clients.google?.authorizeUrl({ state: "s", codeChallenge: "c" }) ?? "");
    expect(url.searchParams.get("redirect_uri")).toBe("https://ea.x.test/api/mailboxes/oauth/google/callback");
    expect(url.searchParams.get("client_id")).toBe("gid");
  });

  test("no key set: nothing is configured", () => {
    const config = loadConfig(base);
    expect(mailOAuthConfigured(config, "google")).toBe(false);
    expect(mailOAuthConfigured(config, "microsoft")).toBe(false);
    expect(createMailOAuthClients(config)).toEqual({});
  });

  test("no env key holds a URL or a host (D6)", () => {
    const config = loadConfig({
      ...base,
      MAIL_OAUTH_GOOGLE_CLIENT_ID: "gid",
      MAIL_OAUTH_GOOGLE_CLIENT_SECRET: "gsec",
      MAIL_OAUTH_MICROSOFT_CLIENT_ID: "mid",
      MAIL_OAUTH_MICROSOFT_CLIENT_SECRET: "msec",
    });
    const keys = Object.keys(config).filter((key) => key.startsWith("MAIL_OAUTH_"));
    expect(keys.sort()).toEqual([
      "MAIL_OAUTH_GOOGLE_CLIENT_ID",
      "MAIL_OAUTH_GOOGLE_CLIENT_SECRET",
      "MAIL_OAUTH_MICROSOFT_CLIENT_ID",
      "MAIL_OAUTH_MICROSOFT_CLIENT_SECRET",
    ]);
  });
});
