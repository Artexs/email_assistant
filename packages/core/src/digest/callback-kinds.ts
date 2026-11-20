import { type RejectReason, rejectReasons } from "../metrics/m3";

import type { Callback, LabelCategory, ReviewLabelCategory } from "./callback";

// The registry of the Telegram callbacks: one entry per kind. The entry names the family of the kind (the server has one
// handler per family), the wire prefix and the codec. A new kind is one entry; the typecheck fails until it has all four.
export const callbackFamilies = ["feedback", "answered", "reply", "loop", "delegate", "approval"] as const;
export type CallbackFamily = (typeof callbackFamilies)[number];

type CallbackKind = Callback["kind"];
type CallbackOfKind<K extends CallbackKind> = Extract<Callback, { kind: K }>;

interface KindEntry<K extends CallbackKind> {
  family: CallbackFamily;
  // Two lowercase letters, unique across the kinds.
  prefix: string;
  // The part of the data after the prefix and its `:`; undefined when the data is the bare prefix.
  encode(callback: CallbackOfKind<K>): string | undefined;
  // `rest` is undefined when the data has no `:`. Anything that is not exactly the form of the kind gives null.
  decode(rest: string | undefined): CallbackOfKind<K> | null;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_REST = new RegExp(`^${UUID}$`);
// One code letter, then a UUID. The letter is looked up in a Map of the kind, never in a plain object.
const CODED_REST = new RegExp(`^([a-z]):(${UUID})$`);
// `dp:<mail>:<delegate>`: each UUID as 22 characters of base64url (16 bytes, no padding), so the data is 48 bytes.
const B64_UUID = "[A-Za-z0-9_-]{22}";
const B64_UUID_REST = new RegExp(`^${B64_UUID}$`);
const DELEGATE_PICK_REST = new RegExp(`^(${B64_UUID}):(${B64_UUID})$`);

const CATEGORY_CODES: Record<ReviewLabelCategory, string> = {
  urgent: "u",
  needs_reply: "r",
  info: "i",
  notification: "n",
  spam: "s",
  delegation: "d",
};
// The review prefixes take all six codes; the digest prefixes keep the five label codes (no `d`).
const REVIEW_CODE_TO_CATEGORY: ReadonlyMap<string, ReviewLabelCategory> = new Map(
  Object.entries(CATEGORY_CODES).map(([category, code]) => [code, category as ReviewLabelCategory])
);
const LABEL_CODE_TO_CATEGORY: ReadonlyMap<string, LabelCategory> = new Map(
  [...REVIEW_CODE_TO_CATEGORY].filter((entry): entry is [string, LabelCategory] => entry[1] !== "delegation")
);
// After a reject: the reason (p = wrong_person, c = wrong_content, n = not_needed).
const REASON_CODES: Record<RejectReason, string> = { wrong_person: "p", wrong_content: "c", not_needed: "n" };
const CODE_TO_REASON: ReadonlyMap<string, RejectReason> = new Map(
  rejectReasons.map((reason) => [REASON_CODES[reason], reason])
);

function checkedId(id: string): string {
  if (!UUID_REST.test(id)) throw new Error("bad id");
  return id;
}

function checkedEmailId(id: string): string {
  if (!UUID_REST.test(id)) throw new Error("bad email id");
  return id;
}

// A UUID as 22 characters of base64url. The caller checked the UUID form.
function uuidToBase64Url(id: string): string {
  const hex = id.replaceAll("-", "");
  let binary = "";
  for (let i = 0; i < 32; i += 2) binary += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

// The UUID of 22 characters of base64url, or null. A value that is not the one canonical form of its 16 bytes gives null.
function base64UrlToUuid(value: string): string | null {
  if (!B64_UUID_REST.test(value)) return null;
  let binary: string;
  try {
    binary = atob(`${value.replaceAll("-", "+").replaceAll("_", "/")}==`);
  } catch {
    return null;
  }
  if (binary.length !== 16) return null;
  const hex = [...binary].map((char) => char.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return uuidToBase64Url(id) === value ? id : null;
}

// The rest is exactly one lowercase UUID.
function idDecode<R>(build: (id: string) => R): (rest: string | undefined) => R | null {
  return (rest) => (rest !== undefined && UUID_REST.test(rest) ? build(rest) : null);
}

// The rest is one code letter, `:` and a UUID; the code must be a key of `codes`.
function codedDecode<C, R>(
  codes: ReadonlyMap<string, C>,
  build: (code: C, id: string) => R
): (rest: string | undefined) => R | null {
  return (rest) => {
    const match = rest === undefined ? null : CODED_REST.exec(rest);
    if (match === null) return null;
    const code = codes.get(match[1] as string);
    return code === undefined ? null : build(code, match[2] as string);
  };
}

export const callbackKinds = {
  // feedback
  right: {
    family: "feedback",
    prefix: "fr",
    encode: (c) => `${CATEGORY_CODES[c.category]}:${checkedEmailId(c.emailId)}`,
    decode: codedDecode(LABEL_CODE_TO_CATEGORY, (category, emailId) => ({ kind: "right", category, emailId })),
  },
  edit: {
    family: "feedback",
    prefix: "fe",
    encode: (c) => checkedEmailId(c.emailId),
    decode: idDecode((emailId) => ({ kind: "edit", emailId })),
  },
  undo: {
    family: "feedback",
    prefix: "fu",
    encode: (c) => checkedEmailId(c.emailId),
    decode: idDecode((emailId) => ({ kind: "undo", emailId })),
  },
  pick: {
    family: "feedback",
    prefix: "fc",
    encode: (c) => `${CATEGORY_CODES[c.category]}:${checkedEmailId(c.emailId)}`,
    decode: codedDecode(LABEL_CODE_TO_CATEGORY, (category, emailId) => ({ kind: "pick", category, emailId })),
  },
  cancel: {
    family: "feedback",
    prefix: "fx",
    encode: (c) => checkedEmailId(c.emailId),
    decode: idDecode((emailId) => ({ kind: "cancel", emailId })),
  },
  // The buttons of the /review page: they act as right, pick, edit and cancel, but record the source `review`.
  review_right: {
    family: "feedback",
    prefix: "vr",
    encode: (c) => `${CATEGORY_CODES[c.category]}:${checkedEmailId(c.emailId)}`,
    decode: codedDecode(REVIEW_CODE_TO_CATEGORY, (category, emailId) => ({ kind: "review_right", category, emailId })),
  },
  review_pick: {
    family: "feedback",
    prefix: "vc",
    encode: (c) => `${CATEGORY_CODES[c.category]}:${checkedEmailId(c.emailId)}`,
    decode: codedDecode(REVIEW_CODE_TO_CATEGORY, (category, emailId) => ({ kind: "review_pick", category, emailId })),
  },
  review_edit: {
    family: "feedback",
    prefix: "ve",
    encode: (c) => checkedEmailId(c.emailId),
    decode: idDecode((emailId) => ({ kind: "review_edit", emailId })),
  },
  review_cancel: {
    family: "feedback",
    prefix: "vx",
    encode: (c) => checkedEmailId(c.emailId),
    decode: idDecode((emailId) => ({ kind: "review_cancel", emailId })),
  },
  // answered
  answered_yes: {
    family: "answered",
    prefix: "ay",
    encode: (c) => checkedId(c.emailId),
    decode: idDecode((emailId) => ({ kind: "answered_yes", emailId })),
  },
  answered_no: {
    family: "answered",
    prefix: "an",
    encode: (c) => checkedId(c.emailId),
    decode: idDecode((emailId) => ({ kind: "answered_no", emailId })),
  },
  // reply: `rv` (the first open reply draft) or `rv:<send>` (the next one after it)
  reply_review: {
    family: "reply",
    prefix: "rv",
    encode: (c) => (c.afterId === undefined ? undefined : checkedId(c.afterId)),
    decode: (rest) => {
      if (rest === undefined) return { kind: "reply_review" };
      return UUID_REST.test(rest) ? { kind: "reply_review", afterId: rest } : null;
    },
  },
  reply_skip: {
    family: "reply",
    prefix: "rk",
    encode: (c) => checkedId(c.sendId),
    decode: idDecode((sendId) => ({ kind: "reply_skip", sendId })),
  },
  // Redraft, Reply all and Use Reply-To name a send; Draft reply names a mail.
  reply_redraft: {
    family: "reply",
    prefix: "rd",
    encode: (c) => checkedId(c.sendId),
    decode: idDecode((sendId) => ({ kind: "reply_redraft", sendId })),
  },
  reply_all: {
    family: "reply",
    prefix: "ra",
    encode: (c) => checkedId(c.sendId),
    decode: idDecode((sendId) => ({ kind: "reply_all", sendId })),
  },
  reply_use_reply_to: {
    family: "reply",
    prefix: "ru",
    encode: (c) => checkedId(c.sendId),
    decode: idDecode((sendId) => ({ kind: "reply_use_reply_to", sendId })),
  },
  reply_draft: {
    family: "reply",
    prefix: "dr",
    encode: (c) => checkedId(c.emailId),
    decode: idDecode((emailId) => ({ kind: "reply_draft", emailId })),
  },
  // loop
  loop_follow_up: {
    family: "loop",
    prefix: "lf",
    encode: (c) => checkedId(c.loopId),
    decode: idDecode((loopId) => ({ kind: "loop_follow_up", loopId })),
  },
  loop_later: {
    family: "loop",
    prefix: "ll",
    encode: (c) => checkedId(c.loopId),
    decode: idDecode((loopId) => ({ kind: "loop_later", loopId })),
  },
  loop_done: {
    family: "loop",
    prefix: "lc",
    encode: (c) => checkedId(c.loopId),
    decode: idDecode((loopId) => ({ kind: "loop_done", loopId })),
  },
  loop_drop: {
    family: "loop",
    prefix: "lx",
    encode: (c) => checkedId(c.loopId),
    decode: idDecode((loopId) => ({ kind: "loop_drop", loopId })),
  },
  loop_reopen: {
    family: "loop",
    prefix: "lr",
    encode: (c) => checkedId(c.loopId),
    decode: idDecode((loopId) => ({ kind: "loop_reopen", loopId })),
  },
  // delegate
  delegate_open: {
    family: "delegate",
    prefix: "dg",
    encode: (c) => checkedId(c.emailId),
    decode: idDecode((emailId) => ({ kind: "delegate_open", emailId })),
  },
  delegate_pick: {
    family: "delegate",
    prefix: "dp",
    encode: (c) => `${uuidToBase64Url(checkedId(c.emailId))}:${uuidToBase64Url(checkedId(c.delegateId))}`,
    decode: (rest) => {
      const match = rest === undefined ? null : DELEGATE_PICK_REST.exec(rest);
      if (match === null) return null;
      const emailId = base64UrlToUuid(match[1] as string);
      const delegateId = base64UrlToUuid(match[2] as string);
      return emailId === null || delegateId === null ? null : { kind: "delegate_pick", emailId, delegateId };
    },
  },
  // approval
  approve: {
    family: "approval",
    prefix: "ap",
    encode: (c) => checkedId(c.actionId),
    decode: idDecode((actionId) => ({ kind: "approve", actionId })),
  },
  reject: {
    family: "approval",
    prefix: "ar",
    encode: (c) => checkedId(c.actionId),
    decode: idDecode((actionId) => ({ kind: "reject", actionId })),
  },
  approve_set: {
    family: "approval",
    prefix: "as",
    encode: (c) => checkedId(c.setId),
    decode: idDecode((setId) => ({ kind: "approve_set", setId })),
  },
  reject_set: {
    family: "approval",
    prefix: "rs",
    encode: (c) => checkedId(c.setId),
    decode: idDecode((setId) => ({ kind: "reject_set", setId })),
  },
  send_again: {
    family: "approval",
    prefix: "ag",
    encode: (c) => checkedId(c.actionId),
    decode: idDecode((actionId) => ({ kind: "send_again", actionId })),
  },
  went_out: {
    family: "approval",
    prefix: "gw",
    encode: (c) => checkedId(c.actionId),
    decode: idDecode((actionId) => ({ kind: "went_out", actionId })),
  },
  delegation_done: {
    family: "approval",
    prefix: "dd",
    encode: (c) => checkedId(c.delegationId),
    decode: idDecode((delegationId) => ({ kind: "delegation_done", delegationId })),
  },
  reject_reason: {
    family: "approval",
    prefix: "rw",
    encode: (c) => `${REASON_CODES[c.reason]}:${checkedId(c.actionId)}`,
    decode: codedDecode(CODE_TO_REASON, (reason, actionId) => ({ kind: "reject_reason", reason, actionId })),
  },
  // After a send: "this was a mistake".
  mistake: {
    family: "approval",
    prefix: "mk",
    encode: (c) => checkedId(c.actionId),
    decode: idDecode((actionId) => ({ kind: "mistake", actionId })),
  },
} satisfies { [K in CallbackKind]: KindEntry<K> };

// The union of the kinds whose entry names the family `F`.
export type CallbackOfFamily<F extends CallbackFamily> = CallbackOfKind<
  {
    [K in CallbackKind]: (typeof callbackKinds)[K]["family"] extends F ? K : never;
  }[CallbackKind]
>;

// `callbackKinds[kind]` is a union of entries with different parameter types, so a call through it needs this one widening.
function entryOf(kind: CallbackKind): KindEntry<CallbackKind> {
  return callbackKinds[kind] as KindEntry<CallbackKind>;
}

export function callbackFamilyOf(callback: Callback): CallbackFamily {
  return callbackKinds[callback.kind].family;
}

export function isCallbackOfFamily<F extends CallbackFamily>(
  callback: Callback,
  family: F
): callback is CallbackOfFamily<F> {
  return callbackFamilyOf(callback) === family;
}

// The entry of each prefix. A Map, so that data such as `__proto__` or `constructor` finds nothing.
const KIND_BY_PREFIX: ReadonlyMap<string, KindEntry<CallbackKind>> = new Map(
  Object.values(callbackKinds).map((entry) => [entry.prefix, entry as KindEntry<CallbackKind>])
);

// Button data is at most 64 bytes (Telegram); the longest value here is `dp:` with 48.
export function encodeCallback(callback: Callback): string {
  const entry = entryOf(callback.kind);
  const rest = entry.encode(callback);
  return rest === undefined ? entry.prefix : `${entry.prefix}:${rest}`;
}

// Old or forged data gives null.
export function parseCallback(data: string): Callback | null {
  const colon = data.indexOf(":");
  const prefix = colon === -1 ? data : data.slice(0, colon);
  const rest = colon === -1 ? undefined : data.slice(colon + 1);
  return KIND_BY_PREFIX.get(prefix)?.decode(rest) ?? null;
}
