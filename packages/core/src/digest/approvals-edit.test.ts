import { describe, expect, test } from "bun:test";

import { textTables } from "../texts";

import { approvalEdit, type ApprovalEditOutcome, renderSendResult, type SendResultKind } from "./approvals";
import { ID, TZ, recipient } from "./approvals.test-helper";
import { parseCallback } from "./callback";
import { MESSAGE_MAX_CHARS } from "./message";

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
    const texts = (["scope", "paused", "auth_error", "host_blocked"] as const).map((heldBy) => {
      const message = approvalEdit({ ...base, outcome: "approved_held", heldBy }, textTables.en);
      expect(message.buttons).toHaveLength(1);
      expect(message.buttons[0]).toHaveLength(1);
      expect(message.buttons[0]?.[0]?.text).toBe("✖️ Reject");
      expect(parseCallback(message.buttons[0]?.[0]?.data ?? "")).toEqual({ kind: "reject", actionId: ID });
      return message.text;
    });
    expect(new Set(texts).size).toBe(4);
    expect(texts[0]).toBe(
      `${original}\n\n⏳ Approved 11:07. Sending is held by SEND_SCOPE on the server; /status shows it. It expires 48 h after the tap if it is still held.`
    );
    expect(texts[1]).toContain("The mailbox is paused, so the send waits; /status shows it.");
    expect(texts[2]).toContain("The mailbox login fails, so the send waits; /status shows it.");
    expect(texts[3]).toBe(
      `${original}\n\n⏳ Approved 11:07. The mail server is not allowed, so the send waits; /status shows it. It expires 48 h after the tap if it is still held.`
    );
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

describe("approvalEdit changed", () => {
  const at = new Date("2026-11-07T13:05:00Z"); // 14:05 in Warsaw
  const original = "📤 Send? Delegation to Anna\nDraft:\nHi";

  test("T6 the line is appended and the card has no buttons", () => {
    const message = approvalEdit({ original, outcome: "changed", at, timeZone: TZ, actionId: ID }, textTables.en);
    expect(message.text).toBe(`${original}\n\n✏️ Changed 14:05. The new version comes as a new message.`);
    expect(message.buttons).toEqual([]);
  });

  test("T7 the Polish edit line and the tap answer", () => {
    const message = approvalEdit({ original, outcome: "changed", at, timeZone: TZ, actionId: ID }, textTables.pl);
    expect(message.text).toBe(`${original}\n\n✏️ Zmieniono 14:05. Nowa wersja przyjdzie w osobnej wiadomości.`);
    expect(message.buttons).toEqual([]);
    expect(textTables.pl.bot.taps.changed).toBe("Ten szkic został zmieniony. Użyj najnowszej wiadomości.");
    expect(textTables.en.bot.taps.changed).toBe("This draft was changed. Use the newest message.");
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
    ["approved_set", "⏳ Zatwierdzono 11:07. Wysyłanie: 2 (pominięto 1)."],
    ["rejected_set", "✖️ Pominięto 11:07. Odrzucono: 2 (pominięto 1)."],
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

describe("reject reasons and the mistake mark", () => {
  const at = new Date("2026-11-07T10:07:00Z"); // 11:07 in Warsaw
  const original = "📤 Send? Delegation to Anna\nDraft:\nHi";
  const base = { original, at, timeZone: TZ, actionId: ID };

  test("rejected with reasonButtons: the same line and three reason buttons", () => {
    const message = approvalEdit({ ...base, outcome: "rejected", reasonButtons: true }, textTables.en);
    expect(message.text).toBe(`${original}\n\n✖️ Rejected 11:07.`);
    expect(message.buttons).toHaveLength(1);
    expect(message.buttons[0]?.map((button) => button.text)).toEqual([
      "✖️ Wrong person",
      "✖️ Wrong content",
      "Not needed",
    ]);
    expect(message.buttons[0]?.map((button) => button.data)).toEqual([`rw:p:${ID}`, `rw:c:${ID}`, `rw:n:${ID}`]);
  });

  test("rejected without reasonButtons has no button (old behaviour)", () => {
    expect(approvalEdit({ ...base, outcome: "rejected" }, textTables.en).buttons).toEqual([]);
  });

  test("rejected with reasonButtons but no action id has no button", () => {
    const message = approvalEdit(
      { ...base, actionId: undefined, outcome: "rejected", reasonButtons: true },
      textTables.en
    );
    expect(message.buttons).toEqual([]);
  });

  test.each([
    ["wrong_person", "✖️ Rejected. Reason: wrong person."],
    ["wrong_content", "✖️ Rejected. Reason: wrong content."],
    ["not_needed", "✖️ Rejected. Reason: not needed."],
  ] as const)("rejected_reason %s: last line without a clock, no buttons", (reason, line) => {
    const message = approvalEdit({ ...base, outcome: "rejected_reason", reason }, textTables.en);
    expect(message.text).toBe(`${original}\n\n${line}`);
    expect(message.buttons).toEqual([]);
  });

  test("rejected_reason without a reason throws", () => {
    expect(() => approvalEdit({ ...base, outcome: "rejected_reason" }, textTables.en)).toThrow("needs reason");
  });

  test("marked_mistake: a line with the time, no buttons", () => {
    const message = approvalEdit({ ...base, outcome: "marked_mistake" }, textTables.en);
    expect(message.text).toBe(`${original}\n\n⚠️ Marked as a mistake 11:07.`);
    expect(message.buttons).toEqual([]);
  });

  test("the Polish lines and buttons", () => {
    const rejected = approvalEdit({ ...base, outcome: "rejected", reasonButtons: true }, textTables.pl);
    expect(rejected.buttons[0]?.map((button) => button.text)).toEqual(["✖️ Zła osoba", "✖️ Zła treść", "Niepotrzebne"]);
    const reason = approvalEdit({ ...base, outcome: "rejected_reason", reason: "wrong_content" }, textTables.pl);
    expect(reason.text.endsWith("\n\n✖️ Odrzucono. Powód: zła treść.")).toBe(true);
    expect(
      approvalEdit({ ...base, outcome: "marked_mistake" }, textTables.pl).text.endsWith("⚠️ Oznaczono jako błąd 11:07.")
    ).toBe(true);
  });

  test("renderSendResult: a sent result with mistakeButton has one mistake button", () => {
    const sent: SendResultKind = { kind: "sent", sentCopy: "appended", draftRemoved: true };
    const input = {
      actionId: ID,
      sendKind: "delegation",
      result: sent,
      recipient,
      subject: "Fwd: Offer",
      synthetic: false,
    } as const;
    const message = renderSendResult({ ...input, mistakeButton: true }, textTables.en);
    expect(message.buttons).toEqual([[{ text: "⚠️ This was a mistake", data: `mk:${ID}` }]]);
    expect(renderSendResult({ ...input, mistakeButton: true }, textTables.pl).buttons[0]?.[0]?.text).toBe(
      "⚠️ To był błąd"
    );
    expect(renderSendResult(input, textTables.en).buttons).toEqual([]);
    expect(renderSendResult({ ...input, mistakeButton: false }, textTables.en).buttons).toEqual([]);
  });

  test("renderSendResult: a failed result with mistakeButton keeps only its old buttons", () => {
    const failed: SendResultKind = { kind: "failed", cause: "tries", code: null, tries: 3 };
    const input = {
      actionId: ID,
      sendKind: "delegation",
      result: failed,
      recipient,
      subject: "Fwd: Offer",
      synthetic: false,
    } as const;
    const withFlag = renderSendResult({ ...input, mistakeButton: true }, textTables.en);
    expect(withFlag.buttons).toEqual(renderSendResult(input, textTables.en).buttons);
    expect(withFlag.buttons.flat().map((button) => button.data)).toEqual([`ag:${ID}`]);
  });
});
