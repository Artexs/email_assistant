import { describe, expect, test } from "bun:test";

import type { ApprovalView } from "../outgoing/sender";
import { textTables } from "../texts";

import { APPROVAL_QUOTE_CHARS, approvalEdit, renderApprovalRequest, renderSendResult } from "./approvals";
import { ID, NOW, TZ, CONTROL, view, request } from "./approvals.test-helper";
import { parseCallback } from "./callback";
import { MESSAGE_MAX_CHARS } from "./message";

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
