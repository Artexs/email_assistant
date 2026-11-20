import { describe, expect, test } from "bun:test";

import type { ApprovalView } from "../outgoing/sender";
import { textTables } from "../texts";

import { renderApprovalRequest } from "./approvals";
import { ID, TZ, view } from "./approvals.test-helper";

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

    test("an empty quote on a card with a body over the limit shows no quote block and no cut note", () => {
      const lines = card({ body: "b".repeat(4200), quote: { text: "", cut: false } });
      expect(lines.map((line) => (line.startsWith("bbbb") ? `body of ${line.length} characters` : line))).toEqual([
        "📤 Send? Delegation to Anna Nowak anna@example.com",
        EXTERNAL,
        "Subject: Fwd: Offer",
        "Due: 2026-03-09",
        "",
        "Draft:",
        "body of 3826 characters",
        "(draft text cut; the full text is in the draft)",
        "",
        SEND_LINE,
      ]);
    });

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
