// F116 stage 11: the card, the result lines and the fixed notices of a follow-up (T1–T3, T3b texts).
import { describe, expect, test } from "bun:test";

import { encodeNoticeView } from "../notices/encode";
import { renderNotice } from "../notices/render";
import type { ApprovalView } from "../outgoing/sender";
import { approvalViewSchema } from "../outgoing/view-schema";
import { textTables } from "../texts";
import { addressSchema, sendPayloadSchema } from "../triage/payloads";

import {
  FOLLOW_UP_RECIPIENTS_MAX_CHARS,
  renderApprovalRequest,
  renderSendResult,
  type SendResultKind,
} from "./approvals";
import { parseCallback } from "./callback";
import { MESSAGE_MAX_CHARS } from "./message";

const ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const LOOP = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";
const NOW = new Date("2026-11-15T10:00:00Z");
const TZ = "Europe/Warsaw";
const PANEL = "https://panel.example.test/approvals?id=0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

function followUp(overrides: Partial<ApprovalView> = {}): ApprovalView {
  return {
    kind: "follow_up",
    recipient: { name: null, address: "anna@example.test" },
    sender: null,
    recipientInactive: false,
    subject: "Re: Offer Q1",
    dueDate: null,
    body: 'Hello,\n\nI am coming back to my message of 10 Nov 2026 about "Offer Q1". Could you let me know where this stands?\n\nArtek',
    quote: { text: "My message of 10 Nov 2026:\n> Can you confirm the date?", cut: false },
    synthetic: false,
    to: ["anna@example.test"],
    cc: ["jan@example.test", "ewa@example.test"],
    followUpNumber: 1,
    ...overrides,
  };
}

const card = (view: ApprovalView, locale: "en" | "pl" = "en") =>
  renderApprovalRequest({ actionId: ID, view, now: NOW, timeZone: TZ }, textTables[locale]);

describe("the follow-up card (T1, T2, T3)", () => {
  test("T1 English: To and Cc spelled out, the subject, the exact body, the number, Send and Reject", () => {
    const message = card(followUp());
    expect(message.text).toBe(
      [
        "📝 Follow-up",
        "To: anna@example.test",
        "Cc: jan@example.test, ewa@example.test",
        "Subject: Re: Offer Q1",
        "Follow-up 1 of 2",
        "",
        "Draft:",
        followUp().body,
        "",
        "Quoted original:",
        "My message of 10 Nov 2026:\n> Can you confirm the date?",
        "",
        "The system sends it after your tap. Do not send the draft from your mail client.",
      ].join("\n")
    );
    expect(message.buttons).toEqual([
      [
        { text: "📤 Send", data: `ap:${ID}` },
        { text: "✖️ Reject", data: `ar:${ID}` },
      ],
    ]);
  });

  test("T1 Polish: natural words, the same shape", () => {
    const message = card(
      followUp({ body: "Dzień dobry,\n\nwracam do mojej wiadomości.\n\nArtek", followUpNumber: 2 }),
      "pl"
    );
    expect(message.text.split("\n").slice(0, 5)).toEqual([
      "📝 Przypomnienie o odpowiedzi",
      "Do: anna@example.test",
      "Kopia: jan@example.test, ewa@example.test",
      "Temat: Re: Offer Q1",
      "Przypomnienie 2 z 2",
    ]);
    expect(message.buttons[0]?.map((button) => button.text)).toEqual(["📤 Wyślij", "✖️ Odrzuć"]);
  });

  test("no Cc line when the loop has no Cc; the panel link sits above the send line", () => {
    const message = card(followUp({ cc: [], panelUrl: PANEL }));
    expect(message.text).not.toContain("Cc:");
    const lines = message.text.split("\n");
    expect(lines[lines.length - 2]).toBe(`Open in panel: ${PANEL}`);
  });

  test("a later edit version shows its line under the title", () => {
    expect(card(followUp({ version: 3 })).text.split("\n")[1]).toBe("✏️ Version 3, edited in the panel.");
  });

  test("the buttons are the single-send callbacks: no set callback", () => {
    const [send, reject] = card(followUp()).buttons[0] ?? [];
    expect(parseCallback(send?.data ?? "")).toEqual({ kind: "approve", actionId: ID });
    expect(parseCallback(reject?.data ?? "")).toEqual({ kind: "reject", actionId: ID });
  });

  test("T2 a body of 5,000 characters: the card fits 4096 and the recipients stay whole", () => {
    const to = ["a-very-long-recipient-name@example.test", "second@example.test"];
    const cc = ["third@example.test", "fourth@example.test"];
    const message = card(followUp({ body: "x".repeat(5000), to, cc, quote: null }));
    expect(message.text.length).toBeLessThanOrEqual(MESSAGE_MAX_CHARS);
    expect(message.text).toContain(`To: ${to.join(", ")}`);
    expect(message.text).toContain(`Cc: ${cc.join(", ")}`);
    expect(message.text).toContain("…");
    expect(message.text).toContain("(draft text cut; the full text is in the draft)");
  });

  test("T2 a long quote shrinks first: the body stays whole", () => {
    const view = followUp({ quote: { text: `My message:\n${"> line of the quote\n".repeat(600)}`, cut: false } });
    const message = card(view);
    expect(message.text.length).toBeLessThanOrEqual(MESSAGE_MAX_CHARS);
    expect(message.text).toContain(view.body);
    expect(message.text).toContain("(quote cut; the draft has the full text)");
    expect(message.text).toContain("Cc: jan@example.test, ewa@example.test");
  });

  test("recipients that cannot fit one card are refused, never cut", () => {
    const long = (n: number) => `${"x".repeat(240)}${n}@example.test`;
    const to = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(long);
    expect(to.join(", ").length).toBeGreaterThan(FOLLOW_UP_RECIPIENTS_MAX_CHARS);
    expect(() => card(followUp({ to, cc: [] }))).toThrow(RangeError);
  });

  test("the view of a follow-up parses with the strict schema; a view without the new fields still does", () => {
    expect(approvalViewSchema.safeParse(followUp()).success).toBe(true);
    const { to, cc, followUpNumber, ...mail } = followUp();
    void to;
    void cc;
    void followUpNumber;
    expect(approvalViewSchema.safeParse({ ...mail, kind: "clarification" }).success).toBe(true);
    expect(approvalViewSchema.safeParse({ ...followUp(), to: [] }).success).toBe(false);
    expect(approvalViewSchema.safeParse({ ...followUp(), followUpNumber: 3 }).success).toBe(false);
  });

  test("T3 a follow-up never joins an approval set: its send payload refuses a set id", () => {
    const send = { kind: "follow_up", loop_id: LOOP, to: ["anna@example.test"], cc: [] };
    expect(sendPayloadSchema.safeParse(send).success).toBe(true);
    expect(sendPayloadSchema.safeParse({ ...send, set_id: ID }).success).toBe(false);
    expect(sendPayloadSchema.safeParse({ kind: "reminder", to: ["a@example.test"], set_id: ID }).success).toBe(true);
  });
});

describe("a recipient that the card could hide or reorder is not an address", () => {
  const ok = ["anna@example.test", "a.b+c@sub.example.test", "ann@exämple.test"];
  // Quoted, angle, list, header-injection, encoded and invisible forms.
  const bad = [
    "anna@example.test\u200b", // zero width space
    "an\u202ena@example.test", // bidi override
    "anna@exam\u2066ple.test", // bidi isolate
    "anna@exa\u061cmple.test", // arabic letter mark
    "\ufeffanna@example.test", // byte order mark
    "anna@example.test\u0085", // next line
    "anna@example\u0007.test", // control
    "anna@example.test\u2028", // line separator
    '"anna"@example.test',
    "<anna@example.test>",
    "anna@example.test,jan@example.test",
    "anna@example.test\r\nBcc: x@example.test",
  ];

  test.each(ok)("accepts %s", (address) => expect(addressSchema.safeParse(address).success).toBe(true));
  test.each(bad.map((address) => [JSON.stringify(address), address] as const))("refuses %s", (_name, address) =>
    expect(addressSchema.safeParse(address).success).toBe(false)
  );
});

describe("the result lines of a follow-up", () => {
  const result = (kind: SendResultKind, locale: "en" | "pl" = "en", synthetic = false) =>
    renderSendResult(
      {
        actionId: ID,
        sendKind: "follow_up",
        result: kind,
        recipient: { name: null, address: "anna@example.test" },
        subject: "Re: Offer Q1",
        synthetic,
      },
      textTables[locale]
    );

  test("T8 sent: the first recipient, no subject, no draft lines, no button", () => {
    const sent: SendResultKind = { kind: "sent", sentCopy: "appended", draftRemoved: false };
    expect(result(sent).text).toBe("✅ Follow-up sent to anna@example.test");
    expect(result(sent, "pl").text).toBe("✅ Przypomnienie wysłane do anna@example.test");
    expect(result(sent).buttons).toEqual([]);
  });

  test("rejected and expired", () => {
    expect(result({ kind: "rejected", byName: null, draftRemoved: true }).text).toBe("✖️ Follow-up rejected");
    expect(result({ kind: "rejected", byName: "Artek", draftRemoved: true }, "pl").text).toBe(
      "✖️ Przypomnienie odrzucone (Artek)"
    );
    expect(result({ kind: "expired", reason: "timeout", draftRemoved: true }).text).toBe(
      "⌛ Follow-up not sent: the approval expired (48 h)."
    );
    expect(result({ kind: "expired", reason: "loop_closed", draftRemoved: true }, "pl").text).toBe(
      "⌛ Nie wysłano przypomnienia: sprawa została zamknięta."
    );
  });

  test("a failed follow-up has no result line (the fixed action_failed notice tells it)", () => {
    expect(() => result({ kind: "outcome_unknown" })).toThrow(RangeError);
    expect(() => result({ kind: "failed", cause: "tries", code: null, tries: 3 })).toThrow(RangeError);
    expect(() => result({ kind: "rejected_by_server", stage: "rcpt_to", responseCode: 550 })).toThrow(RangeError);
  });
});

describe("the fixed notices of a follow-up (T3b, G13, D17)", () => {
  const opts = (locale: "en" | "pl") => ({ channel: "telegram", detail: "full", locale }) as const;

  test("action_failed: a fixed text with the panel link, or the may-have-gone-out text", () => {
    const failed = encodeNoticeView("action_failed", { followUp: { cause: "failed", panelUrl: PANEL } });
    expect(renderNotice("action_failed", failed, opts("en"))).toEqual({
      ok: true,
      message: {
        text: `⚠️ A follow-up could not be sent. Nothing went out.\nOpen in panel: ${PANEL}`,
        buttons: [],
      },
    });
    const unknown = encodeNoticeView("action_failed", { followUp: { cause: "unknown" } });
    expect(renderNotice("action_failed", unknown, opts("pl"))).toEqual({
      ok: true,
      message: {
        text: "⚠️ Przypomnienie o odpowiedzi mogło wyjść: połączenie przerwało się po wysłaniu treści. Sprawdź folder Sent, zanim napiszesz kolejne.",
        buttons: [],
      },
    });
  });

  test("action_failed: the follow-up view holds no recipient, subject or text; the old view still parses", () => {
    for (const extra of [{ to: "a@b.test" }, { subject: "x" }, { text: "x" }, { from: "a@b.test" }]) {
      expect(renderNotice("action_failed", { followUp: { cause: "failed" }, ...extra }, opts("en")).ok).toBe(false);
    }
    expect(renderNotice("action_failed", { followUp: { cause: "failed", to: "a@b.test" } }, opts("en")).ok).toBe(false);
    const old = {
      actionType: "move",
      reverse: false,
      reason: "other",
      folderName: null,
      sourceFolder: "INBOX",
      currentFolder: "INBOX",
      from: null,
      subject: null,
      synthetic: false,
      attempts: 1,
    };
    expect(renderNotice("action_failed", old, opts("en")).ok).toBe(true);
  });

  test("send_held: a follow-up waits, with the limit and the panel link; the mail notice keeps its text", () => {
    const view = {
      mailboxId: ID,
      address: "box@example.test",
      limit: "mailbox_hour",
      waiting: 2,
      nextAt: new Date("2026-11-15T11:00:00Z"),
      now: NOW,
      timeZone: TZ,
    } as const;
    const followUps = encodeNoticeView("send_held", { ...view, followUps: true, panelUrl: PANEL });
    const en = renderNotice("send_held", followUps, opts("en"));
    expect(en.ok && en.message.text.split("\n")).toEqual([
      "⏸ A follow-up waits: the hourly send limit of this mailbox is reached.",
      expect.stringContaining("2 waiting; the next one goes out at about"),
      `Open in panel: ${PANEL}`,
    ]);
    expect(en.ok && en.message.text).not.toContain("box@example.test");
    const pl = renderNotice("send_held", followUps, opts("pl"));
    expect(pl.ok && pl.message.text.split("\n")[0]).toBe(
      "⏸ Przypomnienie o odpowiedzi czeka: osiągnięto godzinny limit wysyłania z tej skrzynki."
    );
    const mail = renderNotice("send_held", encodeNoticeView("send_held", view), opts("en"));
    expect(mail.ok && mail.message.text).toContain("Sends from box@example.test wait");
  });

  test("loop_consent: one fixed line per kind, the panel link, no recipient and no text", () => {
    const render = (about: "approval" | "result", locale: "en" | "pl", panelUrl?: string) =>
      renderNotice(
        "loop_consent",
        encodeNoticeView("loop_consent", { about, ...(panelUrl === undefined ? {} : { panelUrl }) }),
        opts(locale)
      );
    expect(render("approval", "en", PANEL)).toEqual({
      ok: true,
      message: { text: `A follow-up waits for your approval in the panel.\nOpen in panel: ${PANEL}`, buttons: [] },
    });
    expect(render("approval", "pl", PANEL)).toEqual({
      ok: true,
      message: {
        text: `Przypomnienie o odpowiedzi czeka na Twoje zatwierdzenie w panelu.\nOtwórz w panelu: ${PANEL}`,
        buttons: [],
      },
    });
    expect(render("result", "en")).toEqual({
      ok: true,
      message: { text: "A follow-up has a new result in the panel.", buttons: [] },
    });
    expect(render("result", "pl")).toEqual({
      ok: true,
      message: { text: "Jest nowy wynik dotyczący przypomnienia o odpowiedzi. Zobacz go w panelu.", buttons: [] },
    });
  });

  test("loop_consent: the strict view refuses a recipient, a subject, a loop id, a bad kind and a bad link", () => {
    for (const extra of [{ to: "a@b.test" }, { subject: "x" }, { loopId: LOOP }, { text: "x" }]) {
      expect(renderNotice("loop_consent", { about: "approval", ...extra }, opts("en")).ok).toBe(false);
    }
    expect(renderNotice("loop_consent", { about: "other" }, opts("en")).ok).toBe(false);
    for (const panelUrl of [
      "javascript:alert(1)",
      "https://x.test/a b",
      "https://x.test/a\nb",
      `https://x.test/${"a".repeat(300)}`,
    ]) {
      expect(renderNotice("loop_consent", { about: "approval", panelUrl }, opts("en")).ok).toBe(false);
    }
  });
});
