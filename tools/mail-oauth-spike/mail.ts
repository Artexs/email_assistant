import { ImapFlow, type ListResponse } from "imapflow";
import { createTransport } from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";

import type { Endpoints } from "./oauth";
import { randomToken } from "./oauth";
import { word } from "./redact";

// IMAP, SMTP and Graph calls of the spike. Each function takes its token and host as arguments.

export type ImapSession = ImapFlow;

export async function openImap(
  endpoints: Endpoints["imap"],
  user: string,
  auth: { accessToken: string } | { pass: string }
): Promise<ImapSession> {
  const client = new ImapFlow({
    host: endpoints.host,
    port: endpoints.port,
    secure: endpoints.secure,
    auth: { user, ...auth },
    logger: false,
    disableAutoIdle: true,
    // The tests talk to a local server on 127.0.0.1 without a valid certificate; a real host is always checked.
    ...(endpoints.host === "127.0.0.1" ? { tls: { rejectUnauthorized: false } } : {}),
  });
  // An error event with no listener would end the process, and its text may name the user.
  client.on("error", () => undefined);
  await client.connect();
  return client;
}

/**
 * Evidence for a failed call: codes only. An imapflow or nodemailer error carries server text that can name the user
 * or hold a token, so the message is never copied; each field is a short word from a fixed charset.
 */
export function failureCodes(error: unknown): string {
  if (typeof error !== "object" || error === null) return "failure, no code";
  const record = error as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof record["code"] === "string") parts.push(`code ${word(record["code"])}`);
  if (record["authenticationFailed"] === true) parts.push("authenticationFailed true");
  if (typeof record["responseStatus"] === "string") parts.push(`status ${word(record["responseStatus"])}`);
  if (typeof record["serverResponseCode"] === "string")
    parts.push(`response code ${word(record["serverResponseCode"])}`);
  if (typeof record["responseCode"] === "number") parts.push(`smtp ${record["responseCode"]}`);
  const response = record["response"];
  const enhanced = typeof response === "string" ? response.match(/\b[245]\.\d{1,3}\.\d{1,3}\b/) : null;
  if (enhanced !== null) parts.push(`enhanced ${enhanced[0]}`);
  if (parts.length === 0 && error instanceof Error) parts.push(`error ${word(error.name)}`);
  return parts.length > 0 ? parts.join(", ") : "failure, no code";
}

export interface MessageSpec {
  from: string;
  to: string;
  bcc?: string;
  subject: string;
  text: string;
  messageId: string;
  actionId?: string;
  inReplyTo?: string;
  references?: string;
}

export const newMessageId = (): string => `<ea-spike-${randomToken(9)}@spike.invalid>`;

export async function buildMime(spec: MessageSpec): Promise<Buffer> {
  const composer = new MailComposer({
    from: spec.from,
    to: spec.to,
    ...(spec.bcc === undefined ? {} : { bcc: spec.bcc }),
    subject: spec.subject,
    text: spec.text,
    messageId: spec.messageId,
    ...(spec.inReplyTo === undefined ? {} : { inReplyTo: spec.inReplyTo }),
    ...(spec.references === undefined ? {} : { references: spec.references }),
    headers: spec.actionId === undefined ? {} : { "X-EA-Action-Id": spec.actionId },
  });
  const node = composer.compile();
  // Graph reads the Bcc recipient from the MIME header, so the header stays in the message.
  node.keepBcc = true;
  return await node.build();
}

export function folderBySpecialUse(folders: ListResponse[], flag: string, fallbackName?: string): string | undefined {
  const byFlag = folders.find((folder) => folder.specialUse === flag);
  if (byFlag !== undefined) return byFlag.path;
  return fallbackName === undefined ? undefined : folders.find((folder) => folder.name === fallbackName)?.path;
}

/** UIDs in `path` whose Message-ID header matches. `[]` for no match. */
export async function searchMessageId(client: ImapSession, path: string, messageId: string): Promise<number[]> {
  const lock = await client.getMailboxLock(path);
  try {
    const found = await client.search({ header: { "message-id": messageId } }, { uid: true });
    return found === false ? [] : found;
  } finally {
    lock.release();
  }
}

/** Header values of one message, lower-case keys. */
export async function readHeaders(
  client: ImapSession,
  path: string,
  uid: number,
  names: string[]
): Promise<Record<string, string>> {
  const lock = await client.getMailboxLock(path);
  try {
    const message = await client.fetchOne(String(uid), { headers: names }, { uid: true });
    if (message === false || message.headers === undefined) return {};
    const out: Record<string, string> = {};
    for (const line of message.headers.toString("utf8").split(/\r?\n(?=\S)/)) {
      const colon = line.indexOf(":");
      if (colon > 0) out[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
    }
    return out;
  } finally {
    lock.release();
  }
}

export interface SmtpTarget {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  accessToken: string;
}

const smtpTransport = (target: SmtpTarget) =>
  createTransport({
    host: target.host,
    port: target.port,
    secure: target.secure,
    // A local test server (127.0.0.1) speaks plain SMTP; a real host must use TLS.
    ...(target.host === "127.0.0.1" ? { ignoreTLS: true } : { requireTLS: !target.secure }),
    auth: { type: "OAuth2", user: target.user, accessToken: target.accessToken },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    ...(target.host === "127.0.0.1" ? { tls: { rejectUnauthorized: false } } : {}),
  });

/** `ok` when the server accepts the XOAUTH2 login, else the failure codes (row M9 expects 5.7.139). */
export async function smtpLogin(target: SmtpTarget): Promise<{ ok: true } | { ok: false; codes: string }> {
  const transport = smtpTransport(target);
  try {
    await transport.verify();
    return { ok: true };
  } catch (error) {
    return { ok: false, codes: failureCodes(error) };
  } finally {
    transport.close();
  }
}

export async function smtpSend(target: SmtpTarget, mime: Buffer, from: string, to: string): Promise<void> {
  const transport = smtpTransport(target);
  try {
    await transport.sendMail({ envelope: { from, to: [to] }, raw: mime });
  } finally {
    transport.close();
  }
}

/** Graph `sendMail` with a MIME body: base64 text, content type `text/plain`. Returns the HTTP status. */
export async function graphSendMime(
  fetchFn: typeof fetch,
  graphBase: string,
  accessToken: string,
  mime: Buffer
): Promise<number> {
  const response = await fetchFn(`${graphBase}/me/sendMail`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "text/plain" },
    body: mime.toString("base64"),
  });
  return response.status;
}

/** `plus` address: `name@host` → `name+tag@host`. */
export function plusAddress(address: string, tag: string): string {
  const at = address.lastIndexOf("@");
  return `${address.slice(0, at)}+${tag}${address.slice(at)}`;
}
