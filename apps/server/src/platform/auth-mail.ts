import type { UserLocale } from "@ea/core";
import { createTransport, type SMTPTransportOptions } from "nodemailer";

import { type AuthMailKind, authMailText } from "./auth-mail-texts";
import type { AuthMailSettings } from "./config";
import { describeError } from "./errors";
import { createLog } from "./log";

const log = createLog("auth-mail");

const DEFAULT_TIMEOUT_MS = 15_000;
// The outer timer only catches a hang: nodemailer's own ETIMEDOUT normally wins.
const OUTER_TIMER_EXTRA_MS = 5_000;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const CODE_PATTERN = /^[A-Z][A-Z_]{1,19}$/;

export interface AuthMail {
  kind: AuthMailKind;
  userId: string;
  to: string;
  locale: UserLocale;
  /** lockout: `${baseUrl}/forgot` */
  url: string;
}

export type AuthMailResult = { ok: true } | { ok: false; code: string };

export interface AuthMailer {
  /** Never rejects. */
  send(mail: AuthMail): Promise<AuthMailResult>;
}

export interface AuthMailerDeps {
  createTransport?: (options: SMTPTransportOptions) => {
    sendMail(message: object): Promise<unknown>;
    close(): void;
  };
  timeoutMs?: number;
}

/** TLS certificates are always checked: no option sets `tls.rejectUnauthorized`. Only a loopback host connects without TLS. */
export function authMailTransportOptions(settings: AuthMailSettings, timeoutMs: number): SMTPTransportOptions {
  const base: SMTPTransportOptions = {
    host: settings.host,
    port: settings.port,
    auth: { user: settings.user, pass: settings.password },
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
  };
  if (LOOPBACK_HOSTS.has(settings.host.toLowerCase())) return { ...base, secure: false, ignoreTLS: true };
  if (settings.security === "starttls") return { ...base, secure: false, requireTLS: true };
  return { ...base, secure: true };
}

/** The nodemailer `code` when it is a plain upper-case word, else `UNKNOWN`. Never the error text. */
export function authMailErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error;
    if (typeof code === "string" && CODE_PATTERN.test(code)) return code;
  }
  return "UNKNOWN";
}

const TIMED_OUT = Symbol("auth-mail-timeout");

export function createAuthMailer(settings: AuthMailSettings, deps: AuthMailerDeps = {}): AuthMailer {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const open = deps.createTransport ?? createTransport;

  return {
    async send(mail) {
      // The mail text holds the link: only the user id and a code reach the log.
      const label = `auth mail ${mail.kind}`;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const { subject, text } = authMailText(mail.kind, mail.locale, mail.url);
        const transport = open(authMailTransportOptions(settings, timeoutMs));
        try {
          const sending = transport.sendMail({
            from: { name: "Email Assistant", address: settings.from },
            to: mail.to,
            subject,
            text,
          });
          // A late rejection of the raced send is handled here, so it never goes unhandled.
          sending.catch(() => undefined);
          const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
            timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs + OUTER_TIMER_EXTRA_MS);
          });
          const outcome = await Promise.race([sending, timeout]);
          if (outcome === TIMED_OUT) {
            log.warn(`${label} to user ${mail.userId} failed: TIMEOUT`);
            return { ok: false, code: "TIMEOUT" };
          }
        } finally {
          transport.close();
        }
        log.info(`${label} sent to user ${mail.userId}`);
        return { ok: true };
      } catch (error) {
        const code = authMailErrorCode(error);
        log.warn(`${label} to user ${mail.userId} failed: ${code}`);
        return { ok: false, code };
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  };
}

export interface AuthMailTasks {
  /** Never throws: reads the locale, sends, reports a failure. */
  start(mail: Omit<AuthMail, "locale">): void;
  /** Resolves when no send is running (tests, shutdown). */
  idle(): Promise<void>;
}

/** L8: the caller never waits for the mail. A task never rejects and stays in a set until it settles. */
export function createAuthMailTasks(deps: {
  mailer: AuthMailer;
  localeOf: (userId: string) => Promise<UserLocale>;
  onFailed: (userId: string, kind: AuthMailKind, code: string) => void;
}): AuthMailTasks {
  const running = new Set<Promise<void>>();

  return {
    start(mail) {
      const task: Promise<void> = (async () => {
        try {
          const locale = await deps.localeOf(mail.userId).catch((): UserLocale => "pl");
          const result = await deps.mailer.send({ ...mail, locale });
          if (!result.ok) deps.onFailed(mail.userId, mail.kind, result.code);
        } catch (error) {
          // Never the address or the link.
          log.error(`auth mail ${mail.kind} task for user ${mail.userId} failed: ${describeError(error)}`);
        }
      })().finally(() => {
        running.delete(task);
      });
      running.add(task);
    },
    async idle() {
      while (running.size > 0) {
        await Promise.all([...running]);
      }
    },
  };
}
