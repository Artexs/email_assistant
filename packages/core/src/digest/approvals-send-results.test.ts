import { describe, expect, test } from "bun:test";

import { textTables } from "../texts";
import type { DraftPayload } from "../triage/payloads";

import { renderDelegationAnswered, renderSendResult, type SendResultKind } from "./approvals";
import { ID, NOW, TZ, CONTROL, recipient } from "./approvals.test-helper";
import { parseCallback } from "./callback";

type SendKind = DraftPayload["kind"];

const sendKinds: SendKind[] = ["delegation", "clarification", "reminder", "reply"];

const closings: Record<SendKind, string> = {
  delegation: "The delegation was cancelled.",
  clarification: "",
  reminder: "The delegation stays open.",
  follow_up: "",
  reply: "",
};

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
    [
      { kind: "failed", cause: "has_gaps", code: null, tries: 0 },
      "The reply still has a gap marked with [[ ]] that nobody filled; nothing was sent",
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
    // Only a delegation send has the "It went out" button; it is the second button.
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
    [
      "draft_missing",
      "❌ Not sent: the draft is not in your Drafts folder (it was not created, or you deleted, moved or sent it in your mail client) · Fwd: Offer",
      "closing",
    ],
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
    ["draft_changed", "✏️ You edited this draft in your mail client. Send it from there. · Fwd: Offer", "both"],
    ["answered", "⌛ You already answered this mail. The system sent nothing. · Fwd: Offer", "both"],
    [
      "sent_by_user",
      "⌛ It looks like you sent it from your mail client. The system sent nothing. · Fwd: Offer",
      "closing",
    ],
    [
      "newer_mail",
      "⌛ A newer mail arrived in this thread. Nothing was sent. Read the newer mail; a new draft may follow. · Fwd: Offer",
      "both",
    ],
    [
      "original_moved",
      "⌛ The mail was moved to another folder. Nothing was sent. Answer it from its new place if you still want to. · Fwd: Offer",
      "both",
    ],
    [
      "suspicious",
      "⌛ The mail was marked as suspicious after the draft was made. Nothing was sent. Read the mail with care; a new draft may follow. · Fwd: Offer",
      "both",
    ],
  ];

  test.each(sendKinds)("expired (%s)", (sendKind) => {
    for (const draftRemoved of [true, false]) {
      const draft = draftRemoved ? "The draft was removed." : "The draft stays in Drafts.";
      for (const [reason, firstOfKind, second] of expired) {
        // A reply lives 7 days: its `timeout` line names no 48 h
        const first =
          sendKind === "reply" && reason === "timeout"
            ? "⌛ Not sent: nobody approved the draft in 7 days · Fwd: Offer"
            : firstOfKind;
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
    { kind: "failed", cause: "has_gaps", code: null, tries: 1 },
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
        "draft_changed",
        "answered",
        "sent_by_user",
        "newer_mail",
        "original_moved",
        "suspicious",
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
