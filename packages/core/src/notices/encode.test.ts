import { describe, expect, test } from "bun:test";

import { describeActions, type WouldDoAction } from "../digest/would-do";
import { textTables } from "../texts";

import { encodeNoticeView, NoticeViewError } from "./encode";

const emailId = "11111111-1111-4111-8111-111111111111";
const mailboxId = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-11-13T10:07:33.123Z");
const timeZone = "Europe/Warsaw";

function urgent(overrides: Record<string, unknown> = {}) {
  return {
    emailId,
    from: "boss@example.test",
    subject: "Subject" as string | null,
    ai: { reasonCode: "vip", reason: null },
    receivedAt: now,
    synthetic: false,
    folderTag: null,
    actions: [],
    delegateNames: {},
    stayFolder: "INBOX",
    now,
    timeZone,
    ...overrides,
  };
}

describe("encodeNoticeView", () => {
  test("writes dates as ISO strings", () => {
    const json = encodeNoticeView("sync_ok", {
      address: "box@example.test",
      lastSyncedAt: new Date("2026-11-13T09:00:00.000Z"),
      now,
      timeZone,
    });
    expect(json.lastSyncedAt).toBe("2026-11-13T09:00:00.000Z");
  });

  test("replaces a lone surrogate and a NUL in a string", () => {
    expect(encodeNoticeView("urgent", urgent({ subject: "A\ud800B" })).subject).toBe("A�B");
    expect(encodeNoticeView("urgent", urgent({ subject: "A\u0000B" })).subject).toBe("A B");
  });

  test("an extra key throws an error that holds the kind only", () => {
    let caught: unknown;
    try {
      encodeNoticeView("urgent", urgent({ body: "x" }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NoticeViewError);
    expect((caught as NoticeViewError).message).toBe("bad notice view for urgent");
    expect((caught as NoticeViewError).message).not.toContain("x");
  });

  test("a missing field throws", () => {
    const view = { address: "box@example.test", since: now, now, timeZone };
    expect(() => encodeNoticeView("auth_error", view as never)).toThrow(NoticeViewError);
    expect(() => encodeNoticeView("auth_error", { ...view, mailboxId } as never)).not.toThrow();
  });

  test("a view without facts encodes to an empty object", () => {
    expect(encodeNoticeView("mailbox_removed", {})).toEqual({});
  });
});

describe("describeActions", () => {
  test("takes actions without an id", () => {
    const actions: WouldDoAction[] = [
      { type: "flag", status: "logged", folder: null, reverse: false, kind: null, delegateId: null },
    ];
    expect(describeActions(actions, new Map(), {}, textTables.en)).toBe("would flag");
  });
});
