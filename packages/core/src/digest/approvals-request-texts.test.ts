import { describe, expect, test } from "bun:test";

import type { ApprovalView } from "../outgoing/sender";
import { textTables } from "../texts";

import { renderApprovalRequest, renderSendResult } from "./approvals";
import { ID, NOW, TZ, view, request } from "./approvals.test-helper";
import { parseCallback } from "./callback";
import { MESSAGE_MAX_CHARS } from "./message";

const PANEL_URL = "https://ea.example.ts.net/approvals?id=7f1c0d1e-0000-4000-8000-000000000001";

const SEND_LINE_EN = "The system sends it after your tap. Do not send the draft from your mail client.";

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
