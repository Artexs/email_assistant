import { describe, expect, test } from "bun:test";

import type { ApprovalView } from "../outgoing/sender";
import type { DraftPayload } from "../triage/payloads";

import {
  APPROVAL_QUOTE_CHARS,
  approvalEdit,
  type ApprovalEditOutcome,
  renderApprovalRequest,
  renderApprovalSetRequest,
  renderDelegationAnswered,
  renderSendResult,
  type SendResultKind,
} from "./approvals";
import { parseCallback } from "./callback";
import { MESSAGE_MAX_CHARS } from "./message";

const ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const SET_ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";
const NOW = new Date("2026-11-07T10:00:00Z");
const TZ = "Europe/Warsaw";

// eslint-disable-next-line no-control-regex -- the point is to find them
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/;

function view(overrides: Partial<ApprovalView> = {}): ApprovalView {
  return {
    kind: "delegation",
    recipient: { name: "Anna Nowak", address: "anna@example.com" },
    sender: { label: "boss@client.test", external: true },
    recipientInactive: false,
    subject: "Fwd: Offer",
    dueDate: "2026-11-12",
    body: "Hi Anna,\n\nPlease check the offer.\n\nThanks",
    quote: { text: "> Hello\n> World", cut: false },
    synthetic: false,
    ...overrides,
  };
}

function request(v: ApprovalView) {
  return renderApprovalRequest({ actionId: ID, view: v, now: NOW, timeZone: TZ });
}

describe("renderApprovalRequest", () => {
  test("delegation with an external sender", () => {
    const message = request(view());
    const lines = message.text.split("\n");
    expect(lines[0]).toBe("📤 Send? Delegation to Anna Nowak anna@example.com");
    expect(lines[1]).toBe("From: boss@client.test · ⚠️ external sender");
    expect(lines[2]).toBe("Subject: Fwd: Offer");
    expect(lines[3]).toBe("Due: 2026-11-12");
    expect(lines[4]).toBe("");
    expect(lines[5]).toBe("Draft:");
    expect(message.text).toContain("Please check the offer.");
    expect(message.text).toContain("\n\nQuoted original:\n> Hello\n> World");
    expect(
      message.text.endsWith("The system sends it after your tap. Do not send the draft from your mail client.")
    ).toBe(true);
    expect(message.text.length).toBeLessThanOrEqual(MESSAGE_MAX_CHARS);
    expect(message.buttons).toHaveLength(1);
    const row = message.buttons[0] ?? [];
    expect(row.map((button) => button.text)).toEqual(["📤 Send", "✖️ Reject"]);
    expect(parseCallback(row[0]?.data ?? "")).toEqual({ kind: "approve", actionId: ID });
    expect(parseCallback(row[1]?.data ?? "")).toEqual({ kind: "reject", actionId: ID });
  });

  test("an internal sender has no warning; a missing name is left out; inactive is marked", () => {
    const plain = request(view({ sender: { label: "me@firm.test", external: false } }));
    expect(plain.text).toContain("From: me@firm.test\n");
    expect(plain.text).not.toContain("external sender");
    const noName = request(view({ recipient: { name: null, address: "anna@example.com" } }));
    expect(noName.text.split("\n")[0]).toBe("📤 Send? Delegation to anna@example.com");
    const inactive = request(view({ recipientInactive: true }));
    expect(inactive.text.split("\n")[0]).toBe("📤 Send? Delegation to Anna Nowak (inactive) anna@example.com");
  });

  test("a long quote is cut to the limit with the cut line", () => {
    const quote = Array.from({ length: 300 }, (_, i) => `> line ${i} xxxx`).join("\n");
    const message = request(view({ quote: { text: quote, cut: false } }));
    const shown = message.text.split("Quoted original:\n")[1]?.split("\n(quote cut")[0] ?? "";
    expect(shown.length).toBeLessThanOrEqual(APPROVAL_QUOTE_CHARS);
    expect(message.text).toContain("(quote cut; the draft has the full text)");
    expect(message.text.length).toBeLessThanOrEqual(MESSAGE_MAX_CHARS);
    const already = request(view({ quote: { text: "> short", cut: true } }));
    expect(already.text).toContain("(quote cut; the draft has the full text)");
  });

  test("links in the quote become [link]", () => {
    const quote = "> pay at https://evil.test/pay\n> or www.evil.test\n> or evil.test/pay now";
    const message = request(view({ quote: { text: quote, cut: false } }));
    expect(message.text.split("(links shown")[0]?.match(/\[link\]/g)).toHaveLength(3);
    expect(message.text).not.toContain("evil.test");
    expect(message.text).toContain("(links shown as [link]; the draft has them)");
    const clean = request(view());
    expect(clean.text).not.toContain("links shown as");
  });

  test("a huge draft body is cut and the text still fits", () => {
    const message = request(view({ body: "x".repeat(5000) }));
    expect(message.text.length).toBeLessThanOrEqual(MESSAGE_MAX_CHARS);
    expect(message.text).toContain("(draft text cut; the full text is in the draft)");
    expect(message.text).toContain("…");
    expect(message.text.endsWith("Do not send the draft from your mail client.")).toBe(true);
  });

  test("a big body makes the quote shorter, not the body", () => {
    const message = request(view({ body: "y".repeat(3000), quote: { text: "> z".repeat(1000), cut: false } }));
    expect(message.text.length).toBeLessThanOrEqual(MESSAGE_MAX_CHARS);
    expect(message.text).toContain("y".repeat(3000));
    expect(message.text).toContain("(quote cut; the draft has the full text)");
  });

  test("clarification and reminder", () => {
    const clarification = request(
      view({
        kind: "clarification",
        recipient: { name: null, address: "boss@client.test" },
        dueDate: null,
      })
    );
    expect(clarification.text.split("\n")[0]).toBe("📤 Send? Question to the sender boss@client.test");
    expect(clarification.text).not.toContain("Due:");
    const reminder = request(view({ kind: "reminder", sender: null, quote: null }));
    expect(reminder.text.split("\n")[0]).toBe("📤 Send? Reminder to Anna Nowak anna@example.com");
    expect(reminder.text).not.toContain("From:");
    expect(reminder.text).not.toContain("Quoted original");
  });

  test("synthetic mail is marked", () => {
    const message = request(view({ synthetic: true }));
    expect(message.text.split("\n")[0]).toBe("📤 Send? Delegation to Anna Nowak anna@example.com · 🧪 test");
  });

  test("a sender label with a link is cleaned; no control characters", () => {
    const message = request(view({ sender: { label: "Evil\u0000 www.evil.test‮", external: true } }));
    const from = message.text.split("\n")[1] ?? "";
    expect(from).toContain("[link]");
    expect(from).not.toContain("evil.test");
    expect(CONTROL.test(from)).toBe(false);
    expect(from).not.toContain("‮");
  });

  test("a long address and sender label are cut to 80", () => {
    const message = request(
      view({
        recipient: { name: null, address: `${"a".repeat(200)}@example.com` },
        sender: { label: "s".repeat(200), external: false },
      })
    );
    const lines = message.text.split("\n");
    expect(lines[0]?.length).toBeLessThanOrEqual("📤 Send? Delegation to ".length + 80);
    expect(lines[1]?.length).toBeLessThanOrEqual("From: ".length + 80);
  });
});

function item(n: number, overrides: Partial<Parameters<typeof renderApprovalSetRequest>[0]["items"][number]> = {}) {
  return {
    n,
    delegateName: `Anna ${n}`,
    address: `anna${n}@example.com`,
    subject: `Offer ${n}`,
    dueAt: new Date("2026-11-05T12:00:00Z"),
    reminder: 1 as const,
    task: `check offer ${n}`,
    ...overrides,
  };
}

describe("renderApprovalSetRequest", () => {
  test("two items, one without a due date", () => {
    const message = renderApprovalSetRequest({
      setId: SET_ID,
      items: [item(1), item(2, { dueAt: null, reminder: 2 })],
      timeZone: TZ,
    });
    const lines = message.text.split("\n");
    expect(lines[0]).toBe("📤 Send 2 reminders?");
    expect(message.text).toContain("1. Anna 1 anna1@example.com — Offer 1 (due Thu 5 Nov, reminder 1 of 2)");
    expect(message.text).toContain("   Task: check offer 1");
    expect(message.text).toContain("2. Anna 2 anna2@example.com — Offer 2 (reminder 2 of 2)");
    expect(message.text).toContain("   Task: check offer 2");
    expect(message.text).toContain("Each reminder is the fixed reminder template with this task; it quotes nothing.");
    expect(message.text.endsWith("The system sends them after your tap.")).toBe(true);
    const row = message.buttons[0] ?? [];
    expect(row.map((button) => button.text)).toEqual(["📤 Send all", "✖️ Skip all"]);
    expect(parseCallback(row[0]?.data ?? "")).toEqual({ kind: "approve_set", setId: SET_ID });
    expect(parseCallback(row[1]?.data ?? "")).toEqual({ kind: "reject_set", setId: SET_ID });
  });

  test("one item reads singular", () => {
    const message = renderApprovalSetRequest({ setId: SET_ID, items: [item(1)], timeZone: TZ });
    expect(message.text.split("\n")[0]).toBe("📤 Send 1 reminder?");
  });

  test("10 long items all stay listed within the limit", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      item(i + 1, {
        delegateName: `N${i + 1}${"n".repeat(100)}`,
        subject: `S${i + 1}${"s".repeat(200)}`,
        task: `T${i + 1}${"t".repeat(300)}`,
      })
    );
    const message = renderApprovalSetRequest({ setId: SET_ID, items, timeZone: TZ });
    expect(message.text.length).toBeLessThanOrEqual(MESSAGE_MAX_CHARS);
    for (let i = 1; i <= 10; i++) {
      expect(message.text).toContain(`${i}. N${i}`);
      expect(message.text).toContain(`anna${i}@example.com`);
      expect(message.text).toContain(`Task: T${i}`);
    }
  });

  test("11 items or none is a programming error", () => {
    const items = Array.from({ length: 11 }, (_, i) => item(i + 1));
    expect(() => renderApprovalSetRequest({ setId: SET_ID, items, timeZone: TZ })).toThrow(RangeError);
    expect(() => renderApprovalSetRequest({ setId: SET_ID, items: [], timeZone: TZ })).toThrow(RangeError);
  });
});

type SendKind = DraftPayload["kind"];
const sendKinds: SendKind[] = ["delegation", "clarification", "reminder"];
const closings: Record<SendKind, string> = {
  delegation: "The delegation was cancelled.",
  clarification: "",
  reminder: "The delegation stays open.",
};
const recipient = { name: "Anna Nowak", address: "anna@example.com" };

function result(sendKind: SendKind, kind: SendResultKind, synthetic = false) {
  return renderSendResult({ actionId: ID, sendKind, result: kind, recipient, subject: "Fwd: Offer", synthetic });
}

function joined(...parts: string[]): string {
  return parts.filter((part) => part !== "").join(" ");
}

describe("renderSendResult", () => {
  const to = "Anna Nowak anna@example.com";

  test.each(sendKinds)("sent (%s)", (sendKind) => {
    expect(result(sendKind, { kind: "sent", sentCopy: "appended", draftRemoved: true }).text).toBe(
      `✅ Sent to ${to} · Fwd: Offer`
    );
    expect(result(sendKind, { kind: "sent", sentCopy: "found", draftRemoved: true }).text).toBe(
      `✅ Sent to ${to} · Fwd: Offer`
    );
    expect(result(sendKind, { kind: "sent", sentCopy: "failed", draftRemoved: false }).text).toBe(
      `✅ Sent to ${to} · Fwd: Offer\nNo copy in Sent: the server refused the copy.\nThe draft stays in Drafts (no UIDPLUS on this server).`
    );
    expect(result(sendKind, { kind: "sent", sentCopy: "appended", draftRemoved: true }).buttons).toEqual([]);
  });

  test.each(sendKinds)("rejected_by_server (%s)", (sendKind) => {
    const message = result(sendKind, { kind: "rejected_by_server", stage: "rcpt_to", responseCode: 550 });
    expect(message.text).toBe(
      `❌ Not sent to ${to} · Fwd: Offer\n${joined("The mail server refused it (rcpt_to, code 550). The draft stays in Drafts.", closings[sendKind])}`
    );
    expect(message.buttons).toEqual([]);
    const noCode = result(sendKind, { kind: "rejected_by_server", stage: "mail_from", responseCode: null });
    expect(noCode.text).toContain("(mail_from)");
  });

  const causes: [Extract<SendResultKind, { kind: "failed" }>, string, boolean][] = [
    [{ kind: "failed", cause: "tries", code: "ETIMEDOUT", tries: 3 }, "The send failed 3 times (ETIMEDOUT)", true],
    [
      { kind: "failed", cause: "content_soft", code: "451", tries: 1 },
      "The mail server refused the content for now (code 451); the system never retries after the content",
      true,
    ],
    [{ kind: "failed", cause: "compose", code: null, tries: 3 }, "The mail could not be built 3 times", true],
    [
      { kind: "failed", cause: "bad_payload", code: null, tries: 0 },
      "The stored send data is not valid; nothing was sent",
      false,
    ],
  ];

  test.each(sendKinds)("failed (%s)", (sendKind) => {
    for (const [failed, line, again] of causes) {
      const message = result(sendKind, failed);
      expect(message.text).toBe(
        `❌ Not sent to ${to} · Fwd: Offer\n${joined(`${line}. The draft stays in Drafts.`, closings[sendKind])}`
      );
      if (again) {
        expect(message.buttons).toHaveLength(1);
        const button = message.buttons[0]?.[0];
        expect(button?.text).toBe("📤 Send again");
        expect(parseCallback(button?.data ?? "")).toEqual({ kind: "send_again", actionId: ID });
      } else {
        expect(message.buttons).toEqual([]);
      }
    }
  });

  test.each(sendKinds)("outcome_unknown (%s)", (sendKind) => {
    const message = result(sendKind, { kind: "outcome_unknown" });
    expect(message.text).toBe(
      `⚠️ Unknown whether the mail to ${to} went out · Fwd: Offer\n${joined("The connection broke after the content was sent. Check Sent or ask the recipient before you send again.", closings[sendKind])}`
    );
    expect(parseCallback(message.buttons[0]?.[0]?.data ?? "")).toEqual({ kind: "send_again", actionId: ID });
    // F041: only a delegation send has the "It went out" button; it is the second button.
    const second = message.buttons[1]?.[0];
    if (sendKind === "delegation") {
      expect(second?.text).toBe("✅ It went out");
      expect(parseCallback(second?.data ?? "")).toEqual({ kind: "went_out", actionId: ID });
    } else {
      expect(message.buttons).toHaveLength(1);
    }
  });

  const expired: [Extract<SendResultKind, { kind: "expired" }>["reason"], string, "both" | "closing" | "draft"][] = [
    ["timeout", "⌛ Not sent: the approval expired (48 h) · Fwd: Offer", "both"],
    ["draft_missing", "❌ Not sent: the draft could not be created · Fwd: Offer", "closing"],
    [
      "not_notified",
      "⌛ Not sent: no approval request could go out within 7 days (no linked owner, or the draft was not created) · Fwd: Offer",
      "both",
    ],
    [
      "held_timeout",
      "⌛ Not sent: it waited 48 h after your approval and was not sent (held by SEND_SCOPE or the mailbox state) · Fwd: Offer",
      "both",
    ],
    ["delegation_closed", "⌛ Not sent: the delegation was closed · Fwd: Offer", "draft"],
    ["policy_changed", "⌛ Not sent: the setting was changed · Fwd: Offer", "both"],
  ];

  test.each(sendKinds)("expired (%s)", (sendKind) => {
    for (const draftRemoved of [true, false]) {
      const draft = draftRemoved ? "The draft was removed." : "The draft stays in Drafts.";
      for (const [reason, first, second] of expired) {
        const message = result(sendKind, { kind: "expired", reason, draftRemoved });
        let rest = joined(closings[sendKind], draft);
        if (second === "closing") rest = closings[sendKind];
        if (second === "draft") rest = draft;
        expect(message.text).toBe(rest === "" ? first : `${first}\n${rest}`);
        expect(message.buttons).toEqual([]);
      }
    }
  });

  test.each(sendKinds)("rejected (%s)", (sendKind) => {
    expect(result(sendKind, { kind: "rejected", byName: "Artur", draftRemoved: true }).text).toBe(
      `✖️ Rejected by Artur · Fwd: Offer\n${joined(closings[sendKind], "The draft was removed.")}`
    );
    expect(result(sendKind, { kind: "rejected", byName: null, draftRemoved: false }).text).toBe(
      `✖️ Rejected · Fwd: Offer\n${joined(closings[sendKind], "The draft stays in Drafts.")}`
    );
  });

  test("synthetic mail is marked on the first line; a missing name leaves the address", () => {
    const message = renderSendResult({
      actionId: ID,
      sendKind: "delegation",
      result: { kind: "sent", sentCopy: "appended", draftRemoved: true },
      recipient: { name: null, address: "anna@example.com" },
      subject: "Offer",
      synthetic: true,
    });
    expect(message.text).toBe("✅ Sent to anna@example.com · Offer · 🧪 test");
  });

  test("a subject with a link and control characters is cleaned", () => {
    const message = renderSendResult({
      actionId: ID,
      sendKind: "delegation",
      result: { kind: "rejected", byName: null, draftRemoved: true },
      recipient,
      subject: "Pay\u0000 www.evil.test now",
      synthetic: false,
    });
    expect(message.text).toContain("Pay [link] now");
    expect(CONTROL.test(message.text)).toBe(false);
  });
});

describe("renderDelegationAnswered", () => {
  test("text and Done button", () => {
    const message = renderDelegationAnswered({
      delegationId: ID,
      delegateName: "Anna Nowak",
      subject: "Fwd: Offer",
      receivedAt: new Date("2026-11-07T09:05:00Z"),
      now: NOW,
      timeZone: TZ,
      synthetic: false,
    });
    expect(message.text).toBe("📩 Anna Nowak answered · Fwd: Offer\nReceived 10:05. Tap Done when the task is closed.");
    expect(message.buttons).toHaveLength(1);
    expect(message.buttons[0]?.[0]?.text).toBe("✅ Done");
    expect(parseCallback(message.buttons[0]?.[0]?.data ?? "")).toEqual({ kind: "delegation_done", delegationId: ID });
  });

  test("synthetic mail is marked; a missing subject reads (no subject)", () => {
    const message = renderDelegationAnswered({
      delegationId: ID,
      delegateName: "Anna",
      subject: null,
      receivedAt: NOW,
      now: NOW,
      timeZone: TZ,
      synthetic: true,
    });
    expect(message.text.split("\n")[0]).toBe("📩 Anna answered · (no subject) · 🧪 test");
  });
});

describe("approvalEdit", () => {
  const at = new Date("2026-11-07T10:07:00Z"); // 11:07 in Warsaw
  const original = "📤 Send? Delegation to Anna\nDraft:\nHi";
  const base = { original, at, timeZone: TZ, actionId: ID, counts: { done: 2, skipped: 1 } };

  const lines: [ApprovalEditOutcome, string][] = [
    ["approved", "⏳ Approved 11:07, sending."],
    ["rejected", "✖️ Rejected 11:07."],
    ["expired", "⌛ Expired 11:07. The mail was not sent."],
    ["approved_set", "⏳ Approved 11:07: 2 sending, 1 skipped."],
    ["rejected_set", "✖️ Skipped 11:07: 2 rejected, 1 skipped."],
    ["went_out", "✅ Marked as sent 11:07."],
    ["done", "✅ Done 11:07."],
  ];

  test.each(lines)("%s", (outcome, line) => {
    const message = approvalEdit({ ...base, outcome });
    expect(message.text).toBe(`${original}\n\n${line}`);
    expect(message.buttons).toEqual([]);
  });

  test("approved_held keeps one Reject button; the line differs per cause", () => {
    const texts = (["scope", "paused", "auth_error"] as const).map((heldBy) => {
      const message = approvalEdit({ ...base, outcome: "approved_held", heldBy });
      expect(message.buttons).toHaveLength(1);
      expect(message.buttons[0]).toHaveLength(1);
      expect(message.buttons[0]?.[0]?.text).toBe("✖️ Reject");
      expect(parseCallback(message.buttons[0]?.[0]?.data ?? "")).toEqual({ kind: "reject", actionId: ID });
      return message.text;
    });
    expect(new Set(texts).size).toBe(3);
    expect(texts[0]).toBe(
      `${original}\n\n⏳ Approved 11:07. Sending is held by SEND_SCOPE on the server; /status shows it. It expires 48 h after the tap if it is still held.`
    );
    expect(texts[1]).toContain("The mailbox is paused, so the send waits; /status shows it.");
    expect(texts[2]).toContain("The mailbox login fails, so the send waits; /status shows it.");
  });

  test("approved_held without an action id has no button (a set)", () => {
    const message = approvalEdit({ ...base, outcome: "approved_held", heldBy: "scope", actionId: undefined });
    expect(message.buttons).toEqual([]);
    expect(message.text).toContain("Sending is held by SEND_SCOPE on the server");
  });

  test("a long original is cut from its end, never the new line", () => {
    const message = approvalEdit({ ...base, original: "o".repeat(4090), outcome: "approved" });
    expect(message.text.length).toBeLessThanOrEqual(MESSAGE_MAX_CHARS);
    expect(message.text.endsWith("\n\n⏳ Approved 11:07, sending.")).toBe(true);
  });
});
