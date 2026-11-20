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

  test("an auth_error view with oauth encodes; an old view without it still parses; a bad reason throws", () => {
    const view = { address: "box@example.test", mailboxId, since: now, now, timeZone };
    const oauth = { provider: "microsoft", reason: "oauth_expired" };
    expect(encodeNoticeView("auth_error", { ...view, oauth } as never).oauth).toEqual(oauth);
    expect(
      encodeNoticeView("auth_error", { ...view, oauth: { provider: "google", reason: null } } as never)
    ).toBeDefined();
    expect(encodeNoticeView("auth_error", view as never).oauth).toBeUndefined();
    expect(() =>
      encodeNoticeView("auth_error", { ...view, oauth: { provider: "google", reason: "x" } } as never)
    ).toThrow(NoticeViewError);
    expect(() =>
      encodeNoticeView("auth_error", { ...view, oauth: { provider: "yahoo", reason: null } } as never)
    ).toThrow(NoticeViewError);
  });

  describe("an approval view", () => {
    const approval = (view: Record<string, unknown>) => ({
      actionId: emailId,
      view: {
        kind: "delegation",
        recipient: { name: null, address: "anna@example.test" },
        sender: null,
        recipientInactive: false,
        subject: "S",
        dueDate: null,
        body: "B",
        quote: null,
        synthetic: false,
        ...view,
      },
      now,
      timeZone,
    });

    test("T5 a view without version and panelUrl encodes (rows of the last 24 h)", () => {
      expect(encodeNoticeView("approval", approval({}) as never)).toEqual({
        actionId: emailId,
        view: {
          kind: "delegation",
          recipient: { name: null, address: "anna@example.test" },
          sender: null,
          recipientInactive: false,
          subject: "S",
          dueDate: null,
          body: "B",
          quote: null,
          synthetic: false,
        },
        now: "2026-11-13T10:07:33.123Z",
        timeZone,
      });
    });

    test("T5 version and an https or http panelUrl encode", () => {
      const url = "https://ea.example.ts.net/approvals?id=7f1c0d1e-0000-4000-8000-000000000001";
      expect(encodeNoticeView("approval", approval({ version: 2, panelUrl: url }) as never)).toMatchObject({
        view: { version: 2, panelUrl: url },
      });
      const local = "http://localhost:8081/approvals";
      expect(encodeNoticeView("approval", approval({ panelUrl: local }) as never)).toMatchObject({
        view: { panelUrl: local },
      });
    });

    test.each([
      "javascript:alert(1)",
      "ftp://example.test/x",
      "https://a b",
      `https://${"a".repeat(300)}`,
      "",
      "https://a\nb",
      "https://a.test/x\r\nhttps://b.test",
    ])("T5 panelUrl %p fails the view schema", (panelUrl) => {
      expect(() => encodeNoticeView("approval", approval({ panelUrl }) as never)).toThrow(NoticeViewError);
    });

    test("T5 a version below 1 or not whole fails", () => {
      expect(() => encodeNoticeView("approval", approval({ version: 0 }) as never)).toThrow(NoticeViewError);
      expect(() => encodeNoticeView("approval", approval({ version: 1.5 }) as never)).toThrow(NoticeViewError);
    });
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
