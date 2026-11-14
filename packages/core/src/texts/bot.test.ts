import { describe, expect, test } from "bun:test";

import { textTables } from "./index";

const EN_HELP = [
  "Commands:",
  "/digest – the digest now",
  "/status – mailboxes, last sync, LLM calls",
  "/pause – stop reading and triage of your mailboxes",
  "/resume – start them again",
  "/review – label a random sample of recent mail",
  "/help – this list",
  "Tap ✅ when the AI category is right, ✏️ to correct it.",
  "↩️ under a digest line undoes what the system did to that mail (7 days).",
  "📤 under an approval sends the draft; ✖️ rejects it (the draft is removed).",
  "✅ Done under an answered delegation closes it.",
].join("\n");

describe("bot texts", () => {
  test("1. the English help equals the old helpText() byte for byte; linked and alreadyLinked end with it", () => {
    const en = textTables.en.bot;
    expect(en.help).toBe(EN_HELP);
    expect(en.linked).toBe(`✅ This chat is linked. Digests and urgent notices come here.\n${EN_HELP}`);
    expect(en.alreadyLinked).toBe(`✅ This chat is linked already.\n${EN_HELP}`);
    for (const locale of ["en", "pl"] as const) {
      const bot = textTables[locale].bot;
      expect(bot.linked.endsWith(bot.help)).toBe(true);
      expect(bot.alreadyLinked.endsWith(bot.help)).toBe(true);
    }
    expect(en.linkUsed).toBe("This link was used already. Ask for a new link.");
    expect(en.linkExpired).toBe("This link has expired (a link works for 15 minutes). Ask for a new link.");
    expect(en.error).toBe("Something went wrong. Try again later.");
  });

  test("2. the Polish help starts with Polecenia: and names each command once", () => {
    const { help } = textTables.pl.bot;
    expect(help.startsWith("Polecenia:")).toBe(true);
    for (const name of ["/digest", "/status", "/pause", "/resume", "/review", "/help"]) {
      expect(help.split(name).length - 1, name).toBe(1);
    }
    expect(help).toContain("Stuknij ✅");
  });

  test("3. accountPaused names the contact, or the operator when there is none", () => {
    const prefix = "⏸ This account is paused. Nothing changes now. To resume it, contact";
    expect(textTables.en.bot.accountPaused(null)).toBe(`${prefix} the operator.`);
    expect(textTables.en.bot.accountPaused("ops@example.test")).toBe(`${prefix} ops@example.test.`);
    const pl = "⏸ To konto jest wstrzymane. Teraz nic się nie zmienia. Aby je wznowić, skontaktuj się z";
    expect(textTables.pl.bot.accountPaused(null)).toBe(`${pl} operatorem.`);
    expect(textTables.pl.bot.accountPaused("ops@example.test")).toBe(`${pl}: ops@example.test.`);
  });

  test("the menu entries: the English ones are the old BOT_COMMANDS descriptions", () => {
    expect(textTables.en.bot.commands).toEqual({
      digest: "The digest now",
      status: "Mailboxes, last sync, LLM calls",
      pause: "Stop reading and triage",
      resume: "Start reading and triage again",
      review: "Label a sample of recent mail",
      help: "The command list",
    });
  });

  test("the Polish empty /review text names the 30 days", () => {
    expect(textTables.pl.review.empty).toBe(
      "Brak wiadomości do przeglądu: każda wiadomość z ostatnich 30 dni ma etykietę."
    );
  });

  // The Polish count texts: the noun and the verb follow the count (1, 2, 5, 22).
  test("the Polish reminder-set texts agree with the count", () => {
    const { taps } = textTables.pl.bot;
    expect([1, 2, 5, 22].map((n) => taps.setApproved(n, 3))).toEqual([
      "⏳ 1 przypomnienie wyjdzie w ciągu minuty, pominięto: 3.",
      "⏳ 2 przypomnienia wyjdą w ciągu minuty, pominięto: 3.",
      "⏳ 5 przypomnień wyjdzie w ciągu minuty, pominięto: 3.",
      "⏳ 22 przypomnienia wyjdą w ciągu minuty, pominięto: 3.",
    ]);
    expect([1, 2, 5, 22].map((n) => taps.setApprovedHeld(n, 0, "NOTE"))).toEqual([
      "⏳ Zatwierdzono 1 przypomnienie, pominięto: 0. NOTE; /status pokazuje szczegóły.",
      "⏳ Zatwierdzono 2 przypomnienia, pominięto: 0. NOTE; /status pokazuje szczegóły.",
      "⏳ Zatwierdzono 5 przypomnień, pominięto: 0. NOTE; /status pokazuje szczegóły.",
      "⏳ Zatwierdzono 22 przypomnienia, pominięto: 0. NOTE; /status pokazuje szczegóły.",
    ]);
    expect([1, 2, 5, 22].map((n) => taps.setRejected(n))).toEqual([
      "✖️ Pominięto 1 przypomnienie.",
      "✖️ Pominięto 2 przypomnienia.",
      "✖️ Pominięto 5 przypomnień.",
      "✖️ Pominięto 22 przypomnienia.",
    ]);
  });

  test("the Polish status lines put no plural noun or verb before a count", () => {
    const { status } = textTables.pl.bot;
    expect([1, 2, 5, 22].map((n) => status.approvedSending(n))).toEqual([
      "zatwierdzono 1, trwa wysyłanie",
      "zatwierdzono 2, trwa wysyłanie",
      "zatwierdzono 5, trwa wysyłanie",
      "zatwierdzono 22, trwa wysyłanie",
    ]);
    for (const n of [1, 2, 5, 22]) {
      expect(status.approvedPaused(n)).toBe(`zatwierdzono ${n}, wysyłka czeka, bo skrzynka jest wstrzymana`);
      expect(status.approvedAuthError(n)).toBe(`zatwierdzono ${n}, wysyłka czeka, bo logowanie do skrzynki nie działa`);
      expect(status.approvedHeld(n, "all")).toBe(`zatwierdzono ${n}, wysyłka wstrzymana przez SEND_SCOPE=all`);
      expect(status.delegations(n, 0)).toBe(`Zlecenia: ${n} bez odpowiedzi, 0 po terminie`);
      expect(status.approvalsLine("Zatwierdzenia", n, { oldest: null, held: null })).toBe(
        `Zatwierdzenia: ${n} do Twojego stuknięcia`
      );
      expect(status.actions("all", { applied: n, undone: 0, failed: 0 })).toContain(
        `wykonano ${n}, cofnięto 0, z błędem 0`
      );
    }
  });

  test("the English count texts stay as they were", () => {
    const { taps, status } = textTables.en.bot;
    expect(taps.setApproved(1, 2)).toBe("⏳ 1 reminders go out within a minute, 2 skipped.");
    expect(taps.setApprovedHeld(1, 2, "NOTE")).toBe("⏳ 1 reminders approved, 2 skipped. NOTE; /status shows it.");
    expect(taps.setRejected(1)).toBe("✖️ 1 reminders skipped.");
    expect(status.delegations(1, 2)).toBe("Delegations: 1 waiting for a reply, 2 overdue");
    expect(status.approvalsLine("Approvals", 2, { oldest: "12:00", held: "1 approved, sending" })).toBe(
      "Approvals: 2 waiting for your tap (oldest 12:00) · 1 approved, sending"
    );
  });

  test("the /resume text names the sync interval; the minutes follow the count", () => {
    const en = textTables.en.bot.switch.resumedExplain;
    const pl = textTables.pl.bot.switch.resumedExplain;
    const tail = " Mail that came during the pause is read then; mail older than 7 days is not triaged.";
    expect(en(2)).toBe(`The next sync runs within 2 minutes.${tail}`);
    expect(en(1)).toStartWith("The next sync runs within 1 minute. ");
    expect(en(5)).toStartWith("The next sync runs within 5 minutes. ");
    expect(pl(1)).toStartWith("Następna synchronizacja ruszy najpóźniej za 1 minutę. ");
    expect(pl(2)).toStartWith("Następna synchronizacja ruszy najpóźniej za 2 minuty. ");
    expect(pl(3)).toStartWith("Następna synchronizacja ruszy najpóźniej za 3 minuty. ");
    expect(pl(4)).toStartWith("Następna synchronizacja ruszy najpóźniej za 4 minuty. ");
    expect(pl(5)).toStartWith("Następna synchronizacja ruszy najpóźniej za 5 minut. ");
    expect(pl(12)).toStartWith("Następna synchronizacja ruszy najpóźniej za 12 minut. ");
    for (const text of [en(2), pl(2)]) expect(text).not.toContain(":");
  });
});
