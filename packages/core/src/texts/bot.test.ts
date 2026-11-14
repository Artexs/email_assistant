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
});
