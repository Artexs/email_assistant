import { describe, expect, test } from "bun:test";

import { MESSAGE_MAX_CHARS } from "./message";
import {
  feedbackButtons,
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
