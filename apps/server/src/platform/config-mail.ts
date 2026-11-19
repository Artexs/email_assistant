import { DEFAULT_SEND_LIMITS, type SendLimits } from "@ea/core";
import { z } from "zod";

import { addressPattern, emptyAsUndefined, parseAddressList } from "./config-shared";

// The providers of mailbox OAuth. The mail module has the same union (`MailOAuthProvider`): `platform` does not import `modules`.
export const mailOAuthProviderIds = ["microsoft", "google"] as const;
export type MailOAuthProviderId = (typeof mailOAuthProviderIds)[number];

const mailOAuthKeys = {
  microsoft: ["MAIL_OAUTH_MICROSOFT_CLIENT_ID", "MAIL_OAUTH_MICROSOFT_CLIENT_SECRET"],
  google: ["MAIL_OAUTH_GOOGLE_CLIENT_ID", "MAIL_OAUTH_GOOGLE_CLIENT_SECRET"],
} as const;

// The env keys of the mail module, the sends and the mailbox OAuth apps. `config.ts` spreads them into the schema.
export const mailShape = {
  // Not `z.email()`: the GreenMail test address is `user@localhost`, with no dot in the domain.
  // One address, or a comma-separated list (the provider smoke has two test mailboxes).
  TEST_MAILBOX_ADDRESS: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z
      .string()
      .regex(/^[^\s@,]+@[^\s@,]+(\s*,\s*[^\s@,]+@[^\s@,]+)*$/)
      .optional()
  ),
  // off = no send; self = only to SEND_TEST_ADDRESSES; all = real recipients, always after an owner's tap.
  SEND_SCOPE: z.enum(["off", "self", "all"]).default("off"),
  // Comma-separated; needed with SEND_SCOPE=self.
  SEND_TEST_ADDRESSES: z.preprocess(emptyAsUndefined, z.string().optional()),
  // Comma-separated sender addresses whose mail counts as test mail. Empty = none.
  TEST_SENDER_ADDRESSES: z.preprocess(emptyAsUndefined, z.string().optional()),
  // Send limits per mailbox; a send over a limit waits. Integers 1 to 10 000; empty = the default.
  SEND_LIMIT_MAILBOX_HOUR: z.preprocess(
    emptyAsUndefined,
    z.coerce.number().int().min(1).max(10_000).default(DEFAULT_SEND_LIMITS.mailboxHour)
  ),
  SEND_LIMIT_MAILBOX_DAY: z.preprocess(
    emptyAsUndefined,
    z.coerce.number().int().min(1).max(10_000).default(DEFAULT_SEND_LIMITS.mailboxDay)
  ),
  SEND_LIMIT_RECIPIENT_DAY: z.preprocess(
    emptyAsUndefined,
    z.coerce.number().int().min(1).max(10_000).default(DEFAULT_SEND_LIMITS.recipientDay)
  ),
  // Comma list of authserv-ids (hosts) whose `Authentication-Results` header the suspicious-mail rules trust, besides the
  // registrable domain of the mailbox IMAP host. Empty = none.
  MAIL_TRUSTED_AUTHSERV_IDS: z.preprocess(emptyAsUndefined, z.string().optional()),
  // Minutes between two mail syncs: 2, 3 or 5. Empty = 2.
  MAIL_SYNC_EVERY_MIN: z.preprocess(emptyAsUndefined, z.enum(["2", "3", "5"]).default("2")),
  // Old name of MAIL_ALLOW_LOCAL_HOSTS; read only while that key is unset. No default: "unset" must stay visible.
  WEB_MAIL_ALLOW_LOCAL: z.preprocess(emptyAsUndefined, z.enum(["true", "false"]).optional()),
  // true = mail hosts on localhost or a private network are allowed for the connect form, sync and send (dev, e2e).
  MAIL_ALLOW_LOCAL_HOSTS: z.preprocess(emptyAsUndefined, z.enum(["true", "false"]).optional()),
  // Auth mail: host, user, password and from are set together. None set = the sender is off.
  AUTH_SMTP_HOST: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
  AUTH_SMTP_PORT: z.preprocess(emptyAsUndefined, z.coerce.number().int().min(1).max(65535).default(465)),
  AUTH_SMTP_SECURITY: z.preprocess(emptyAsUndefined, z.enum(["tls", "starttls"]).default("tls")),
  AUTH_SMTP_USER: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
  // Secret: never print or log it.
  AUTH_SMTP_PASSWORD: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
  AUTH_MAIL_FROM: z.preprocess(emptyAsUndefined, z.string().regex(addressPattern).optional()),
  // on = a new password is checked against the Have I Been Pwned list; off = tests only.
  AUTH_PWNED_CHECK: z.preprocess(emptyAsUndefined, z.enum(["on", "off"]).default("on")),
  // Mailbox OAuth apps. Each client id is set with its secret. Secrets: never print or log them.
  MAIL_OAUTH_MICROSOFT_CLIENT_ID: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
  MAIL_OAUTH_MICROSOFT_CLIENT_SECRET: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
  MAIL_OAUTH_GOOGLE_CLIENT_ID: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
  MAIL_OAUTH_GOOGLE_CLIENT_SECRET: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
};

// `WEB_BASE_URL` (the redirect URI of the OAuth apps) belongs to the web keys in `config.ts`.
type MailConfig = z.infer<z.ZodObject<typeof mailShape>> & { WEB_BASE_URL?: string | undefined };

// The send checks of `configSchema`.
export function checkSend(config: MailConfig, ctx: z.RefinementCtx): void {
  if (config.SEND_SCOPE === "self") {
    const raw = (config.SEND_TEST_ADDRESSES ?? "").split(",").filter((item) => item.trim() !== "");
    if (raw.length === 0 || !raw.every((item) => addressPattern.test(item.trim()))) {
      ctx.addIssue({
        code: "custom",
        path: ["SEND_TEST_ADDRESSES"],
        message: "needed when SEND_SCOPE is self: one or more valid addresses",
      });
    }
  }
  if (
    !(config.TEST_SENDER_ADDRESSES ?? "")
      .split(",")
      .filter((item) => item.trim() !== "")
      .every((item) => addressPattern.test(item.trim()))
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["TEST_SENDER_ADDRESSES"],
      message: "must be a comma list of valid addresses",
    });
  }
}

// The auth mail checks of `configSchema`.
export function checkAuthMail(config: MailConfig, ctx: z.RefinementCtx): void {
  const authMailKeys = ["AUTH_SMTP_HOST", "AUTH_SMTP_USER", "AUTH_SMTP_PASSWORD", "AUTH_MAIL_FROM"] as const;
  const authMailSet = authMailKeys.filter((key) => config[key] !== undefined).length;
  if (authMailSet > 0 && authMailSet < authMailKeys.length) {
    for (const key of authMailKeys) {
      if (config[key] === undefined) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "AUTH_SMTP_HOST, AUTH_SMTP_USER, AUTH_SMTP_PASSWORD and AUTH_MAIL_FROM are set together",
        });
      }
    }
  }
}

// The mailbox OAuth checks of `configSchema`.
export function checkMailOAuth(config: MailConfig, ctx: z.RefinementCtx): void {
  // Both keys of a provider or none; a provider that is set needs WEB_BASE_URL (the redirect URI). A message never holds a value.
  for (const provider of mailOAuthProviderIds) {
    const [idKey, secretKey] = mailOAuthKeys[provider];
    const idSet = config[idKey] !== undefined;
    const secretSet = config[secretKey] !== undefined;
    if (idSet !== secretSet) {
      ctx.addIssue({
        code: "custom",
        path: [idSet ? secretKey : idKey],
        message: `${idKey} and ${secretKey} are set together`,
      });
    } else if (idSet && config.WEB_BASE_URL === undefined) {
      ctx.addIssue({ code: "custom", path: ["WEB_BASE_URL"], message: `needed by ${idKey}` });
    }
  }
}

export interface AuthMailSettings {
  host: string;
  port: number;
  security: "tls" | "starttls";
  user: string;
  /** Secret: never print or log it. */
  password: string;
  from: string;
}

// null = the sender is off (none of the four keys set; `configSchema` refuses a half set).
export function authMailSettings(config: MailConfig): AuthMailSettings | null {
  const { AUTH_SMTP_HOST: host, AUTH_SMTP_USER: user, AUTH_SMTP_PASSWORD: password, AUTH_MAIL_FROM: from } = config;
  if (host === undefined || user === undefined || password === undefined || from === undefined) return null;
  return { host, port: config.AUTH_SMTP_PORT, security: config.AUTH_SMTP_SECURITY, user, password, from };
}

export function sendTestAddresses(config: MailConfig): string[] {
  return parseAddressList(config.SEND_TEST_ADDRESSES);
}

// Structural twin of `TestMailRule` in the mail module: `platform` does not import `modules`.
export function testMailRule(config: MailConfig): { senders: string[] } {
  return { senders: parseAddressList(config.TEST_SENDER_ADDRESSES) };
}

/** The send limits. */
export function sendLimits(config: MailConfig): SendLimits {
  return {
    mailboxHour: config.SEND_LIMIT_MAILBOX_HOUR,
    mailboxDay: config.SEND_LIMIT_MAILBOX_DAY,
    recipientDay: config.SEND_LIMIT_RECIPIENT_DAY,
  };
}

/** `MAIL_TRUSTED_AUTHSERV_IDS`: lower case, unique, no empty entry. */
export function mailTrustedAuthservIds(config: MailConfig): string[] {
  return parseAddressList(config.MAIL_TRUSTED_AUTHSERV_IDS);
}

/** The OAuth app of a provider, or null while it is not configured: both keys and `WEB_BASE_URL` (the redirect URI). `clientSecret` is a secret: never print or log it. */
export function mailOAuthApp(
  config: MailConfig,
  provider: MailOAuthProviderId
): { clientId: string; clientSecret: string; redirectUri: string } | null {
  const [idKey, secretKey] = mailOAuthKeys[provider];
  const clientId = config[idKey];
  const clientSecret = config[secretKey];
  if (clientId === undefined || clientSecret === undefined || config.WEB_BASE_URL === undefined) return null;
  return { clientId, clientSecret, redirectUri: `${config.WEB_BASE_URL}/api/mailboxes/oauth/${provider}/callback` };
}

export function mailOAuthConfigured(config: MailConfig, provider: MailOAuthProviderId): boolean {
  return mailOAuthApp(config, provider) !== null;
}

/** The cron expression of the `mail.sync` job: every `MAIL_SYNC_EVERY_MIN` minutes. */
export function mailSyncCron(config: MailConfig): string {
  return `*/${config.MAIL_SYNC_EVERY_MIN} * * * *`;
}

/** `MAIL_ALLOW_LOCAL_HOSTS` wins; the old `WEB_MAIL_ALLOW_LOCAL` counts only while the new key is unset. */
export function mailAllowLocal(config: MailConfig): boolean {
  return (config.MAIL_ALLOW_LOCAL_HOSTS ?? config.WEB_MAIL_ALLOW_LOCAL) === "true";
}

/** The same rule on raw env, for the probe scripts that do not call `loadConfig`. An empty string counts as unset. */
export function mailAllowLocalFromEnv(env: Record<string, string | undefined>): boolean {
  const pick = (key: string) => (env[key] === undefined || env[key] === "" ? undefined : env[key]);
  return (pick("MAIL_ALLOW_LOCAL_HOSTS") ?? pick("WEB_MAIL_ALLOW_LOCAL")) === "true";
}
