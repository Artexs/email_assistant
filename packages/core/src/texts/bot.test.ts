import { describe, expect, test } from "bun:test";

import { REPLY_BLOCK_REASONS } from "../replies/eligibility";

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

  // The two answers of a tap on a reply that cannot go out. Fixed values, so a wording change is a decision.
  test("the Polish tap texts for a reply with a gap and for the flag off", () => {
    const { taps } = textTables.pl.bot;
    expect(taps.hasGaps).toBe(
      "W tym szkicu jest jeszcze luka ([[…]]). Najpierw uzupełnij ją w panelu. Nic nie wysłano."
    );
    expect(taps.featureOff).toBe("Szkice odpowiedzi są wyłączone. Nic nie wysłano.");
    expect(textTables.en.bot.taps.hasGaps).toBe(
      "This draft still has a gap ([[…]]). Fill it in the panel first. Nothing was sent."
    );
    expect(textTables.en.bot.taps.featureOff).toBe("Reply drafts are switched off. Nothing was sent.");
  });

  // A reply lives 7 days and another send 48 h, so the expired tap text names no number of hours.
  test("the expired tap text says no hours, en and pl", () => {
    expect(textTables.en.bot.taps.expired).toBe("This approval expired. The mail was not sent.");
    expect(textTables.pl.bot.taps.expired).toBe("To zatwierdzenie wygasło. Wiadomość nie została wysłana.");
  });

  // The Polish count texts: the noun and the verb follow the count (1, 2, 5, 22).
  test("the Polish reminder-set texts agree with the count", () => {
    const { taps } = textTables.pl.bot;
    expect([1, 2, 5, 22].map((n) => taps.setApproved(n, 3))).toEqual([
      "⏳ 1 przypomnienie wyjdzie w ciągu minuty (pominięto 3).",
      "⏳ 2 przypomnienia wyjdą w ciągu minuty (pominięto 3).",
      "⏳ 5 przypomnień wyjdzie w ciągu minuty (pominięto 3).",
      "⏳ 22 przypomnienia wyjdą w ciągu minuty (pominięto 3).",
    ]);
    expect([1, 2, 5, 22].map((n) => taps.setApprovedHeld(n, 0, "NOTE"))).toEqual([
      "⏳ Zatwierdzono 1 przypomnienie (pominięto 0). NOTE; /status pokazuje szczegóły.",
      "⏳ Zatwierdzono 2 przypomnienia (pominięto 0). NOTE; /status pokazuje szczegóły.",
      "⏳ Zatwierdzono 5 przypomnień (pominięto 0). NOTE; /status pokazuje szczegóły.",
      "⏳ Zatwierdzono 22 przypomnienia (pominięto 0). NOTE; /status pokazuje szczegóły.",
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

  // The edit of a card and the answer of a tap use one style for the same idea: the skipped count in parentheses.
  test("the set tap answer and the set card edit write the skipped count the same way", () => {
    const { taps } = textTables.pl.bot;
    const { edit } = textTables.pl.approvals;
    expect(taps.setApproved(2, 1)).toContain("(pominięto 1)");
    expect(taps.setApprovedHeld(2, 1, "NOTE")).toContain("(pominięto 1)");
    expect(edit.approvedSet("11:07", 2, 1)).toContain("(pominięto 1)");
    expect(edit.rejectedSet("11:07", 2, 1)).toContain("(pominięto 1)");
  });
});

describe("OAuth mailbox bot texts", () => {
  test("the status and login error texts of an OAuth mailbox point to the panel, never to mailbox:password", () => {
    const en = textTables.en.bot;
    const pl = textTables.pl.bot;
    expect(en.status.stateAuthErrorOAuth("10:40")).toBe("sign-in error since 10:40 (Reconnect in the panel)");
    expect(pl.status.stateAuthErrorOAuth("10:40")).toBe("błąd logowania od 10:40 (połącz ponownie w panelu)");
    expect(en.switch.loginErrorOAuth("a@x.test")).toBe(
      "❌ a@x.test has a sign-in error: tap Reconnect in the panel first."
    );
    expect(pl.switch.loginErrorOAuth("a@x.test")).toBe(
      "❌ a@x.test ma błąd logowania: najpierw stuknij „Połącz ponownie” w panelu."
    );
    for (const text of [
      en.status.stateAuthErrorOAuth("x"),
      pl.status.stateAuthErrorOAuth("x"),
      en.switch.loginErrorOAuth("x"),
      pl.switch.loginErrorOAuth("x"),
    ])
      expect(text).not.toContain("mailbox:password");
  });

  test("the password texts stay as they are", () => {
    expect(textTables.en.bot.status.stateAuthError("10:40")).toBe("login error since 10:40 (run mailbox:password)");
    expect(textTables.en.bot.switch.loginError("a@x.test")).toBe(
      "❌ a@x.test has a login error: run mailbox:password first."
    );
    expect(textTables.pl.bot.switch.loginError("a@x.test")).toBe(
      "❌ a@x.test: błąd logowania. Najpierw uruchom mailbox:password."
    );
  });
});

describe("the taps of the reply drafts (F115 stage 13)", () => {
  const { en, pl } = { en: textTables.en.bot.taps.reply, pl: textTables.pl.bot.taps.reply };

  test("the Polish texts are the agreed ones (informal ty)", () => {
    expect(pl.drafting).toBe("✍️ Piszę szkic. Przyjdzie w nowej wiadomości.");
    expect(pl.redraftAsk).toBe("Napisz jedną linijkę w odpowiedzi na wiadomość poniżej.");
    expect(pl.redraftQueued).toBe("✍️ Piszę nową wersję. Przyjdzie w nowej wiadomości.");
    expect(pl.redraftLimit).toBe("Ten szkic ma już 5 nowych wersji. Edytuj go w panelu.");
    expect(pl.instructionLength).toBe("Napisz jedną linijkę, od 1 do 300 znaków.");
    expect(pl.closed).toBe("Ten szkic jest zamknięty. Nic się nie zmieniło.");
    expect(pl.recipientsDone).toBe("👥 Zmieniono odbiorców. Nowa wersja przyjdzie w nowej wiadomości.");
    expect(pl.tooManyRecipients).toBe(
      "Zbyt wielu odbiorców: odpowiedź może trafić najwyżej do 10 dodatkowych osób. Użyj panelu."
    );
    expect(pl.noReplyTo).toBe("Ta wiadomość nie ma innego adresu Reply-To.");
    expect(pl.noOthers).toBe("Ta wiadomość nie ma innych odbiorców.");
    expect(pl.badRecipient).toBe("Nie można użyć jednego z adresów tej wiadomości. Zmień odbiorców w panelu.");
    expect(pl.recipientsUnchanged).toBe("Szkic już trafia do tych odbiorców.");
    expect(textTables.pl.bot.taps.changed).toBe("Ten szkic został zmieniony. Użyj najnowszej wiadomości.");
  });

  test("every reason that blocks a draft has a text in both languages, and the Polish one differs from the English one", () => {
    for (const reason of [...REPLY_BLOCK_REASONS, "policy_changed"] as const) {
      expect(en.blocked[reason].length, reason).toBeGreaterThan(10);
      expect(pl.blocked[reason].length, reason).toBeGreaterThan(10);
      expect(pl.blocked[reason], reason).not.toBe(en.blocked[reason]);
    }
    expect(pl.blocked.suspicious).toBe("Ta wiadomość wygląda podejrzanie. Brak szkicu.");
    expect(pl.blocked.answered).toBe("Ta wiadomość ma już odpowiedź.");
    expect(pl.blocked.policy_changed).toBe("Szkice odpowiedzi są wyłączone dla tej skrzynki. Włącz je w panelu.");
  });

  test("no text holds an address or a line break; each is short enough for the answer of a tap (200 characters) except the shown limits", () => {
    for (const table of [en, pl]) {
      const texts = Object.entries(table).flatMap(([key, value]) =>
        typeof value === "string" ? [[key, value]] : Object.entries(value).map(([sub, text]) => [`${key}.${sub}`, text])
      );
      for (const [key, text] of texts) {
        expect(text, key).not.toMatch(/@/);
        expect(text, key).not.toContain("\n");
        expect((text as string).length, key).toBeLessThanOrEqual(200);
      }
    }
  });
});

describe("status lines", () => {
  test.each([
    { locale: "en", when: null, late: false, text: "Last sync: never" },
    { locale: "en", when: null, late: true, text: "Last sync: never" },
    { locale: "en", when: "07:20", late: false, text: "Last sync: 07:20" },
    { locale: "en", when: "07:20", late: true, text: "Last sync: 07:20 (late)" },
    { locale: "pl", when: null, late: false, text: "Ostatnia synchronizacja: nigdy" },
    { locale: "pl", when: null, late: true, text: "Ostatnia synchronizacja: nigdy" },
    { locale: "pl", when: "07:20", late: false, text: "Ostatnia synchronizacja: 07:20" },
    { locale: "pl", when: "07:20", late: true, text: "Ostatnia synchronizacja: 07:20 (spóźniona)" },
  ] as const)("lastSync in $locale with when $when and late $late", ({ locale, when, late, text }) => {
    expect(textTables[locale].bot.status.lastSync(when, late)).toBe(text);
  });

  test.each([
    { locale: "en", waiting: 0, oldest: null, held: null, text: "Approvals: 0 waiting for your tap" },
    { locale: "en", waiting: 1, oldest: "12:00", held: null, text: "Approvals: 1 waiting for your tap (oldest 12:00)" },
    {
      locale: "en",
      waiting: 2,
      oldest: null,
      held: "1 approved, sending",
      text: "Approvals: 2 waiting for your tap · 1 approved, sending",
    },
    { locale: "pl", waiting: 0, oldest: null, held: null, text: "Zatwierdzenia: 0 do Twojego stuknięcia" },
    {
      locale: "pl",
      waiting: 1,
      oldest: "12:00",
      held: null,
      text: "Zatwierdzenia: 1 do Twojego stuknięcia (najstarsze z 12:00)",
    },
    {
      locale: "pl",
      waiting: 5,
      oldest: null,
      held: "zatwierdzono 1, trwa wysyłanie",
      text: "Zatwierdzenia: 5 do Twojego stuknięcia · zatwierdzono 1, trwa wysyłanie",
    },
    {
      locale: "pl",
      waiting: 2,
      oldest: "12:00",
      held: "zatwierdzono 1, trwa wysyłanie",
      text: "Zatwierdzenia: 2 do Twojego stuknięcia (najstarsze z 12:00) · zatwierdzono 1, trwa wysyłanie",
    },
  ] as const)("approvalsLine in $locale with $waiting waiting, oldest $oldest, held $held", (row) => {
    const label = row.locale === "en" ? "Approvals" : "Zatwierdzenia";
    expect(
      textTables[row.locale].bot.status.approvalsLine(label, row.waiting, { oldest: row.oldest, held: row.held })
    ).toBe(row.text);
  });
});
