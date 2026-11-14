import type { CoreTexts } from "../texts";
import { removeLinks } from "../triage/untrusted-text";

// eslint-disable-next-line no-control-regex -- the point is to remove them
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
const INVISIBLE = /[\u061c\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

export function wellFormedText(text: string): string {
  return text.replace(LONE_SURROGATE, "\ufffd");
}

// Makes mail text safe for a chat message: one line, no control or bidi characters, at most `max` code points.
export function cutText(text: string, max: number): string {
  const clean = wellFormedText(text.replace(CONTROL, " ").replace(INVISIBLE, "")).replace(/\s+/g, " ").trim();
  const points = Array.from(clean);
  if (points.length <= max) return clean;
  return `${points.slice(0, max - 1).join("")}…`;
}

export function cleanSubject(subject: string | null, texts: CoreTexts): string {
  const clean = subject === null ? "" : cutText(removeLinks(subject), 80);
  return clean === "" ? texts.common.noSubject : clean;
}

export function senderLabel(from: string | null, texts: CoreTexts): string {
  const clean = from === null ? "" : cutText(from, 40);
  return clean === "" ? texts.common.unknownSender : clean;
}
