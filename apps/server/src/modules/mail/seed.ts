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

function isAscii(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) > 0x7f) return false;
  }
  return true;
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
  lines.push(header("From", msg.from));
  lines.push(header("To", msg.to.join(", ")));
  if (msg.cc && msg.cc.length > 0) lines.push(header("Cc", msg.cc.join(", ")));
  lines.push(header("Subject", msg.subject));
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
