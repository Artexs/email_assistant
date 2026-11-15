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

// The remains of a terminal color code ("[31m", "[0;1K") that an escape-stripping step left in stored text, and the forms in which
// the code can come through a text channel (F116 review 12, N6). Telegram shows plain text, so none of them can format a message,
// but they look like damage: the loop lines and the follow-up cards drop them. The forms: a raw ESC, the single-character CSI
// (U+009B), an escaped spelling in the text (`\x1b`, `\u001b`, `\033`, `\e`, `^[`), an encoded one (`%1B`, quoted-printable `=1B`,
// the HTML entities `&#27;` and `&#x1b;`), full-width brackets, digits and letters, and invisible characters between the parts.
// The final letter is one that a control sequence ends with (m, K, J, H, A-G, S, T, f, h, l, s, u): "[1a]" stays.
// An operating-system command (ESC ] ... BEL or ST, or U+009D ... U+009C) goes with its text, at most 200 characters of it.
const INVISIBLE_IN_CODE =
  /[\u00ad\u034f\u061c\u115f\u1160\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2069\u3164\ufe00-\ufe0f\ufeff\uffa0]|[\u{e0000}-\u{e007f}]/gu;
const ESCAPE_PREFIX = String.raw`(?:\u001b|\\[xX]1[bB]|\\[uU]001[bB]|\\0?33|\\e|\^\[|%1[bB]|=1[bB]|&#0*27;|&#[xX]0*1[bB];)`;
const OPENER = String.raw`(?:${ESCAPE_PREFIX}?[\[\uff3b]|\u009b)`;
const NUMBER = String.raw`[0-9\uff10-\uff19]{1,3}`;
const ESCAPE_REMAINS = new RegExp(
  String.raw`${OPENER}${NUMBER}(?:[;\uff1b]${NUMBER})*[ABCDEFGHJKSTfhlmsu\uff21-\uff27\uff28\uff2a\uff2b\uff33\uff34\uff46\uff48\uff4c\uff4d\uff53\uff55]`,
  "g"
);
// eslint-disable-next-line no-control-regex -- the point is to remove them
const OPERATING_SYSTEM_COMMAND = /(?:\u001b\]|\u009d)[^\u0007\u001b\u009c]{0,200}(?:\u0007|\u001b\\|\u009c)?/g;

export function withoutEscapeRemains(text: string): string {
  return text.replace(INVISIBLE_IN_CODE, "").replace(OPERATING_SYSTEM_COMMAND, "").replace(ESCAPE_REMAINS, "");
}
