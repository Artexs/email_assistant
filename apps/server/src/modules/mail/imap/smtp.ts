import { createTransport, type SMTPTransportOptions } from "nodemailer";

import { HardError, SoftError } from "../../../platform/errors";
import { MailAuthError } from "../port";

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
export function toSmtpError(error: unknown): Error {
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
    return new SoftError(`SMTP verify: connection error ${originalCode ?? code}`, { cause: error });
  }
  const shown = originalCode ?? code;
  return new HardError(`SMTP verify failed${shown === null ? "" : ` (${shown})`}`, { cause: error });
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
