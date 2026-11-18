import { simpleParser, type AddressObject } from "mailparser";

import { SoftError } from "../../../platform/errors";
import { createLog } from "../../../platform/log";
import { MailAuthError, SmtpSendError, type MailSender, type SendResult, type SmtpStage } from "../port";

// The Microsoft Graph `sendMail` sender (the Graph error map). It sends the MIME of `compose.ts` as it is, so the send is as safe
// to retry as SMTP: the `SmtpSendError` stage tells the caller if the mail may be out (`unknown`: no resend).
// Nothing here logs a header, a body, a token or an address. The error body of Graph is read for `error.code` only.
const log = createLog("mail");

/** Graph takes 4 MB per request; base64 adds a third, so a raw message over 3 MiB cannot go (default limit; spike row M10 may change it). */
export const GRAPH_MAX_RAW_BYTES = 3 * 1024 * 1024;
export const GRAPH_SEND_TIMEOUT_MS = 30_000;
const ERROR_BODY_MAX_BYTES = 16_384;
const GRAPH_CODE = "EGRAPH";

// A rejected fetch with one of these codes never reached the server. Any other rejection (abort, timeout, reset) may have: `unknown`.
const CONNECT_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "FailedToOpenSocket",
]);

export interface GraphSenderOpenOptions {
  /** The access token for the `graph` resource. */
  accessToken: string;
  /** The mailbox address: the sender of every mail. */
  from: string;
  /** A new access token that skips the process cache (after a 401). */
  freshToken(): Promise<string>;
  /** The Graph origin, for example `https://graph.microsoft.com`. The provider registry holds it. */
  baseUrl: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

const fail = (stage: SmtpStage, responseCode: number | null, permanent: boolean, soft: boolean, cause?: unknown) =>
  new SmtpSendError(stage, GRAPH_CODE, responseCode, permanent, soft, cause === undefined ? undefined : { cause });

/** The end of the header block: the first empty line. */
function headerBlockOf(raw: Buffer): Buffer {
  const ends = [raw.indexOf("\r\n\r\n"), raw.indexOf("\n\n")].filter((at) => at !== -1);
  return ends.length === 0 ? raw : raw.subarray(0, Math.min(...ends));
}

function addressesOf(field: AddressObject | AddressObject[] | undefined): string[] {
  const objects = field === undefined ? [] : Array.isArray(field) ? field : [field];
  const found: string[] = [];
  const walk = (entries: { address?: string | undefined; group?: unknown }[]): void => {
    for (const entry of entries) {
      if (Array.isArray(entry.group)) walk(entry.group as { address?: string; group?: unknown }[]);
      else if (typeof entry.address === "string" && entry.address !== "") found.push(entry.address.toLowerCase());
    }
  };
  for (const object of objects) walk(object.value as { address?: string; group?: unknown }[]);
  return found;
}

/** The recipients Graph will use: the `To`, `Cc` and `Bcc` addresses of the MIME, lower case. Null when the headers do not parse. */
async function mimeRecipients(raw: Buffer): Promise<Set<string> | null> {
  const parsed = await simpleParser(headerBlockOf(raw)).catch(() => undefined);
  if (parsed === undefined) return null;
  return new Set([...addressesOf(parsed.to), ...addressesOf(parsed.cc), ...addressesOf(parsed.bcc)]);
}

/** Graph takes its recipients from the MIME. A different envelope would mean a mail to someone else. */
async function envelopeMatchesMime(
  opts: Pick<GraphSenderOpenOptions, "from">,
  input: Parameters<MailSender["send"]>[0]
): Promise<boolean> {
  if (input.envelope.from.toLowerCase() !== opts.from.toLowerCase()) return false;
  const mime = await mimeRecipients(input.raw);
  if (mime === null) return false;
  const envelope = new Set(input.envelope.to.map((address) => address.toLowerCase()));
  return envelope.size === mime.size && [...envelope].every((address) => mime.has(address));
}

/** The `error.code` of a Graph error body, else null. Never the message. */
async function errorCodeOf(response: Response): Promise<string | null> {
  try {
    const reader = response.body?.getReader();
    if (reader === undefined) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < ERROR_BODY_MAX_BYTES) {
      const part = await reader.read();
      if (part.done) break;
      chunks.push(part.value);
      size += part.value.length;
    }
    await reader.cancel().catch(() => undefined);
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
    return typeof code === "string" ? code : null;
  } catch {
    return null;
  }
}

async function drain(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

/** A rejected `fetch`: the code of the error, or of its cause. */
function fetchErrorCode(error: unknown): string | null {
  const read = (value: unknown): string | null => {
    const code = typeof value === "object" && value !== null ? (value as { code?: unknown }).code : undefined;
    return typeof code === "string" ? code : null;
  };
  return read(error) ?? read((error as { cause?: unknown } | null)?.cause);
}

/**
 * A sender that calls `POST <baseUrl>/v1.0/me/sendMail` once per `send`. It never retries a call that the server may have
 * accepted. A 401 means "not accepted": one call with a fresh token follows. A refused login is a `MailAuthError` with a reason.
 */
export async function openGraphSender(opts: GraphSenderOpenOptions): Promise<MailSender> {
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? GRAPH_SEND_TIMEOUT_MS;
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/v1.0/me/sendMail`;
  let token = opts.accessToken;
  let closed = false;

  // One call. Returns the response, or throws the typed error of a `fetch` that did not answer.
  async function call(body: string): Promise<Response> {
    try {
      // `redirect: "error"`: the bearer token never follows a redirect to another host.
      return await fetchFn(url, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "text/plain" },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const code = fetchErrorCode(error);
      if (code !== null && CONNECT_CODES.has(code)) throw fail("connect", null, false, true, error);
      throw fail("unknown", null, false, false, error);
    }
  }

  // A new token after a 401. The mail was not accepted, so a failure here is a failure before the send.
  async function renewToken(): Promise<void> {
    try {
      token = await opts.freshToken();
    } catch (error) {
      if (error instanceof MailAuthError) throw error;
      throw fail("connect", null, false, error instanceof SoftError, error);
    }
  }

  async function answerOf(response: Response, envelope: { to: string[] }): Promise<SendResult> {
    const status = response.status;
    if (status === 202) {
      await drain(response);
      return { response: "202 Accepted", accepted: [...envelope.to], rejected: [] };
    }
    const code = await errorCodeOf(response);
    if (status === 401) throw new MailAuthError("Graph login refused", { reason: "oauth_revoked" });
    if (status === 403) {
      throw new MailAuthError("Graph access refused", {
        reason: code === "ErrorAccessDenied" ? "admin_consent_required" : "protocol_disabled",
      });
    }
    if (status === 429 || status === 503) throw fail("connect", status, false, true);
    if (status >= 400 && status < 500) throw fail("envelope", status, true, false);
    // Any 5xx, and a success status that is not 202: the server may have the mail.
    throw fail("unknown", status, false, false);
  }

  return {
    async send(input): Promise<SendResult> {
      if (closed) throw fail("connect", null, false, false);
      if (!(await envelopeMatchesMime(opts, input)) || input.raw.length > GRAPH_MAX_RAW_BYTES) {
        throw fail("envelope", null, true, false);
      }
      const body = input.raw.toString("base64");
      let response = await call(body);
      if (response.status === 401) {
        await drain(response);
        await renewToken();
        response = await call(body);
      }
      try {
        return await answerOf(response, input.envelope);
      } catch (error) {
        if (error instanceof SmtpSendError) {
          log.warn("graph_send_failed", { send_stage: error.stage, code: error.responseCode ?? error.code });
        }
        throw error;
      }
    },
    async close() {
      closed = true;
    },
  };
}
