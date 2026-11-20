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

describe("renderApprovalRequest, a reply (F115)", () => {
  const reply = (overrides: Partial<ApprovalView> = {}) =>
    view({
      kind: "reply",
      recipient: { name: null, address: "jan@client.test" },
      subject: "Re: Offer",
      dueDate: null,
      to: ["jan@client.test"],
      cc: [],
      ...overrides,
    });

  test("the title is the reply mark and the address; en and pl", () => {
    expect(request(reply()).text.split("\n")[0]).toBe("✍️ Reply to jan@client.test");
    const pl = renderApprovalRequest({ actionId: ID, view: reply(), now: NOW, timeZone: TZ }, textTables.pl);
    expect(pl.text.split("\n")[0]).toBe("✍️ Odpowiedź do jan@client.test");
  });

  test("a reply card spells out To, Cc and a Reply-To that differs from the From; a plain reply has To only", () => {
    const plain = request(reply()).text;
    expect(plain).toContain("\nTo: jan@client.test\n");
    expect(plain).not.toContain("Cc:");
    expect(plain).not.toContain("Reply-To:");
    const text = request(reply({ cc: ["b@y.test", "c@y.test"], replyTo: ["team@client.test"] })).text;
    expect(text).toContain("\nTo: jan@client.test\nCc: b@y.test, c@y.test\nReply-To: team@client.test\n");
    const pl = renderApprovalRequest(
      { actionId: ID, view: reply({ cc: ["b@y.test"] }), now: NOW, timeZone: TZ },
      textTables.pl
    );
    expect(pl.text).toContain("\nDo: jan@client.test\nDW: b@y.test\n");
  });

  test("a reply with one gap: the gap line comes before the draft, there is no Send button; Reject and Skip stay (en and pl)", () => {
    for (const texts of [textTables.en, textTables.pl]) {
      const message = renderApprovalRequest(
        {
          actionId: ID,
          view: reply({ gaps: ["the price", "the date"], body: "Hello [[the price]]" }),
          now: NOW,
          timeZone: TZ,
        },
        texts
      );
      const lines = message.text.split("\n");
      const gapLine = lines.findIndex((line) => line.includes("the price; the date"));
      expect(gapLine).toBeGreaterThan(0);
      expect(gapLine).toBeLessThan(lines.indexOf(texts.approvals.draft));
      const data = message.buttons[0]?.map((button) => parseCallback(button.data)?.kind);
      expect(data).toEqual(["reject", "reply_skip"]);
      // Redraft stays: a new text is the way to fill a gap.
      expect(message.buttons[1]?.map((button) => parseCallback(button.data)?.kind)).toEqual(["reply_redraft"]);
    }
  });

  test("the gap line and the end line of the review say where to fill and that no draft is left (en and pl, fixed wording)", () => {
    expect(textTables.en.approvals.reply.fill("a; b")).toBe(
      "⚠️ Fill these: a; b. Fill them in the panel; you cannot send this draft until then."
    );
    expect(textTables.pl.approvals.reply.fill("a; b")).toBe(
      "⚠️ Uzupełnij: a; b. Zrób to w panelu; do tego czasu nie możesz wysłać tego szkicu."
    );
    expect(textTables.en.approvals.reply.noMore).toBe("No more replies waiting.");
    expect(textTables.pl.approvals.reply.noMore).toBe("Nie ma więcej szkiców odpowiedzi do przejrzenia.");
  });

  test("a reply without gaps has Send, Reject and Skip, in this order; Skip names the send", () => {
    const message = request(reply({ gaps: [] }));
    expect(message.buttons).toEqual([
      [
        { text: "📤 Send", data: `ap:${ID}` },
        { text: "✖️ Reject", data: `ar:${ID}` },
        { text: "⏭ Skip", data: `rk:${ID}` },
      ],
      [{ text: "✍️ Redraft", data: `rd:${ID}` }],
    ]);
    expect(request(reply()).buttons[0]?.map((button) => button.data)).toEqual([`ap:${ID}`, `ar:${ID}`, `rk:${ID}`]);
  });

  test("Reply all and Use Reply-To show only when the view says so; the texts are fixed (en and pl)", () => {
    const rows = (over: Parameters<typeof reply>[0], texts = textTables.en) =>
      renderApprovalRequest({ actionId: ID, view: reply(over), now: NOW, timeZone: TZ }, texts).buttons[1];
    expect(rows({})?.map((button) => button.data)).toEqual([`rd:${ID}`]);
    expect(rows({ canReplyAll: true })?.map((button) => button.data)).toEqual([`rd:${ID}`, `ra:${ID}`]);
    expect(rows({ canUseReplyTo: true })?.map((button) => button.data)).toEqual([`rd:${ID}`, `ru:${ID}`]);
    expect(rows({ canReplyAll: true, canUseReplyTo: true })?.map((button) => button.text)).toEqual([
      "✍️ Redraft",
      "👥 Reply all",
      "↩️ Use Reply-To",
    ]);
    expect(rows({ canReplyAll: true, canUseReplyTo: true }, textTables.pl)?.map((button) => button.text)).toEqual([
      "✍️ Napisz inaczej",
      "👥 Odpowiedz wszystkim",
      "↩️ Użyj Reply-To",
    ]);
  });

  test("a kind other than a reply has no change row", () => {
    expect(request(view()).buttons).toHaveLength(1);
  });

  test("a reply says that the Sent mail is not read only when the view says so (en and pl)", () => {
    expect(request(reply()).text).not.toContain("sent mail");
    expect(request(reply({ sentVisible: false })).text).toEndWith(
      "I cannot see your sent mail; check you did not answer already."
    );
    const pl = renderApprovalRequest(
      { actionId: ID, view: reply({ sentVisible: false }), now: NOW, timeZone: TZ },
      textTables.pl
    );
    expect(pl.text).toEndWith("Nie widzę Twojej wysłanej poczty. Sprawdź, czy ta wiadomość nie ma już odpowiedzi.");
    // Another kind never prints the line.
    expect(request(view({ sentVisible: false })).text).not.toContain("sent mail");
  });

  test("the quote shrinks first: a long quote leaves the gap line, the recipients and the whole body in the card", () => {
    const body = `Dear Jan,\n\n${"A long answer. ".repeat(100)}[[the date]]`;
    const message = request(
      reply({
        body,
        gaps: ["the date"],
        cc: ["b@y.test"],
        replyTo: ["team@client.test"],
        quote: { text: `> ${"quoted ".repeat(900)}`, cut: false },
      })
    );
    expect(message.text.length).toBeLessThanOrEqual(MESSAGE_MAX_CHARS);
    expect(message.text).toContain(body);
    expect(message.text).toContain("Fill these: the date");
    expect(message.text).toContain("Cc: b@y.test");
    expect(message.text).toContain("(quote cut");
  });

  test("an approval edit with the outcome skipped keeps the card text, adds one line and drops every button", () => {
    const edited = approvalEdit({ original: "card", outcome: "skipped", at: NOW, timeZone: TZ }, textTables.en);
    expect(edited).toEqual({ text: "card\n\n⏭ Skipped 11:00. The draft stays in the panel.", buttons: [] });
    expect(approvalEdit({ original: "card", outcome: "skipped", at: NOW, timeZone: TZ }, textTables.pl).text).toBe(
      "card\n\n⏭ Pominięto 11:00. Szkic zostaje w panelu."
    );
  });

  test("a reply that nobody approved in 7 days says 7 days, not the 48 h of the other kinds (en and pl)", () => {
    const expired = (sendKind: "reply" | "delegation", texts: typeof textTables.en) =>
      renderSendResult(
        {
          actionId: ID,
          sendKind,
          result: { kind: "expired", reason: "timeout", draftRemoved: true },
          recipient: { name: null, address: "jan@client.test" },
          subject: "Re: Offer",
          synthetic: false,
        },
        texts
      ).text.split("\n")[0];
    expect(expired("reply", textTables.en)).toBe("⌛ Not sent: nobody approved the draft in 7 days · Re: Offer");
    expect(expired("reply", textTables.pl)).toBe(
      "⌛ Nie wysłano: nikt nie zatwierdził szkicu w ciągu 7 dni · Re: Offer"
    );
    expect(expired("delegation", textTables.en)).toContain("(48 h)");
  });

  test("the result lines of a reply have no closing line", () => {
    const sent = renderSendResult(
      {
        actionId: ID,
        sendKind: "reply",
        result: { kind: "sent", sentCopy: "appended", draftRemoved: true },
        recipient: { name: null, address: "jan@client.test" },
        subject: "Re: Offer",
        synthetic: false,
      },
      textTables.en
    );
    expect(sent.text).toContain("Re: Offer");
    expect(sent.text).not.toContain("delegation");
    expect(sent.text).not.toContain("undefined");
    expect(sent.text).not.toContain("stays open");
  });
});

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

describe("renderApprovalRequest with an edited body", () => {
  test("T10 a 3000-character body and an 8000-character quote fit in one message", () => {
    const body = `${"x".repeat(99)}\n`.repeat(30).slice(0, 3000);
    expect(body.length).toBe(3000);
    const message = request(view({ body, quote: { text: "q".repeat(8000), cut: false } }));
    expect(message.text.length).toBeLessThanOrEqual(MESSAGE_MAX_CHARS);
    expect(message.text).toContain("x".repeat(90));
    expect(message.text).toContain("Quoted original:");
  });
});

describe("the texts of the copy check (the mail client edit)", () => {
  test("the two card lines, in English and in Polish", () => {
    expect(textTables.en.approvals.sendLine).toBe(
      "The system sends it after your tap. Do not send the draft from your mail client."
    );
    expect(textTables.pl.approvals.sendLine).toBe(
      "System wyśle wiadomość po naciśnięciu przycisku. Nie wysyłaj szkicu z programu pocztowego."
    );
    expect(textTables.en.approvals.sendLineEditable).toBe(
      "The system sends it after your tap. Edit here, or edit and send in your mail client."
    );
    expect(textTables.pl.approvals.sendLineEditable).toBe(
      "System wyśle wiadomość po naciśnięciu przycisku. Edytuj tutaj albo edytuj i wyślij w programie pocztowym."
    );
  });

  test("N1: the editable line shows for a reply, or for any kind while the flag is on; the other cards keep the old line", () => {
    const line = (over: Partial<ApprovalView>, lang: "en" | "pl") =>
      renderApprovalRequest({ actionId: ID, view: view(over), now: NOW, timeZone: TZ }, textTables[lang]).text;
    for (const lang of ["en", "pl"] as const) {
      const a = textTables[lang].approvals;
      expect(line({}, lang).endsWith(a.sendLine)).toBe(true);
      expect(line({ kind: "clarification" }, lang).endsWith(a.sendLine)).toBe(true);
      expect(line({ kind: "reply" }, lang).endsWith(a.sendLineEditable)).toBe(true);
      expect(line({ copyCheck: true }, lang).endsWith(a.sendLineEditable)).toBe(true);
      expect(line({ kind: "clarification", copyCheck: true }, lang).endsWith(a.sendLineEditable)).toBe(true);
    }
  });

  test("a failed send with the cause copy_check says the draft could not be read and offers Send again (en, pl)", () => {
    for (const [lang, text] of [
      ["en", "The system could not read the draft in your mailbox; nothing was sent"],
      ["pl", "System nie mógł odczytać szkicu w Twojej skrzynce; nic nie wysłano"],
    ] as const) {
      const message = renderSendResult(
        {
          actionId: ID,
          sendKind: "reply",
          result: { kind: "failed", cause: "copy_check", code: null, tries: 3 },
          recipient: { name: null, address: "anna@example.com" },
          subject: "Fwd: Offer",
          synthetic: false,
        },
        textTables[lang]
      );
      expect(message.text).toContain(text);
      expect(message.buttons).toHaveLength(1);
    }
  });

  test("the result of a changed draft says the user edited it and must send it from the mail client", () => {
    expect(textTables.en.approvals.sendResult.expired.draft_changed("Fwd: Offer")).toBe(
      "✏️ You edited this draft in your mail client. Send it from there. · Fwd: Offer"
    );
    expect(textTables.pl.approvals.sendResult.expired.draft_changed("Fwd: Offer")).toBe(
      "✏️ Szkic został zmieniony w programie pocztowym. Wyślij go stamtąd. · Fwd: Offer"
    );
    expect(textTables.en.approvals.followUp.expired.draft_changed).toBe(
      "✏️ Follow-up not sent: you edited this draft in your mail client. Send it from there."
    );
    expect(textTables.pl.approvals.followUp.expired.draft_changed).toContain("Wyślij go stamtąd.");
  });

  test("a missing copy is not told as a failed draft (the user may have sent or deleted it)", () => {
    for (const lang of ["en", "pl"] as const) {
      const text = textTables[lang].approvals.sendResult.expired.draft_missing("Fwd: Offer");
      expect(text).not.toContain("could not be created");
      expect(text).not.toContain("nie udało się utworzyć");
      expect(text).toContain("Drafts");
    }
  });

  test("the texts of the reply close reasons say that nothing was sent (en, pl)", () => {
    const reasons = ["answered", "sent_by_user", "newer_mail", "original_moved", "suspicious"] as const;
    // `answered` and `sent_by_user` say "The system sent nothing", as the panel does (a user may have sent the reply).
    const bySystem = new Set(["answered", "sent_by_user"]);
    for (const reason of reasons) {
      expect(textTables.en.approvals.sendResult.expired[reason]("S")).toContain(
        bySystem.has(reason) ? "The system sent nothing." : "Nothing was sent."
      );
      expect(textTables.pl.approvals.sendResult.expired[reason]("S")).toContain(
        bySystem.has(reason) ? "System nic nie wysłał." : "Nic nie wysłano."
      );
    }
    expect(textTables.en.approvals.sendResult.expired.answered("S")).toBe(
      "⌛ You already answered this mail. The system sent nothing. · S"
    );
    expect(textTables.pl.approvals.sendResult.expired.answered("S")).toBe(
      "⌛ Na tę wiadomość już odpowiedziano. System nic nie wysłał. · S"
    );
  });

  test("newer_mail and suspicious say what to do next; original_moved says moved, not inbox (en, pl)", () => {
    const en = textTables.en.approvals.sendResult.expired;
    const pl = textTables.pl.approvals.sendResult.expired;
    expect(en.newer_mail("S")).toContain("Read the newer mail; a new draft may follow.");
    expect(en.suspicious("S")).toContain("a new draft may follow");
    expect(pl.newer_mail("S")).toContain("Przeczytaj nowszą wiadomość; może pojawić się nowy szkic.");
    expect(pl.suspicious("S")).toContain("może pojawić się nowy szkic");
    expect(en.original_moved("S")).toContain("moved");
    expect(en.original_moved("S")).not.toContain("inbox");
    expect(pl.original_moved("S")).toContain("przeniesiono");
    expect(pl.original_moved("S")).not.toContain("odbiorcz");
  });
});

const PANEL_URL = "https://ea.example.ts.net/approvals?id=7f1c0d1e-0000-4000-8000-000000000001";
const SEND_LINE_EN = "The system sends it after your tap. Do not send the draft from your mail client.";

describe("renderApprovalRequest version line and panel link", () => {
  test("T1 a view without the new fields has no version line and no panel line", () => {
    const en = request(view()).text;
    expect(en).not.toContain("Version");
    expect(en).not.toContain("Open in panel");
    expect(en.split("\n")[1]).toBe("From: boss@client.test · ⚠️ external sender");
    expect(en.endsWith(`\n\n${SEND_LINE_EN}`)).toBe(true);
    const pl = renderApprovalRequest({ actionId: ID, view: view(), now: NOW, timeZone: TZ }, textTables.pl).text;
    expect(pl).not.toContain("zmieniona w panelu");
    expect(pl).not.toContain("Otwórz w panelu");
  });

  test("T1 version 1 shows no version line", () => {
    expect(request(view({ version: 1 })).text).toBe(request(view()).text);
  });

  test("T2 version 2 adds the version line as the second line", () => {
    const lines = request(view({ version: 2 })).text.split("\n");
    expect(lines[0]).toBe("📤 Send? Delegation to Anna Nowak anna@example.com");
    expect(lines[1]).toBe("✏️ Version 2.");
    expect(lines[2]).toBe("From: boss@client.test · ⚠️ external sender");
    const pl = renderApprovalRequest(
      { actionId: ID, view: view({ version: 3 }), now: NOW, timeZone: TZ },
      textTables.pl
    );
    expect(pl.text.split("\n")[1]).toBe("✏️ Wersja 3.");
  });

  test("T3 the panel link stands directly above the send line", () => {
    const en = request(view({ panelUrl: PANEL_URL })).text;
    expect(en.endsWith(`\n\nOpen in panel: ${PANEL_URL}\n${SEND_LINE_EN}`)).toBe(true);
    const pl = renderApprovalRequest(
      { actionId: ID, view: view({ panelUrl: PANEL_URL }), now: NOW, timeZone: TZ },
      textTables.pl
    );
    expect(pl.text).toContain(`\nOtwórz w panelu: ${PANEL_URL}\nSystem wyśle wiadomość`);
  });

  test("T4 a 3000-character body, an 8000-character quote and both fields fit and keep both lines", () => {
    const body = `${"x".repeat(99)}\n`.repeat(30).slice(0, 3000);
    const long = view({
      body,
      quote: { text: "q".repeat(8000), cut: false },
      version: 12,
      panelUrl: `https://ea.example.ts.net/${"a".repeat(270)}`,
    });
    for (const texts of [textTables.en, textTables.pl]) {
      const message = renderApprovalRequest({ actionId: ID, view: long, now: NOW, timeZone: TZ }, texts);
      expect(message.text.length).toBeLessThanOrEqual(MESSAGE_MAX_CHARS);
      expect(message.text).toContain(texts.approvals.versionLine(12));
      expect(message.text).toContain(texts.approvals.panelLine(long.panelUrl ?? ""));
      expect(message.text).toContain("x".repeat(90));
    }
  });

  test("T4 the body guard keeps both lines when there is no quote", () => {
    const long = view({ body: "x".repeat(5000), quote: null, version: 2, panelUrl: PANEL_URL });
    const message = request(long);
    expect(message.text.length).toBeLessThanOrEqual(MESSAGE_MAX_CHARS);
    expect(message.text).toContain("✏️ Version 2.");
    expect(message.text).toContain(`Open in panel: ${PANEL_URL}`);
  });
});

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
const sendKinds: SendKind[] = ["delegation", "clarification", "reminder", "reply"];
const closings: Record<SendKind, string> = {
  delegation: "The delegation was cancelled.",
  clarification: "",
  reminder: "The delegation stays open.",
  follow_up: "",
  reply: "",
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

// The whole text of each card: one fixed view per branch, one expected line per row.
describe("renderApprovalRequest, the whole card text", () => {
  const FIXED_NOW = new Date("2026-03-02T09:00:00Z");
  const render = (overrides: Partial<ApprovalView>, locale: "en" | "pl" = "en") =>
    renderApprovalRequest(
      { actionId: ID, view: view({ dueDate: "2026-03-09", ...overrides }), now: FIXED_NOW, timeZone: TZ },
      textTables[locale]
    );
  const card = (overrides: Partial<ApprovalView>, locale: "en" | "pl" = "en") =>
    render(overrides, locale).text.split("\n");
  const SEND_LINE = "The system sends it after your tap. Do not send the draft from your mail client.";
  const DRAFT = ["", "Draft:", "Hi Anna,", "", "Please check the offer.", "", "Thanks"];
  const EXTERNAL = "From: boss@client.test · ⚠️ external sender";

  test("a delegation: title, sender, subject, due date, draft, quote, send line", () => {
    expect(card({})).toEqual([
      "📤 Send? Delegation to Anna Nowak anna@example.com",
      EXTERNAL,
      "Subject: Fwd: Offer",
      "Due: 2026-03-09",
      ...DRAFT,
      "",
      "Quoted original:",
      "> Hello",
      "> World",
      "",
      SEND_LINE,
    ]);
  });

  test("an inactive delegate on a test mail from an internal sender, at version 2: the version line is second", () => {
    expect(
      card({
        recipientInactive: true,
        synthetic: true,
        version: 2,
        sender: { label: "me@firm.test", external: false },
        dueDate: null,
        quote: null,
      })
    ).toEqual([
      "📤 Send? Delegation to Anna Nowak (inactive) anna@example.com · 🧪 test",
      "✏️ Version 2.",
      "From: me@firm.test",
      "Subject: Fwd: Offer",
      ...DRAFT,
      "",
      SEND_LINE,
    ]);
  });

  test("version 1 has no version line", () => {
    expect(card({ version: 1, quote: null }).slice(0, 3)).toEqual([
      "📤 Send? Delegation to Anna Nowak anna@example.com",
      EXTERNAL,
      "Subject: Fwd: Offer",
    ]);
  });

  test.each([
    [
      "a clarification",
      { kind: "clarification" as const, recipient: { name: null, address: "boss@client.test" } },
      ["📤 Send? Question to the sender boss@client.test", EXTERNAL],
    ],
    [
      "a reminder with a name",
      { kind: "reminder" as const, sender: null },
      ["📤 Send? Reminder to Anna Nowak anna@example.com"],
    ],
    [
      "a reminder without a name",
      { kind: "reminder" as const, sender: null, recipient: { name: null, address: "anna@example.com" } },
      ["📤 Send? Reminder to anna@example.com"],
    ],
    [
      "a delegation without a name",
      { recipient: { name: null, address: "anna@example.com" } },
      ["📤 Send? Delegation to anna@example.com", EXTERNAL],
    ],
  ])("%s: the head, the draft and the send line, no quote", (_name, overrides, head) => {
    expect(card({ ...overrides, quote: null })).toEqual([
      ...head,
      "Subject: Fwd: Offer",
      "Due: 2026-03-09",
      ...DRAFT,
      "",
      SEND_LINE,
    ]);
  });

  test("a follow-up has no sender line; To, Cc and the number line sit around the subject", () => {
    expect(
      card({
        kind: "follow_up",
        sender: null,
        dueDate: null,
        quote: null,
        to: ["a@x.test", "b@x.test"],
        cc: ["c@x.test"],
        followUpNumber: 2,
      })
    ).toEqual([
      "📝 Follow-up",
      "To: a@x.test, b@x.test",
      "Cc: c@x.test",
      "Subject: Fwd: Offer",
      "Follow-up 2 of 2",
      ...DRAFT,
      "",
      SEND_LINE,
    ]);
  });

  test("a follow-up without a number has no number line; a delegation never has one", () => {
    const followUp = { kind: "follow_up" as const, sender: null, dueDate: null, quote: null, to: ["a@x.test"] };
    expect(card(followUp).slice(0, 4)).toEqual(["📝 Follow-up", "To: a@x.test", "Subject: Fwd: Offer", ""]);
    expect(card({ followUpNumber: 1, quote: null })).not.toContain("Follow-up 1 of 2");
  });

  test("gaps in the view of another kind than a reply add no fill line", () => {
    expect(card({ gaps: ["termin"], quote: null })).not.toContain(
      "⚠️ Fill these: termin. Fill them in the panel; you cannot send this draft until then."
    );
  });

  describe("a reply", () => {
    const reply = (overrides: Partial<ApprovalView> = {}, locale: "en" | "pl" = "en") =>
      card(
        {
          kind: "reply",
          recipient: { name: null, address: "jan@client.test" },
          dueDate: null,
          quote: null,
          to: ["jan@client.test"],
          cc: [],
          ...overrides,
        },
        locale
      );
    const EDITABLE = "The system sends it after your tap. Edit here, or edit and send in your mail client.";

    test("To, Cc and a Reply-To are one line each in that order; the gaps come before the draft", () => {
      expect(
        reply({
          cc: ["k@x.test"],
          replyTo: ["r@x.test"],
          gaps: ["termin", "kwota"],
          panelUrl: "https://ea.example.ts.net/approvals?id=1",
          sentVisible: false,
        })
      ).toEqual([
        "✍️ Reply to jan@client.test",
        "To: jan@client.test",
        "Cc: k@x.test",
        "Reply-To: r@x.test",
        EXTERNAL,
        "Subject: Fwd: Offer",
        "",
        "⚠️ Fill these: termin; kwota. Fill them in the panel; you cannot send this draft until then.",
        ...DRAFT,
        "",
        "Open in panel: https://ea.example.ts.net/approvals?id=1",
        EDITABLE,
        "I cannot see your sent mail; check you did not answer already.",
      ]);
    });

    test("a reply without a Cc, a Reply-To and gaps has the To line only and no fill line", () => {
      expect(reply({ replyTo: [], gaps: [] })).toEqual([
        "✍️ Reply to jan@client.test",
        "To: jan@client.test",
        EXTERNAL,
        "Subject: Fwd: Offer",
        ...DRAFT,
        "",
        EDITABLE,
      ]);
    });

    test("the stored English unknown-sender label prints as the Polish placeholder", () => {
      expect(reply({ sender: { label: "(unknown sender)", external: false } }, "pl")).toEqual([
        "✍️ Odpowiedź do jan@client.test",
        "Do: jan@client.test",
        "Od: (nieznany nadawca)",
        "Temat: Fwd: Offer",
        "",
        "Szkic:",
        "Hi Anna,",
        "",
        "Please check the offer.",
        "",
        "Thanks",
        "",
        "System wyśle wiadomość po naciśnięciu przycisku. Edytuj tutaj albo edytuj i wyślij w programie pocztowym.",
      ]);
    });

    test("several To and Reply-To addresses are joined with a comma and a space", () => {
      expect(reply({ to: ["a@x.test", "b@x.test"], replyTo: ["r@x.test", "s@x.test"] }).slice(1, 4)).toEqual([
        "To: a@x.test, b@x.test",
        "Reply-To: r@x.test, s@x.test",
        EXTERNAL,
      ]);
    });

    test("a reply view without a To list names the recipient address", () => {
      expect(reply({ to: undefined }).slice(0, 3)).toEqual([
        "✍️ Reply to jan@client.test",
        "To: jan@client.test",
        EXTERNAL,
      ]);
    });

    test("the recipient lines of exactly 2400 characters fit; one more is refused", () => {
      const address = (length: number) => `${"a".repeat(length - "@x.test".length)}@x.test`;
      const recipients = (toLength: number) => ({ to: [address(toLength)], cc: ["c@x.test"] });
      // "To: " + address + a line break + "Cc: c@x.test" (12 characters)
      const fits = reply(recipients(2400 - "To: ".length - 1 - 12));
      expect(fits[1]?.length).toBe(2400 - 1 - 12);
      expect(() => reply(recipients(2400 - "To: ".length - 1 - 12 + 1))).toThrow(
        new RangeError("the recipients of a reply do not fit a card")
      );
    });
  });

  describe("the quote", () => {
    const quoted = (text: string, cut = false) =>
      card({ quote: { text, cut } }).slice(card({ quote: null }).length - 2);

    test("the header keeps the bare address; the body shows no link and no address; the note says links are hidden", () => {
      expect(quoted("Od: Jan <jan@firma.pl>\nDW: ola@firma.pl\n\nwww.firma.pl i jan@firma.pl")).toEqual([
        "",
        "Quoted original:",
        "Od: Jan <jan@firma.pl>",
        "DW: ola@[link]",
        "",
        "[link] i jan@[link]",
        "(links shown as [link]; the draft has them)",
        "",
        SEND_LINE,
      ]);
    });

    test("a quote without a blank line is all header: a sender line keeps its address, any other line loses its links", () => {
      expect(quoted("Subject: www.firma.pl\nFrom: Jan <jan@firma.pl>")).toEqual([
        "",
        "Quoted original:",
        "Subject: [link]",
        "From: Jan <jan@firma.pl>",
        "(links shown as [link]; the draft has them)",
        "",
        SEND_LINE,
      ]);
    });

    test("a sender line below the blank line is body text: its address is hidden", () => {
      expect(quoted("Subject: x\n\nFrom: Jan <jan@firma.pl>")).toEqual([
        "",
        "Quoted original:",
        "Subject: x",
        "",
        "From: Jan <jan@[link]>",
        "(links shown as [link]; the draft has them)",
        "",
        SEND_LINE,
      ]);
    });

    test("a quote that was cut before shows the cut note and no links note", () => {
      expect(quoted("plain", true)).toEqual([
        "",
        "Quoted original:",
        "plain",
        "(quote cut; the draft has the full text)",
        "",
        SEND_LINE,
      ]);
    });
  });

  describe("the size limit", () => {
    const limitCard = (body: string, quote: { text: string; cut: boolean } | null) => render({ body, quote }).text;
    const bodyLine = (text: string) => text.split("\n")[6];

    test("a card of exactly 4096 characters is kept whole", () => {
      const text = limitCard("b".repeat(3875), null);
      expect(text.length).toBe(4096);
      expect(bodyLine(text)).toBe("b".repeat(3875));
      expect(text).not.toContain("draft text cut");
    });

    test("a card of 4097 characters without a quote cuts the end of the body and adds the note", () => {
      const text = limitCard("b".repeat(3876), null);
      expect(text.length).toBe(4095);
      expect(bodyLine(text)).toBe(`${"b".repeat(3825)}…`);
      expect(text.split("\n").slice(7, 9)).toEqual(["(draft text cut; the full text is in the draft)", ""]);
    });

    test("a long quote shrinks to the room that is left; the body stays whole", () => {
      const lines = limitCard("b".repeat(3000), { text: "q".repeat(8000), cut: false }).split("\n");
      expect(lines.slice(6, 11)).toEqual([
        "b".repeat(3000),
        "",
        "Quoted original:",
        "q".repeat(815),
        "(quote cut; the draft has the full text)",
      ]);
    });

    test("a quote whose links grow when they are hidden shrinks by the whole overflow of its first cut", () => {
      const lines = limitCard("b".repeat(2500), { text: "x.pl ".repeat(1600), cut: false }).split("\n");
      expect(lines.slice(8, 12)).toEqual([
        "Quoted original:",
        `${"[link] ".repeat(134)}x`,
        "(links shown as [link]; the draft has them)",
        "(quote cut; the draft has the full text)",
      ]);
    });

    test("a quote of 100 characters that fits an exactly full card keeps its text and has no cut note", () => {
      const text = limitCard("b".repeat(3756), { text: "q".repeat(100), cut: false });
      expect(text.length).toBe(4096);
      expect(text.split("\n").slice(8, 10)).toEqual(["Quoted original:", "q".repeat(100)]);
      expect(text).not.toContain("quote cut");
    });

    test("a body too long even for an empty quote is cut; the quote note stays in the card", () => {
      const text = limitCard("b".repeat(4000), { text: "q".repeat(8000), cut: false });
      expect(text.length).toBe(4095);
      expect(text.split("\n").slice(6, 13)).toEqual([
        `${"b".repeat(3765)}…`,
        "(draft text cut; the full text is in the draft)",
        "",
        "Quoted original:",
        "",
        "(quote cut; the draft has the full text)",
        "",
      ]);
    });

    test("the room of the body is cut at 3896 characters on a short card", () => {
      const text = render({
        kind: "reminder",
        sender: null,
        recipient: { name: null, address: "a@x.test" },
        subject: "S",
        dueDate: null,
        quote: null,
        body: "b".repeat(5000),
      }).text;
      expect(text.split("\n")[4]).toBe(`${"b".repeat(3895)}…`);
    });

    test("a panel link that leaves no room for the card is refused", () => {
      expect(() => render({ panelUrl: `https://ea.example.ts.net/${"a".repeat(4100)}` })).toThrow(
        new RangeError("the approval card does not fit one message")
      );
    });
  });
});

describe("renderApprovalSetRequest, the whole text", () => {
  const set = (items: ReturnType<typeof item>[], locale: "en" | "pl" = "en") =>
    renderApprovalSetRequest({ setId: SET_ID, items, timeZone: TZ }, textTables[locale]).text;
  const address = (length: number) => `${"a".repeat(length - "@x.test".length)}@x.test`;
  // Ten items whose first-level text is exactly 4096 characters when `lastAddress` is 44 characters long.
  const tenItems = (lastAddress: number) =>
    Array.from({ length: 10 }, (_, index) =>
      item(index + 1, {
        delegateName: "N".repeat(80),
        address: address(index === 9 ? lastAddress : 50),
        subject: "s".repeat(80),
        dueAt: null,
        task: "t".repeat(150),
      })
    );

  test("two items: header, one block per item with and without a due day, both footer lines", () => {
    expect(set([item(1), item(2, { dueAt: null, reminder: 2 })]).split("\n")).toEqual([
      "📤 Send 2 reminders?",
      "",
      "1. Anna 1 anna1@example.com — Offer 1 (due Thu 5 Nov, reminder 1 of 2)",
      "   Task: check offer 1",
      "2. Anna 2 anna2@example.com — Offer 2 (reminder 2 of 2)",
      "   Task: check offer 2",
      "",
      "Each reminder is the fixed reminder template with this task; it quotes nothing.",
      "The system sends them after your tap.",
    ]);
  });

  test.each([
    [0, "a reminder set has 1 to 10 items, got 0"],
    [11, "a reminder set has 1 to 10 items, got 11"],
  ])("%d items is refused with a message that names the limits", (count, message) => {
    const items = Array.from({ length: count }, (_, index) => item(index + 1));
    expect(() => set(items)).toThrow(new RangeError(message));
  });

  test("a text of exactly 4096 characters keeps the full task of every item", () => {
    const text = set(tenItems(44));
    expect(text.length).toBe(4096);
    expect(text.split("\n")[3]).toBe(`   Task: ${"t".repeat(150)}`);
  });

  test("one character more makes every task shrink to 40 characters, none drops out", () => {
    const text = set(tenItems(45));
    expect(text.length).toBe(2997);
    expect(text.split("\n")[3]).toBe(`   Task: ${"t".repeat(39)}…`);
    expect(text.split("\n").filter((line) => /^\d+\. /.test(line))).toHaveLength(10);
  });
});
