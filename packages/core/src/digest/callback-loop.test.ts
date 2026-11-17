import { describe, expect, test } from "bun:test";

import { rejectReasons } from "../metrics/m3";

import {
  type Callback,
  encodeCallback,
  isDelegateCallback,
  isFeedbackCallback,
  isLoopCallback,
  labelCategories,
  parseCallback,
  reviewLabelCategories,
} from "./callback";
import { CALLBACK_MAX_BYTES } from "./message";

const ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const EMAIL = "0e0b7a52-6c1f-4d0e-9a31-5f2c8d1e7b40";
const DELEGATE = "f3a1c9d2-1111-4abc-8def-000000000001";

const loopKinds = ["loop_follow_up", "loop_later", "loop_done", "loop_drop", "loop_reopen"] as const;
const loopPrefixes = ["lf", "ll", "lc", "lx", "lr"];

// One callback of every kind (every code of a kind with a code). The prefix is the data up to the first colon.
const everyKind: Callback[] = [
  ...labelCategories.flatMap((category): Callback[] => [
    { kind: "right", category, emailId: ID },
    { kind: "pick", category, emailId: ID },
  ]),
  ...reviewLabelCategories.flatMap((category): Callback[] => [
    { kind: "review_right", category, emailId: ID },
    { kind: "review_pick", category, emailId: ID },
  ]),
  { kind: "edit", emailId: ID },
  { kind: "cancel", emailId: ID },
  { kind: "undo", emailId: ID },
  { kind: "review_edit", emailId: ID },
  { kind: "review_cancel", emailId: ID },
  { kind: "answered_yes", emailId: ID },
  { kind: "answered_no", emailId: ID },
  { kind: "approve", actionId: ID },
  { kind: "reject", actionId: ID },
  { kind: "approve_set", setId: ID },
  { kind: "reject_set", setId: ID },
  { kind: "send_again", actionId: ID },
  { kind: "went_out", actionId: ID },
  { kind: "delegation_done", delegationId: ID },
  { kind: "mistake", actionId: ID },
  ...rejectReasons.map((reason): Callback => ({ kind: "reject_reason", reason, actionId: ID })),
  ...loopKinds.map((kind): Callback => ({ kind, loopId: ID })),
  { kind: "delegate_open", emailId: ID },
  { kind: "delegate_pick", emailId: EMAIL, delegateId: DELEGATE },
];

describe("callback prefixes", () => {
  test("every prefix names one kind, and every value is at most 64 bytes", () => {
    const kindsOf = new Map<string, Set<string>>();
    for (const callback of everyKind) {
      const data = encodeCallback(callback);
      expect(Buffer.byteLength(data)).toBeLessThanOrEqual(CALLBACK_MAX_BYTES);
      expect(parseCallback(data)).toEqual(callback);
      const prefix = data.slice(0, data.indexOf(":"));
      kindsOf.set(prefix, (kindsOf.get(prefix) ?? new Set()).add(callback.kind));
    }
    for (const [prefix, kinds] of kindsOf) expect([prefix, kinds.size]).toEqual([prefix, 1]);
    // The five loop prefixes and the two delegate prefixes are new and differ from every old one.
    for (const prefix of [...loopPrefixes, "dg", "dp"]) expect(kindsOf.has(prefix)).toBe(true);
    expect(new Set(loopPrefixes).size).toBe(5);
  });
});

describe("loop callback data", () => {
  test.each(loopKinds.map((kind, index) => [kind, loopPrefixes[index]] as const))("%s uses %s", (kind, prefix) => {
    const callback: Callback = { kind, loopId: ID };
    expect(encodeCallback(callback)).toBe(`${prefix}:${ID}`);
    expect(parseCallback(`${prefix}:${ID}`)).toEqual(callback);
    expect(isLoopCallback(callback)).toBe(true);
    expect(isFeedbackCallback(callback)).toBe(false);
  });

  test.each([`lf:${ID.toUpperCase()}`, `lf:${ID}:x`, "lc:not-a-uuid", `lz:${ID}`, `ll:${ID.slice(1)}`])(
    "rejects %p",
    (data) => {
      expect(parseCallback(data)).toBeNull();
    }
  );

  test("encode refuses a bad id", () => {
    expect(() => encodeCallback({ kind: "loop_done", loopId: "x" })).toThrow("bad id");
  });
});

describe("delegate callback data", () => {
  test("dg: names the mail and is no feedback tap", () => {
    const callback: Callback = { kind: "delegate_open", emailId: ID };
    expect(encodeCallback(callback)).toBe(`dg:${ID}`);
    expect(parseCallback(`dg:${ID}`)).toEqual(callback);
    expect(isDelegateCallback(callback)).toBe(true);
    expect(isFeedbackCallback(callback)).toBe(false);
  });

  test("dp: holds two UUIDs as 22 characters each, 48 bytes, and parses back to the same ids", () => {
    const callback: Callback = { kind: "delegate_pick", emailId: EMAIL, delegateId: DELEGATE };
    const data = encodeCallback(callback);
    expect(Buffer.byteLength(data)).toBe(48);
    expect(data).toMatch(/^dp:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]{22}$/);
    expect(parseCallback(data)).toEqual(callback);
    expect(isFeedbackCallback(callback)).toBe(false);
  });

  test("dp: with a part of another length is null", () => {
    const [, mail, delegate] = encodeCallback({ kind: "delegate_pick", emailId: EMAIL, delegateId: DELEGATE }).split(
      ":"
    );
    expect(parseCallback(`dp:${(mail as string).slice(1)}:${delegate}`)).toBeNull();
    expect(parseCallback(`dp:${mail}:${(delegate as string).slice(1)}`)).toBeNull();
    expect(parseCallback(`dp:${mail}a:${delegate}`)).toBeNull();
    expect(parseCallback(`dp:${mail}:${delegate}:x`)).toBeNull();
    // 20 characters are valid base64 once padded, but they hold 15 bytes, not a UUID.
    expect(parseCallback(`dp:${(mail as string).slice(2)}:${delegate}`)).toBeNull();
    expect(parseCallback(`dp:${mail}:${(delegate as string).slice(2)}`)).toBeNull();
    expect(parseCallback(`dp:${mail}`)).toBeNull();
  });

  test("dp: refuses a value that is not the one form of its 16 bytes", () => {
    const [, mail, delegate] = encodeCallback({ kind: "delegate_pick", emailId: EMAIL, delegateId: DELEGATE }).split(
      ":"
    );
    // The last character of 22 holds 4 unused bits: a different last character with the same bytes is another spelling.
    const last = (mail as string).slice(-1);
    const other = last === "A" ? "B" : "A";
    expect(parseCallback(`dp:${(mail as string).slice(0, -1)}${other}:${delegate}`)).toBeNull();
  });
});
