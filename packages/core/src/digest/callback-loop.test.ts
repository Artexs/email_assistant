import { describe, expect, test } from "bun:test";

import { rejectReasons } from "../metrics/m3";

import { type Callback, encodeCallback, labelCategories, parseCallback, reviewLabelCategories } from "./callback";
import { isCallbackOfFamily } from "./callback-kinds";
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
  { kind: "reply_review", afterId: ID },
  { kind: "reply_skip", sendId: ID },
  { kind: "reply_redraft", sendId: ID },
  { kind: "reply_all", sendId: ID },
  { kind: "reply_use_reply_to", sendId: ID },
  { kind: "reply_draft", emailId: ID },
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
    expect(isCallbackOfFamily(callback, "loop")).toBe(true);
    expect(isCallbackOfFamily(callback, "feedback")).toBe(false);
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
    expect(isCallbackOfFamily(callback, "delegate")).toBe(true);
    expect(isCallbackOfFamily(callback, "feedback")).toBe(false);
  });

  test("dp: holds two UUIDs as 22 characters each, 48 bytes, and parses back to the same ids", () => {
    const callback: Callback = { kind: "delegate_pick", emailId: EMAIL, delegateId: DELEGATE };
    const data = encodeCallback(callback);
    expect(Buffer.byteLength(data)).toBe(48);
    expect(data).toMatch(/^dp:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]{22}$/);
    expect(parseCallback(data)).toEqual(callback);
    expect(isCallbackOfFamily(callback, "feedback")).toBe(false);
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

// The review of reply drafts.
describe("the reply review callbacks", () => {
  test("Redraft, Reply all, Use Reply-To and Draft reply use their own prefixes (rd, ra, ru, dr) and are no feedback taps", () => {
    const expected = {
      reply_redraft: "rd",
      reply_all: "ra",
      reply_use_reply_to: "ru",
      reply_draft: "dr",
    } as const;
    for (const [kind, prefix] of Object.entries(expected)) {
      const callback = everyKind.find((entry) => entry.kind === kind) as Callback;
      expect(encodeCallback(callback)).toBe(`${prefix}:${ID}`);
      expect(parseCallback(`${prefix}:${ID}`)).toEqual(callback);
      expect(isCallbackOfFamily(callback, "reply")).toBe(true);
      expect(isCallbackOfFamily(callback, "feedback")).toBe(false);
    }
    // A prefix of the reply kinds is used by no other kind.
    const others = everyKind.filter((callback) => !callback.kind.startsWith("reply_"));
    const prefixes = new Set(others.map((callback) => encodeCallback(callback).slice(0, 2)));
    for (const prefix of Object.values(expected)) expect(prefixes.has(prefix), prefix).toBe(false);
    for (const data of ["rd", `rd:`, `ra:${ID}x`, `ru:x`, `dr:${ID}:1`, `DR:${ID}`]) {
      expect(parseCallback(data), data).toBeNull();
    }
    expect(() => encodeCallback({ kind: "reply_draft", emailId: "x" })).toThrow("bad id");
  });

  test("`rv` starts the review, `rv:<send>` asks for the next one after a send; both parse back and are short", () => {
    expect(encodeCallback({ kind: "reply_review" })).toBe("rv");
    expect(parseCallback("rv")).toEqual({ kind: "reply_review" });
    expect(encodeCallback({ kind: "reply_review", afterId: ID })).toBe(`rv:${ID}`);
    expect(parseCallback(`rv:${ID}`)).toEqual({ kind: "reply_review", afterId: ID });
    expect(encodeCallback({ kind: "reply_skip", sendId: ID })).toBe(`rk:${ID}`);
  });

  test("forged or malformed data gives null; an id that is not a UUID is refused when encoding", () => {
    for (const data of ["rv:", "rv:x", `rv:${ID}x`, `rk:`, "rk", `rk:${ID}:1`, `RV:${ID}`, `rv ${ID}`]) {
      expect(parseCallback(data), data).toBeNull();
    }
    expect(() => encodeCallback({ kind: "reply_skip", sendId: "not-an-id" })).toThrow("bad id");
    expect(() => encodeCallback({ kind: "reply_review", afterId: "x" })).toThrow("bad id");
  });

  test("the two prefixes are new: no other kind uses rv or rk", () => {
    const others = everyKind.filter((callback) => !callback.kind.startsWith("reply_"));
    const prefixes = new Set(others.map((callback) => encodeCallback(callback).slice(0, 2)));
    expect(prefixes.has("rv")).toBe(false);
    expect(prefixes.has("rk")).toBe(false);
  });
});
