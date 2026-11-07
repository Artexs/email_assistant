import { createTransport, type SMTPTransportOptions } from "nodemailer";
import SMTPConnection, { type SMTPConnectionOptions } from "nodemailer/lib/smtp-connection";

import { HardError, SoftError } from "../../../platform/errors";
import { MailAuthError, SmtpSendError, type MailSender, type SendResult, type SmtpStage } from "../port";

import { isLoopbackHost } from "./client";

// Nodemailer codes for a lost connection or a timeout. Its ESOCKET code wraps every socket error,
// so ESOCKET counts as soft only when the original socket code is a connection code (a certificate error stays hard).
const SOFT_CODES = new Set(["ECONNECTION", "ETIMEDOUT"]);
const SOFT_SOCKET_CODES = new Set(["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EPIPE", "ENOTFOUND", "EAI_AGAIN"]);

export interface SmtpConnectOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  secure?: boolean;
}

/** TLS certificates are always checked: this never sets `tls`, so no option can turn the check off. */
export function smtpTransportOptions(opts: SmtpConnectOptions): SMTPTransportOptions {
  const secure = opts.secure ?? !isLoopbackHost(opts.host);
  if (!secure && !isLoopbackHost(opts.host)) {
    throw new HardError("plain SMTP is allowed only to a loopback host");
  }
  return {
    host: opts.host,
    port: opts.port,
    secure,
    auth: { user: opts.user, pass: opts.password },
    ...(secure ? {} : { ignoreTLS: true }),
  };
}

/** Maps a nodemailer error to a typed error. The message never holds the password; the original is the `cause`. */
export function toSmtpError(error: unknown, action = "verify"): Error {
  if (error instanceof SoftError || error instanceof HardError) return error;
  const fields = (typeof error === "object" && error !== null ? error : {}) as {
    code?: unknown;
    originalCode?: unknown;
  };
  const code = typeof fields.code === "string" ? fields.code : null;
  const originalCode = typeof fields.originalCode === "string" ? fields.originalCode : null;
  if (code === "EAUTH") {
    return new MailAuthError("SMTP login failed", { cause: error });
  }
  if ((code !== null && SOFT_CODES.has(code)) || (originalCode !== null && SOFT_SOCKET_CODES.has(originalCode))) {
    return new SoftError(`SMTP ${action}: connection error ${originalCode ?? code}`, { cause: error });
  }
  const shown = originalCode ?? code;
  return new HardError(`SMTP ${action} failed${shown === null ? "" : ` (${shown})`}`, { cause: error });
}

/** Connects, starts TLS and logs in, then closes. Sends no mail. */
export async function verifySmtpLogin(opts: SmtpConnectOptions): Promise<void> {
  const transport = createTransport(smtpTransportOptions(opts));
  try {
    await transport.verify();
  } catch (error) {
    throw toSmtpError(error);
  } finally {
    transport.close();
  }
}

/** `mailbox:check --probe` only. Sends one short mail to the mailbox's own address; no retry (send is at-most-once). */
export async function sendProbeToSelf(
  opts: SmtpConnectOptions,
  input: { address: string; probeId: string }
): Promise<void> {
  const transport = createTransport(smtpTransportOptions(opts));
  try {
    await transport.sendMail({
      from: input.address,
      to: input.address,
      subject: `EA probe ${input.probeId}`,
      text: "Email assistant probe. You can delete this mail.",
      headers: { "X-EA-Probe": input.probeId },
    });
  } catch (error) {
    throw toSmtpError(error, "send");
  } finally {
    transport.close();
  }
}

/** What the logger hook saw of the SMTP dialogue. It holds counts and flags only, never text. */
export interface SmtpMarks {
  clientLines: number;
  mailFromSent: boolean;
  rcptLines: number;
  dataSent: boolean;
  repliesAfterMailFrom: number;
  contentStarted: boolean;
}

const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;

function updateMarks(marks: SmtpMarks, entry: unknown, message: unknown): void {
  const tnx = typeof entry === "object" && entry !== null ? (entry as { tnx?: unknown }).tnx : undefined;
  if (tnx === "client") {
    marks.clientLines += 1;
    const line = String(message).trim().toUpperCase();
    if (line.startsWith("MAIL FROM")) {
      marks.mailFromSent = true;
      marks.repliesAfterMailFrom = 0;
    } else if (line.startsWith("RCPT TO")) {
      marks.rcptLines += 1;
    } else if (line === "DATA") {
      marks.dataSent = true;
    }
  } else if (tnx === "server" && marks.mailFromSent) {
    // One server entry per complete reply, in command order. The DATA reply follows the MAIL FROM reply and one reply
    // per recipient, with and without PIPELINING. Any 2xx or 3xx reply to DATA starts the content phase (nodemailer).
    marks.repliesAfterMailFrom += 1;
    if (marks.dataSent && marks.repliesAfterMailFrom >= 2 + marks.rcptLines) marks.contentStarted = true;
  }
}

/** The logger object for `SMTPConnection`: every level only updates `marks`. It stores no text and prints nothing. */
export function createSmtpMarks(): { marks: SmtpMarks; logger: object } {
  const marks: SmtpMarks = {
    clientLines: 0,
    mailFromSent: false,
    rcptLines: 0,
    dataSent: false,
    repliesAfterMailFrom: 0,
    contentStarted: false,
  };
  const logger: Record<string, (entry?: unknown, message?: unknown) => void> = {};
  for (const level of LOG_LEVELS) {
    logger[level] = (entry, message) => updateMarks(marks, entry, message);
  }
  return { marks, logger };
}

/**
 * Maps a nodemailer error to a typed error. The stage tells whether the content phase began:
 * `content` and `unknown` mean the server may have the mail. The message never holds `err.response` (it can hold an address).
 */
export function classifySmtpError(
  error: unknown,
  step: "connect" | "login" | "send",
  marks: SmtpMarks
): SmtpSendError | MailAuthError {
  const fields = (typeof error === "object" && error !== null ? error : {}) as {
    code?: unknown;
    originalCode?: unknown;
    responseCode?: unknown;
    permanent?: unknown;
  };
  const code = typeof fields.code === "string" ? fields.code : "UNKNOWN";
  if (code === "EAUTH") return new MailAuthError("SMTP login failed", { cause: error });
  const originalCode = typeof fields.originalCode === "string" ? fields.originalCode : null;
  const responseCode = typeof fields.responseCode === "number" ? fields.responseCode : null;
  const permanent = fields.permanent === true || (responseCode !== null && responseCode >= 500);
  const soft =
    code === "ECONNECTION" ||
    code === "ETIMEDOUT" ||
    code === "EDNS" ||
    (code === "ESOCKET" && originalCode !== null && SOFT_SOCKET_CODES.has(originalCode)) ||
    (responseCode !== null && responseCode >= 400 && responseCode <= 499);
  let stage: SmtpStage;
  if (step !== "send") stage = step;
  else if (code === "EENVELOPE") stage = "envelope";
  else if (code === "EMESSAGE") stage = "content";
  else stage = marks.contentStarted || marks.clientLines === 0 ? "unknown" : "envelope";
  return new SmtpSendError(stage, code, responseCode, permanent, soft, { cause: error });
}

/** The part of `SMTPConnection` that the sender uses; tests may pass another connection. */
export interface SmtpConnectionLike {
  connect(callback: (error?: Error) => void): void;
  login(auth: { user: string; pass: string }, callback: (error: Error | null) => void): void;
  send(
    envelope: { from: string; to: string[] },
    message: Buffer,
    callback: (error: Error | null, info?: { response: string; accepted: string[]; rejected: string[] }) => void
  ): void;
  quit(): void;
  close(): void;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "end", listener: () => void): unknown;
}

const QUIT_WAIT_MS = 2_000;

function defaultConnection(options: object): SmtpConnectionLike {
  return new SMTPConnection(options as SMTPConnectionOptions) as unknown as SmtpConnectionLike;
}

async function closeConnection(connection: SmtpConnectionLike, polite: boolean): Promise<void> {
  if (polite) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, QUIT_WAIT_MS);
      connection.on("end", () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        connection.quit();
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
  }
  connection.close();
}

/**
 * A sender with one SMTP connection per `send` call. Send is at-most-once: it never retries, and the error's `stage`
 * tells the caller whether the content phase began (D10). Pass the failing step through `classifySmtpError`.
 */
export async function openSmtpSender(
  opts: SmtpConnectOptions,
  deps: { connection?: (options: object) => SmtpConnectionLike } = {}
): Promise<MailSender> {
  const { auth, ...transport } = smtpTransportOptions(opts);
  const makeConnection = deps.connection ?? defaultConnection;
  const credentials = { user: auth?.user ?? opts.user, pass: auth?.pass ?? opts.password };
  return {
    async send(input): Promise<SendResult> {
      const { marks, logger } = createSmtpMarks();
      const connection = makeConnection({
        ...transport,
        name: "ea-mail",
        connectionTimeout: 30_000,
        greetingTimeout: 30_000,
        socketTimeout: 60_000,
        transactionLog: true,
        logger,
      });
      // An `error` event without a listener ends the process: route it into the step that waits, or keep it for the next.
      let pending: ((error: Error) => void) | null = null;
      let early: Error | null = null;
      connection.on("error", (error) => {
        if (pending === null) early ??= error;
        else pending(error);
      });
      const step = <T>(
        name: "connect" | "login" | "send",
        start: (done: (error: Error | null | undefined, value?: T) => void) => void
      ): Promise<T> =>
        new Promise<T>((resolve, reject) => {
          const fail = (error: Error) => {
            pending = null;
            reject(classifySmtpError(error, name, marks));
          };
          if (early !== null) return fail(early);
          pending = fail;
          start((error, value) => {
            if (error) return fail(error);
            pending = null;
            resolve(value as T);
          });
        });
      let failed = false;
      try {
        await step<undefined>("connect", (done) => connection.connect((error) => done(error)));
        await step<undefined>("login", (done) => connection.login(credentials, (error) => done(error)));
        const info = await step<{ response: string; accepted: string[]; rejected: string[] }>("send", (done) =>
          connection.send(input.envelope, input.raw, (error, result) => done(error, result))
        );
        return { response: info.response, accepted: info.accepted, rejected: info.rejected };
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        await closeConnection(connection, !failed);
      }
    },
    async close() {
      // No pooled connection: every send closes its own.
    },
  };
}
