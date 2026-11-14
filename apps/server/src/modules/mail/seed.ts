export interface SeedMessage {
  messageId?: string;
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  date: Date;
  text?: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
  headers?: Record<string, string>;
}

const BOUNDARY = "ea-seed-boundary-0001";

// Synthetic mail = a Message-ID that ends with `@ea-seed.test>`. Not a security boundary: any sender can write such an id.
export const SYNTHETIC_MESSAGE_ID_DOMAIN = "ea-seed.test";
export const SYNTHETIC_MESSAGE_ID_LIKE = `%@${SYNTHETIC_MESSAGE_ID_DOMAIN}>`;

export function isSyntheticMessageId(messageId: string | null): boolean {
  return messageId !== null && messageId.toLowerCase().endsWith(`@${SYNTHETIC_MESSAGE_ID_DOMAIN}>`);
}

/** Lower-case sender addresses whose mail is test mail (TEST_SENDER_ADDRESSES). */
export interface TestMailRule {
  senders: readonly string[];
}
export const NO_TEST_SENDERS: TestMailRule = { senders: [] };

// Test mail = a synthetic Message-ID, or a sender in the rule. Not a security boundary: a sender can forge both.
export function isTestMail(
  mail: { messageIdHeader: string | null; fromAddress: string | null },
  rule: TestMailRule
): boolean {
  if (isSyntheticMessageId(mail.messageIdHeader)) return true;
  return mail.fromAddress !== null && rule.senders.includes(mail.fromAddress.toLowerCase());
}

function isAscii(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) > 0x7f) return false;
  }
  return true;
}

// RFC 2047: a value with non-ASCII text becomes encoded words of at most 45 UTF-8 bytes each (a word stays under 75 characters).
function encodeWords(value: string): string {
  if (/[\r\n]/.test(value)) throw new Error("Header value contains a line break");
  if (isAscii(value)) return value;
  const words: string[] = [];
  let chunk = "";
  for (const char of value) {
    if (chunk !== "" && Buffer.byteLength(chunk + char) > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += char;
  }
  words.push(chunk);
  return words.map((word) => `=?UTF-8?B?${Buffer.from(word).toString("base64")}?=`).join(" ");
}

// Encodes the display name of `Name <addr>`. The address itself is never encoded: a non-ASCII address then throws in header().
function encodeAddress(value: string): string {
  const match = /^(.*?)\s*(<[^<>]*>)\s*$/.exec(value);
  if (!match) {
    if (/[<>]/.test(value)) throw new Error("Malformed address field");
    return value;
  }
  const name = match[1] ?? "";
  if (/[<>]/.test(name)) throw new Error("Malformed address field");
  return name === "" ? (match[2] ?? value) : `${encodeWords(name)} ${match[2]}`;
}

function header(name: string, value: string): string {
  if (!isAscii(name) || !isAscii(value)) {
    throw new Error(`Header ${name.replace(/[^\x20-\x7e]/g, "?")} contains non-ASCII text`);
  }
  if (/[\r\n]/.test(name) || /[\r\n]/.test(value)) {
    throw new Error(`Header ${name.replace(/[\r\n]/g, "?")} contains a line break`);
  }
  return `${name}: ${value}`;
}

function crlf(body: string): string {
  return body.replace(/\r\n|\r|\n/g, "\r\n");
}

/** Renders a synthetic RFC 5322 message with CRLF line ends. Pure. */
export function renderSeedMessage(msg: SeedMessage): string {
  const lines: string[] = [];
  if (msg.messageId) lines.push(header("Message-ID", msg.messageId));
  lines.push(header("From", encodeAddress(msg.from)));
  lines.push(header("To", msg.to.map(encodeAddress).join(", ")));
  if (msg.cc && msg.cc.length > 0) lines.push(header("Cc", msg.cc.map(encodeAddress).join(", ")));
  lines.push(header("Subject", encodeWords(msg.subject)));
  lines.push(header("Date", msg.date.toUTCString()));
  if (msg.inReplyTo) lines.push(header("In-Reply-To", msg.inReplyTo));
  if (msg.references && msg.references.length > 0) {
    lines.push(header("References", msg.references.join(" ")));
  }
  lines.push("MIME-Version: 1.0");

  const text = msg.text;
  const html = msg.html;
  let body: string;
  if (text !== undefined && html !== undefined) {
    lines.push(`Content-Type: multipart/alternative; boundary="${BOUNDARY}"`);
    body = [
      `--${BOUNDARY}`,
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      crlf(text),
      `--${BOUNDARY}`,
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      crlf(html),
      `--${BOUNDARY}--`,
    ].join("\r\n");
  } else if (html !== undefined) {
    lines.push("Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: 8bit");
    body = crlf(html);
  } else {
    lines.push("Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: 8bit");
    body = crlf(text ?? "");
  }

  for (const [name, value] of Object.entries(msg.headers ?? {})) {
    lines.push(header(name, value));
  }
  return `${lines.join("\r\n")}\r\n\r\n${body}`;
}
