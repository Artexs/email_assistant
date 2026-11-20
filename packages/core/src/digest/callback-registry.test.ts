import { describe, expect, test } from "bun:test";

import {
  type AnsweredCallback,
  type ApprovalCallback,
  type Callback,
  type DelegateCallback,
  encodeCallback,
  type FeedbackCallback,
  type LoopCallback,
  parseCallback,
  type ReplyCallback,
} from "./callback";
import { type CallbackFamily, callbackFamilyOf, callbackKinds, type CallbackOfFamily } from "./callback-kinds";
import { CALLBACK_MAX_BYTES } from "./message";

const ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const ID2 = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";
interface Row<K extends Callback["kind"]> {
  value: Extract<Callback, { kind: K }>;
  data: string;
  family: CallbackFamily;
}

// A new kind without a row fails the typecheck. Each `data` is the string of the code before the registry.
const golden: { [K in Callback["kind"]]: Row<K> } = {
  right: { value: { kind: "right", category: "urgent", emailId: ID }, data: `fr:u:${ID}`, family: "feedback" },
  edit: { value: { kind: "edit", emailId: ID }, data: `fe:${ID}`, family: "feedback" },
  undo: { value: { kind: "undo", emailId: ID }, data: `fu:${ID}`, family: "feedback" },
  pick: { value: { kind: "pick", category: "spam", emailId: ID }, data: `fc:s:${ID}`, family: "feedback" },
  cancel: { value: { kind: "cancel", emailId: ID }, data: `fx:${ID}`, family: "feedback" },
  review_right: {
    value: { kind: "review_right", category: "delegation", emailId: ID },
    data: `vr:d:${ID}`,
    family: "feedback",
  },
  review_pick: {
    value: { kind: "review_pick", category: "needs_reply", emailId: ID },
    data: `vc:r:${ID}`,
    family: "feedback",
  },
  review_edit: { value: { kind: "review_edit", emailId: ID }, data: `ve:${ID}`, family: "feedback" },
  review_cancel: { value: { kind: "review_cancel", emailId: ID }, data: `vx:${ID}`, family: "feedback" },
  answered_yes: { value: { kind: "answered_yes", emailId: ID }, data: `ay:${ID}`, family: "answered" },
  answered_no: { value: { kind: "answered_no", emailId: ID }, data: `an:${ID}`, family: "answered" },
  reply_review: { value: { kind: "reply_review" }, data: "rv", family: "reply" },
  reply_skip: { value: { kind: "reply_skip", sendId: ID }, data: `rk:${ID}`, family: "reply" },
  reply_redraft: { value: { kind: "reply_redraft", sendId: ID }, data: `rd:${ID}`, family: "reply" },
  reply_all: { value: { kind: "reply_all", sendId: ID }, data: `ra:${ID}`, family: "reply" },
  reply_use_reply_to: { value: { kind: "reply_use_reply_to", sendId: ID }, data: `ru:${ID}`, family: "reply" },
  reply_draft: { value: { kind: "reply_draft", emailId: ID }, data: `dr:${ID}`, family: "reply" },
  loop_follow_up: { value: { kind: "loop_follow_up", loopId: ID }, data: `lf:${ID}`, family: "loop" },
  loop_later: { value: { kind: "loop_later", loopId: ID }, data: `ll:${ID}`, family: "loop" },
  loop_done: { value: { kind: "loop_done", loopId: ID }, data: `lc:${ID}`, family: "loop" },
  loop_drop: { value: { kind: "loop_drop", loopId: ID }, data: `lx:${ID}`, family: "loop" },
  loop_reopen: { value: { kind: "loop_reopen", loopId: ID }, data: `lr:${ID}`, family: "loop" },
  delegate_open: { value: { kind: "delegate_open", emailId: ID }, data: `dg:${ID}`, family: "delegate" },
  delegate_pick: {
    value: { kind: "delegate_pick", emailId: ID, delegateId: ID2 },
    data: "dp:AZChssPUfl-KmwwdLj9KWw:AZChssPUfl-KmwwdLj9KXA",
    family: "delegate",
  },
  approve: { value: { kind: "approve", actionId: ID }, data: `ap:${ID}`, family: "approval" },
  reject: { value: { kind: "reject", actionId: ID }, data: `ar:${ID}`, family: "approval" },
  approve_set: { value: { kind: "approve_set", setId: ID }, data: `as:${ID}`, family: "approval" },
  reject_set: { value: { kind: "reject_set", setId: ID }, data: `rs:${ID}`, family: "approval" },
  send_again: { value: { kind: "send_again", actionId: ID }, data: `ag:${ID}`, family: "approval" },
  went_out: { value: { kind: "went_out", actionId: ID }, data: `gw:${ID}`, family: "approval" },
  delegation_done: { value: { kind: "delegation_done", delegationId: ID }, data: `dd:${ID}`, family: "approval" },
  reject_reason: {
    value: { kind: "reject_reason", reason: "not_needed", actionId: ID },
    data: `rw:n:${ID}`,
    family: "approval",
  },
  mistake: { value: { kind: "mistake", actionId: ID }, data: `mk:${ID}`, family: "approval" },
};

const rows = Object.values(golden) as Row<Callback["kind"]>[];

describe("callback registry", () => {
  test("the golden table has the 33 kinds", () => {
    expect(rows).toHaveLength(33);
    expect(Object.keys(callbackKinds)).toHaveLength(33);
  });

  test.each(rows)("$value.kind encodes to its data and parses back", ({ value, data }) => {
    expect(encodeCallback(value)).toBe(data);
    expect(parseCallback(data)).toEqual(value);
  });

  test("reply_review with an after id has its own data", () => {
    expect(encodeCallback({ kind: "reply_review", afterId: ID })).toBe(`rv:${ID}`);
    expect(parseCallback(`rv:${ID}`)).toEqual({ kind: "reply_review", afterId: ID });
  });

  test("the prefixes are two lowercase letters and distinct", () => {
    const prefixes = Object.values(callbackKinds).map((entry) => entry.prefix);
    expect(prefixes).toHaveLength(33);
    expect(new Set(prefixes).size).toBe(33);
    for (const prefix of prefixes) expect(prefix).toMatch(/^[a-z]{2}$/);
  });

  test.each(rows)("the data of $value.kind fits a Telegram button", ({ data }) => {
    expect(Buffer.byteLength(data)).toBeLessThanOrEqual(CALLBACK_MAX_BYTES);
  });

  test.each([
    ["empty", ""],
    ["a bare prefix", "ap"],
    ["a prefix with no id", "ap:"],
    ["a trailing part", `ap:${ID}:x`],
    ["a trailing newline", `ap:${ID}\n`],
    ["a leading space", ` ap:${ID}`],
    ["an upper case prefix", `AP:${ID}`],
    ["an upper case id", `ap:${ID.toUpperCase()}`],
    ["an unknown prefix", `zz:${ID}`],
    ["the prefix __proto__", `__proto__:${ID}`],
    ["the prefix constructor", `constructor:${ID}`],
    ["the data toString", "toString"],
    ["the data hasOwnProperty", "hasOwnProperty"],
    ["the code d on a digest prefix", `fr:d:${ID}`],
    ["an unknown reason code", `rw:x:${ID}`],
    ["the category code constructor", `fr:constructor:${ID}`],
    ["the category code __proto__", `vr:__proto__:${ID}`],
    ["the reason code toString", `rw:toString:${ID}`],
    ["rv with an empty id", "rv:"],
    ["an id with a trailing letter", `dg:${ID}x`],
    ["dp with a 21 character second part", `dp:${"A".repeat(22)}:${"A".repeat(21)}`],
  ])("forged data gives null: %s", (_name, data) => {
    expect(parseCallback(data)).toBeNull();
  });

  test("the review prefix takes the code d", () => {
    expect(parseCallback(`vr:d:${ID}`)).toEqual({ kind: "review_right", category: "delegation", emailId: ID });
  });

  test.each(rows)("$value.kind belongs to the family $family", ({ value, family }) => {
    expect(callbackFamilyOf(value)).toBe(family);
  });

  test("the families have 9, 2, 6, 5, 2 and 9 kinds", () => {
    const count = (family: CallbackFamily) => rows.filter((row) => row.family === family).length;
    expect(
      ["feedback", "answered", "reply", "loop", "delegate", "approval"].map((f) => count(f as CallbackFamily))
    ).toEqual([9, 2, 6, 5, 2, 9]);
  });
});

// Compile-time check: the family type of the registry is the named union, both ways. A wrong member fails `bun run typecheck`.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const sameTypes: [
  Same<CallbackOfFamily<"feedback">, FeedbackCallback>,
  Same<CallbackOfFamily<"answered">, AnsweredCallback>,
  Same<CallbackOfFamily<"reply">, ReplyCallback>,
  Same<CallbackOfFamily<"loop">, LoopCallback>,
  Same<CallbackOfFamily<"delegate">, DelegateCallback>,
  Same<CallbackOfFamily<"approval">, ApprovalCallback>,
] = [true, true, true, true, true, true];

describe("callback family types", () => {
  test("each family type of the registry equals its named union", () => {
    expect(sameTypes).toEqual([true, true, true, true, true, true]);
  });
});
