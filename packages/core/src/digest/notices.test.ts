import { describe, expect, test } from "bun:test";

import { MESSAGE_MAX_CHARS } from "./message";
import {
  feedbackButtons,
  renderActionFailedNotice,
  renderAuthErrorNotice,
  renderSyncOkNotice,
  renderSyncStaleNotice,
  renderUrgentNotice,
} from "./notices";

const ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const timeZone = "Europe/Warsaw";
const now = new Date("2026-11-06T07:00:00Z");
const urgent = {
  emailId: ID,
  from: "Ann <ann@firma.test>",
  subject: "Server down",
  aiText: "The server is down.",
  receivedAt: new Date("2026-11-06T06:42:00Z"),
  synthetic: false,
  wouldDo: "would flag",
  now,
  timeZone,
};

describe("renderUrgentNotice", () => {
  test("has the lines in order, with buttons", () => {
    const message = renderUrgentNotice(urgent);
    expect(message.text.split("\n")).toEqual([
      "🔴 Urgent mail",
      "From: Ann <ann@firma.test>",
      "Subject: Server down",
      "💬 The server is down.",
      "Received 07:42",
      "→ would flag",
    ]);
    expect(message.buttons).toEqual([
      [
        { text: "✅ Right", data: `fr:u:${ID}` },
        { text: "✏️ Change", data: `fe:${ID}` },
      ],
    ]);
  });

  test("leaves out the AI line when there is no AI text", () => {
    expect(renderUrgentNotice({ ...urgent, aiText: null }).text).not.toContain("💬");
  });

  test("marks a test mail", () => {
    const first = renderUrgentNotice({ ...urgent, synthetic: true }).text.split("\n")[0];
    expect(first?.endsWith("· 🧪 test")).toBe(true);
  });

  test("stays short for very long mail fields", () => {
    const long = "x".repeat(10_000);
    const message = renderUrgentNotice({ ...urgent, from: long, subject: long, aiText: long });
    expect(message.text.length).toBeLessThanOrEqual(MESSAGE_MAX_CHARS);
    const subject = message.text.split("\n")[2]?.slice("Subject: ".length) ?? "";
    expect(Array.from(subject).length).toBeLessThanOrEqual(80);
  });
});

describe("feedbackButtons", () => {
  test("gives only the edit button for unsure", () => {
    expect(feedbackButtons(ID, "unsure", { right: "R", edit: "E" })).toEqual([{ text: "E", data: `fe:${ID}` }]);
  });
});

describe("other notices", () => {
  test("auth_error", () => {
    const message = renderAuthErrorNotice({
      address: "me@firma.test",
      mailboxId: "mb-1",
      since: new Date("2026-11-06T06:40:00Z"),
      now,
      timeZone,
    });
    expect(message.text).toContain("me@firma.test");
    expect(message.text).toContain("mb-1");
    expect(message.text).toContain("at 07:40");
    expect(message.buttons).toEqual([]);
  });

  test("sync late, never synced", () => {
    const message = renderSyncStaleNotice({ address: "me@firma.test", lastSyncedAt: null, now, timeZone });
    expect(message.text).toContain("Last good sync: never.");
    expect(message.buttons).toEqual([]);
  });

  test("sync works again", () => {
    const message = renderSyncOkNotice({
      address: "me@firma.test",
      lastSyncedAt: new Date("2026-11-06T06:55:00Z"),
      now,
      timeZone,
    });
    expect(message.text).toContain("Last sync 07:55");
  });
});

describe("renderActionFailedNotice", () => {
  const base = {
    actionType: "move" as const,
    reverse: false,
    reason: "other" as const,
    folderName: "AI/Info",
    from: "Ann <ann@firma.test>",
    subject: "Offer, see https://evil.test/x",
    synthetic: false,
    attempts: 3,
  };
  const lines = (input: Parameters<typeof renderActionFailedNotice>[0]) =>
    renderActionFailedNotice(input).text.split("\n");

  test("original move names the folder and cleans the subject", () => {
    expect(lines(base)).toEqual([
      "⚠️ Could not move a mail to AI/Info",
      "From: Ann <ann@firma.test>",
      "Subject: Offer, see [link]",
      "Tried 3 times. The mail stays in INBOX. /status shows the mailbox state.",
    ]);
    expect(renderActionFailedNotice(base).buttons).toEqual([]);
  });

  test("the six shapes carry the verb, the subject and the tries", () => {
    const cases = [
      { actionType: "move", reverse: false, verb: "Could not move a mail to AI/Info" },
      { actionType: "flag", reverse: false, verb: "Could not flag a mail" },
      { actionType: "mark_read", reverse: false, verb: "Could not mark a mail read" },
      { actionType: "move", reverse: true, verb: "Undo failed: could not move a mail back to INBOX" },
      { actionType: "flag", reverse: true, verb: "Undo failed: could not remove the flag" },
      { actionType: "mark_read", reverse: true, verb: "Undo failed: could not mark a mail unread" },
    ] as const;
    for (const { verb, ...shape } of cases) {
      const out = lines({ ...base, ...shape });
      expect(out[0]).toBe(`⚠️ ${verb}`);
      expect(out[2]).toBe("Subject: Offer, see [link]");
      expect(out[3]).toContain("Tried 3 times");
    }
    expect(lines({ ...base, reverse: true })[3]).toContain("The mail stays in AI/Info: move it by hand.");
  });

  test("a reverse create_draft says that the draft stays in Drafts", () => {
    const out = lines({ ...base, actionType: "create_draft", reverse: true, folderName: null });
    expect(out).toEqual([
      "⚠️ Could not remove the draft for a mail",
      "From: Ann <ann@firma.test>",
      "Subject: Offer, see [link]",
      "Tried 3 times. The draft stays in Drafts: delete it by hand. /status shows the mailbox state.",
    ]);
  });

  test("a reverse mail_not_found has the not-found line and no Tried line", () => {
    const out = lines({ ...base, reverse: true, reason: "mail_not_found" });
    expect(out[3]).toBe("The mail was not found: it was moved or deleted in the mail client.");
    expect(out.join("\n")).not.toContain("Tried");
  });

  test("bad_payload has no folder and no Tried line", () => {
    const out = lines({ ...base, reason: "bad_payload", folderName: null, attempts: 0 });
    expect(out[0]).toBe("⚠️ Could not move a mail");
    expect(out[3]).toBe("The plan had an unknown folder. The mail stays in INBOX.");
    expect(out.join("\n")).not.toContain("Tried");
  });

  test("a null folder name ends the first line after 'a mail'", () => {
    expect(lines({ ...base, folderName: null })[0]).toBe("⚠️ Could not move a mail");
  });

  test("marks a test mail after the first line only", () => {
    expect(lines({ ...base, synthetic: true })[1]).toBe("🧪 test");
    expect(renderActionFailedNotice(base).text).not.toContain("🧪");
  });
});
