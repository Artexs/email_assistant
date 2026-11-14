import { describe, expect, test } from "bun:test";

import type { ApprovalView } from "../outgoing/sender";
import { textTables } from "../texts";
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
  return renderApprovalRequest({ actionId: ID, view: v, now: NOW, timeZone: TZ }, textTables.en);
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

  test("the quote header keeps the sender address; links in the subject and body become [link]", () => {
    const header = (from: string, subject: string) =>
      `--- Original message ---\nFrom: ${from}\nDate: Sat 7 Nov 10:00\nSubject: ${subject}\n\n`;
    const quote = `${header("anna@example.com", "see evil.test/x")}> pay at https://evil.test/pay`;
    const message = request(view({ quote: { text: quote, cut: false } }));
    expect(message.text).toContain("\nFrom: anna@example.com\n");
    expect(message.text).toContain("\nSubject: see [link]\n");
    expect(message.text).toContain("> pay at [link]");
    expect(message.text).toContain("(links shown as [link]; the draft has them)");

    const polish = "--- Oryginalna wiadomość ---\nOd: Anna <anna@sub.example.com>\nTemat: x\n\n> y";
    expect(request(view({ quote: { text: polish, cut: false } })).text).toContain(
      "\nOd: Anna <anna@sub.example.com>\n"
    );

    const hostile = request(
      view({ quote: { text: `${header("a@b.test www.evil.test https://evil.test/p evil.test", "s")}> z`, cut: false } })
    );
    expect(hostile.text).toContain("\nFrom: a@b.test [link] [link] [link]\n");
    expect(hostile.text).not.toContain("evil.test");
  });

  test("a From line in the quote body is not a header line", () => {
    const quote = "--- Original message ---\nFrom: a@b.test\nSubject: s\n\n> From: c@d.test";
    expect(request(view({ quote: { text: quote, cut: false } })).text).toContain("> From: c@[link]");
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

describe("renderApprovalRequest in Polish", () => {
  const pl = textTables.pl;
  const plRequest = (v: ApprovalView) => renderApprovalRequest({ actionId: ID, view: v, now: NOW, timeZone: TZ }, pl);

  test("a delegation has Polish lines and the same callback data", () => {
    const message = plRequest(
      view({
        recipient: { name: "Jan Kowalski", address: "jan@example.test" },
        body: "b".repeat(200),
        quote: { text: "> Hello", cut: false },
      })
    );
    const lines = message.text.split("\n");
    expect(lines[0]).toBe("📤 Wysłać? Zlecenie: Jan Kowalski jan@example.test");
    expect(lines[1]).toBe("Od: boss@client.test · ⚠️ nadawca zewnętrzny");
    expect(lines[2]).toBe("Temat: Fwd: Offer");
    expect(lines[3]).toBe("Termin: 2026-11-12");
    expect(lines).toContain("Szkic:");
    expect(lines).toContain("Cytowany oryginał:");
    expect(message.buttons[0]?.map((button) => button.text)).toEqual(["📤 Wyślij", "✖️ Odrzuć"]);
    const en = request(view());
    expect(message.buttons[0]?.map((button) => button.data)).toEqual(en.buttons[0]?.map((button) => button.data));
    expect(parseCallback(message.buttons[0]?.[0]?.data ?? "")).toEqual({ kind: "approve", actionId: ID });
  });

  test("the other kinds, an inactive delegate and a test mail", () => {
    expect(plRequest(view({ kind: "clarification" })).text.split("\n")[0]).toBe(
      "📤 Wysłać? Pytanie do nadawcy: anna@example.com"
    );
    expect(plRequest(view({ kind: "reminder", sender: null })).text.split("\n")[0]).toBe(
      "📤 Wysłać? Przypomnienie: Anna Nowak anna@example.com"
    );
    expect(plRequest(view({ recipientInactive: true, synthetic: true })).text.split("\n")[0]).toBe(
      "📤 Wysłać? Zlecenie: Anna Nowak (nieaktywny wykonawca) anna@example.com · 🧪 test"
    );
  });

  test("a long body shrinks the quote and the Polish text keeps the limit and the quote-cut note", () => {
    const long = view({ body: "b".repeat(2900), quote: { text: "q".repeat(1500), cut: false } });
    const en = request(long);
    expect(en.text.length).toBe(MESSAGE_MAX_CHARS);
    const message = plRequest(long);
    expect(message.text.length).toBeLessThanOrEqual(MESSAGE_MAX_CHARS);
    expect(message.text).toContain(textTables.pl.approvals.quoteCut);
  });

  test("the stored English placeholder prints in the language of the row", () => {
    const unknown = view({ sender: { label: "(unknown sender)", external: false } });
    expect(plRequest(unknown).text.split("\n")[1]).toBe("Od: (nieznany nadawca)");
    expect(request(unknown).text.split("\n")[1]).toBe("From: (unknown sender)");
  });
});

describe("renderApprovalSetRequest", () => {
  test("two items, one without a due date", () => {
    const message = renderApprovalSetRequest(
      {
        setId: SET_ID,
        items: [item(1), item(2, { dueAt: null, reminder: 2 })],
        timeZone: TZ,
      },
      textTables.en
    );
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
    const message = renderApprovalSetRequest({ setId: SET_ID, items: [item(1)], timeZone: TZ }, textTables.en);
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
    const message = renderApprovalSetRequest({ setId: SET_ID, items, timeZone: TZ }, textTables.en);
    expect(message.text.length).toBeLessThanOrEqual(MESSAGE_MAX_CHARS);
    for (let i = 1; i <= 10; i++) {
      expect(message.text).toContain(`${i}. N${i}`);
      expect(message.text).toContain(`anna${i}@example.com`);
      expect(message.text).toContain(`Task: T${i}`);
    }
  });

  test("11 items or none is a programming error", () => {
    const items = Array.from({ length: 11 }, (_, i) => item(i + 1));
    expect(() => renderApprovalSetRequest({ setId: SET_ID, items, timeZone: TZ }, textTables.en)).toThrow(RangeError);
    expect(() => renderApprovalSetRequest({ setId: SET_ID, items: [], timeZone: TZ }, textTables.en)).toThrow(
      RangeError
    );
  });
});

describe("renderApprovalSetRequest in Polish", () => {
  const pl = textTables.pl;

  test.each([
    [1, "📤 Wysłać 1 przypomnienie?"],
    [3, "📤 Wysłać 3 przypomnienia?"],
    [5, "📤 Wysłać 5 przypomnień?"],
  ])("%i items", (count, header) => {
    const items = Array.from({ length: count }, (_, i) => item(i + 1));
    const message = renderApprovalSetRequest({ setId: SET_ID, items, timeZone: TZ }, pl);
    expect(message.text.split("\n")[0]).toBe(header);
    expect(message.buttons[0]?.map((button) => button.text)).toEqual(["📤 Wyślij wszystkie", "✖️ Pomiń wszystkie"]);
  });

  test("an item line has the Polish day, the reminder number and the task label", () => {
    const message = renderApprovalSetRequest(
      { setId: SET_ID, items: [item(1), item(2, { subject: null })], timeZone: TZ },
      pl
    );
    expect(message.text).toContain("1. Anna 1 anna1@example.com — Offer 1 (termin: czw. 5 lis, przypomnienie 1 z 2)");
    expect(message.text).toContain("   Zadanie: check offer 1");
    expect(message.text).toContain("— (bez tematu) (");
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
  return renderSendResult(
    { actionId: ID, sendKind, result: kind, recipient, subject: "Fwd: Offer", synthetic },
    textTables.en
  );
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
    [
      { kind: "failed", cause: "soft_cap", code: "450", tries: 0 },
      "The mail server did not accept the mail for 6 hours (450); nothing was sent",
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
      "not_seen",
      "⌛ Not sent: you did not receive the approval request (the account was paused, or it did not go out) · Fwd: Offer",
      "both",
    ],
    [
      "held_timeout",
      "⌛ Not sent: it waited 48 h after your approval and was not sent (held by SEND_SCOPE, the send limit or the mailbox state) · Fwd: Offer",
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
    const message = renderSendResult(
      {
        actionId: ID,
        sendKind: "delegation",
        result: { kind: "sent", sentCopy: "appended", draftRemoved: true },
        recipient: { name: null, address: "anna@example.com" },
        subject: "Offer",
        synthetic: true,
      },
      textTables.en
    );
    expect(message.text).toBe("✅ Sent to anna@example.com · Offer · 🧪 test");
  });

  test("a subject with a link and control characters is cleaned", () => {
    const message = renderSendResult(
      {
        actionId: ID,
        sendKind: "delegation",
        result: { kind: "rejected", byName: null, draftRemoved: true },
        recipient,
        subject: "Pay\u0000 www.evil.test now",
        synthetic: false,
      },
      textTables.en
    );
    expect(message.text).toContain("Pay [link] now");
    expect(CONTROL.test(message.text)).toBe(false);
  });
});

describe("Polish send results", () => {
  const pl = textTables.pl;
  const resultPl = (sendKind: SendKind, kind: SendResultKind) =>
    renderSendResult({ actionId: ID, sendKind, result: kind, recipient, subject: "Fwd: Offer", synthetic: false }, pl);

  const kinds: SendResultKind[] = [
    { kind: "sent", sentCopy: "failed", draftRemoved: false },
    { kind: "rejected_by_server", stage: "RCPT", responseCode: 550 },
    { kind: "failed", cause: "tries", code: "ETIMEDOUT", tries: 3 },
    { kind: "failed", cause: "content_soft", code: null, tries: 1 },
    { kind: "failed", cause: "soft_cap", code: "421", tries: 1 },
    { kind: "failed", cause: "compose", code: null, tries: 2 },
    { kind: "failed", cause: "bad_payload", code: null, tries: 1 },
    { kind: "outcome_unknown" },
    { kind: "rejected", byName: "Anna", draftRemoved: true },
    { kind: "rejected", byName: null, draftRemoved: false },
    ...(
      [
        "timeout",
        "draft_missing",
        "not_notified",
        "not_seen",
        "held_timeout",
        "delegation_closed",
        "policy_changed",
      ] as const
    ).map((reason): SendResultKind => ({ kind: "expired", reason, draftRemoved: false })),
  ];

  test.each(kinds.map((kind, index) => [index, kind] as const))(
    "case %i has a Polish first line with the emoji of English",
    (_, kind) => {
      for (const sendKind of sendKinds) {
        const en = result(sendKind, kind).text.split("\n")[0] ?? "";
        const message = resultPl(sendKind, kind);
        const first = message.text.split("\n")[0] ?? "";
        expect(first.length).toBeGreaterThan(0);
        expect(first).not.toBe(en);
        expect(first.split(" ")[0]).toBe(en.split(" ")[0]);
        expect(message.text).not.toContain("The ");
      }
    }
  );

  test("an unknown outcome of a delegation has Polish buttons with the English callback data", () => {
    const message = resultPl("delegation", { kind: "outcome_unknown" });
    expect(message.buttons.flat().map((button) => button.text)).toEqual(["📤 Wyślij ponownie", "✅ Wysłano"]);
    expect(message.buttons.flat().map((button) => button.data)).toEqual(
      result("delegation", { kind: "outcome_unknown" })
        .buttons.flat()
        .map((button) => button.data)
    );
  });

  test("a sent mail, a refusal and the closing lines", () => {
    expect(resultPl("delegation", { kind: "sent", sentCopy: "appended", draftRemoved: true }).text).toBe(
      "✅ Wysłano do: Anna Nowak anna@example.com · Fwd: Offer"
    );
    expect(resultPl("reminder", { kind: "rejected_by_server", stage: "RCPT", responseCode: 550 }).text).toBe(
      "❌ Nie wysłano do: Anna Nowak anna@example.com · Fwd: Offer\nSerwer poczty odrzucił wiadomość (RCPT, kod: 550). Szkic zostaje w folderze Drafts. Zlecenie zostaje otwarte."
    );
    expect(resultPl("delegation", { kind: "rejected", byName: "Anna", draftRemoved: true }).text).toBe(
      "✖️ Odrzucono (Anna) · Fwd: Offer\nZlecenie zostało anulowane. Szkic został usunięty."
    );
  });
});

describe("renderDelegationAnswered", () => {
  test("text and Done button", () => {
    const message = renderDelegationAnswered(
      {
        delegationId: ID,
        delegateName: "Anna Nowak",
        subject: "Fwd: Offer",
        receivedAt: new Date("2026-11-07T09:05:00Z"),
        now: NOW,
        timeZone: TZ,
        synthetic: false,
      },
      textTables.en
    );
    expect(message.text).toBe("📩 Anna Nowak answered · Fwd: Offer\nReceived 10:05. Tap Done when the task is closed.");
    expect(message.buttons).toHaveLength(1);
    expect(message.buttons[0]?.[0]?.text).toBe("✅ Done");
    expect(parseCallback(message.buttons[0]?.[0]?.data ?? "")).toEqual({ kind: "delegation_done", delegationId: ID });
  });

  test("synthetic mail is marked; a missing subject reads (no subject)", () => {
    const message = renderDelegationAnswered(
      {
        delegationId: ID,
        delegateName: "Anna",
        subject: null,
        receivedAt: NOW,
        now: NOW,
        timeZone: TZ,
        synthetic: true,
      },
      textTables.en
    );
    expect(message.text.split("\n")[0]).toBe("📩 Anna answered · (no subject) · 🧪 test");
  });
});

describe("renderDelegationAnswered in Polish", () => {
  test("text and Done button", () => {
    const message = renderDelegationAnswered(
      {
        delegationId: ID,
        delegateName: "Anna Nowak",
        subject: null,
        receivedAt: new Date("2026-11-07T09:05:00Z"),
        now: NOW,
        timeZone: TZ,
        synthetic: false,
      },
      textTables.pl
    );
    expect(message.text).toBe(
      "📩 Odpowiedź od: Anna Nowak · (bez tematu)\nOdebrano 10:05. Naciśnij „Gotowe”, gdy zadanie zostanie zamknięte."
    );
    expect(message.buttons[0]?.[0]?.text).toBe("✅ Gotowe");
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
    const message = approvalEdit({ ...base, outcome }, textTables.en);
    expect(message.text).toBe(`${original}\n\n${line}`);
    expect(message.buttons).toEqual([]);
  });

  test("approved_held keeps one Reject button; the line differs per cause", () => {
    const texts = (["scope", "paused", "auth_error"] as const).map((heldBy) => {
      const message = approvalEdit({ ...base, outcome: "approved_held", heldBy }, textTables.en);
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
    const message = approvalEdit(
      { ...base, outcome: "approved_held", heldBy: "scope", actionId: undefined },
      textTables.en
    );
    expect(message.buttons).toEqual([]);
    expect(message.text).toContain("Sending is held by SEND_SCOPE on the server");
  });

  test("a long original is cut from its end, never the new line", () => {
    const message = approvalEdit({ ...base, original: "o".repeat(4090), outcome: "approved" }, textTables.en);
    expect(message.text.length).toBeLessThanOrEqual(MESSAGE_MAX_CHARS);
    expect(message.text.endsWith("\n\n⏳ Approved 11:07, sending.")).toBe(true);
  });
});

describe("approvalEdit in Polish", () => {
  const at = new Date("2026-11-07T10:07:00Z");
  const original = "📤 Wysłać? Zlecenie: Anna\nSzkic:\nHi";
  const base = { original, at, timeZone: TZ, actionId: ID, counts: { done: 2, skipped: 1 } };

  test.each<[ApprovalEditOutcome, string]>([
    ["approved", "⏳ Zatwierdzono 11:07, trwa wysyłanie."],
    ["rejected", "✖️ Odrzucono 11:07."],
    ["expired", "⌛ Wygasło 11:07. Wiadomość nie została wysłana."],
    ["approved_set", "⏳ Zatwierdzono 11:07. Wysyłanie: 2, pominięto: 1."],
    ["rejected_set", "✖️ Pominięto 11:07. Odrzucono: 2, pominięto: 1."],
    ["went_out", "✅ Oznaczono jako wysłane 11:07."],
    ["done", "✅ Gotowe 11:07."],
  ])("%s keeps the stored text and adds one Polish line", (outcome, line) => {
    const message = approvalEdit({ ...base, outcome }, textTables.pl);
    expect(message.text).toBe(`${original}\n\n${line}`);
    expect(message.buttons).toEqual([]);
  });

  test("approved_held has the Polish cause and the Polish Reject button", () => {
    const message = approvalEdit({ ...base, outcome: "approved_held", heldBy: "paused" }, textTables.pl);
    expect(message.text).toContain("Skrzynka jest wstrzymana, więc wysyłanie czeka; /status pokazuje szczegóły.");
    expect(message.buttons[0]?.[0]?.text).toBe("✖️ Odrzuć");
    expect(parseCallback(message.buttons[0]?.[0]?.data ?? "")).toEqual({ kind: "reject", actionId: ID });
  });
});
