import { describe, expect, test } from "bun:test";

import { textTables } from "../texts";
import type { AuthErrorReason } from "../web/mail-oauth";

import { formatClock } from "./local-time";
import { MESSAGE_MAX_CHARS } from "./message";
import {
  feedbackButtons,
  renderActionFailedNotice,
  renderAuthErrorNotice,
  renderHostBlockedNotice,
  renderRepliesReadyNotice,
  renderReplyPromptNotice,
  renderReplyResultNotice,
  renderSentMissingNotice,
  renderSendHeldNotice,
  renderSyncOkNotice,
  renderSyncStaleNotice,
  renderUrgentNotice,
} from "./notices";
import { cutText } from "./text";

const ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const timeZone = "Europe/Warsaw";
const now = new Date("2026-11-06T07:00:00Z");
const urgent = {
  emailId: ID,
  from: "Ann <ann@firma.test>",
  subject: "Server down",
  aiText: "The server is down.",
  receivedAt: new Date("2026-11-06T06:42:00Z"),
  synthetic: false,
  folderTag: null,
  wouldDo: "would flag",
  now,
  timeZone,
};

describe("renderUrgentNotice", () => {
  test("has the lines in order, with buttons", () => {
    const message = renderUrgentNotice(urgent, textTables.en);
    expect(message.text.split("\n")).toEqual([
      "🔴 Urgent mail",
      "From: Ann <ann@firma.test>",
      "Subject: Server down",
      "💬 The server is down.",
      "Received 07:42",
      "→ would flag",
    ]);
    expect(message.buttons).toEqual([
      [
        { text: "✅ Right", data: `fr:u:${ID}` },
        { text: "✏️ Change", data: `fe:${ID}` },
      ],
    ]);
  });

  test("the Draft reply button is its own row and shows only when `draftable` is set (en and pl)", () => {
    expect(renderUrgentNotice({ ...urgent, draftable: false }, textTables.en).buttons).toHaveLength(1);
    const en = renderUrgentNotice({ ...urgent, draftable: true }, textTables.en);
    expect(en.buttons[1]).toEqual([{ text: "✍️ Draft reply", data: `dr:${ID}` }]);
    expect(renderUrgentNotice({ ...urgent, draftable: true }, textTables.pl).buttons[1]).toEqual([
      { text: "✍️ Szkic odpowiedzi", data: `dr:${ID}` },
    ]);
    // The delegate button stays in the first row.
    expect(renderUrgentNotice({ ...urgent, delegable: true, draftable: true }, textTables.en).buttons).toHaveLength(2);
  });

  test("leaves out the AI line when there is no AI text", () => {
    expect(renderUrgentNotice({ ...urgent, aiText: null }, textTables.en).text).not.toContain("💬");
  });

  test("with no AI text the notice has no empty line", () => {
    expect(renderUrgentNotice({ ...urgent, aiText: null }, textTables.en).text.split("\n")).toEqual([
      "🔴 Urgent mail",
      "From: Ann <ann@firma.test>",
      "Subject: Server down",
      "Received 07:42",
      "→ would flag",
    ]);
  });

  test("a delegable mail has the Delegate button in the first row", () => {
    expect(renderUrgentNotice({ ...urgent, delegable: true }, textTables.en).buttons).toEqual([
      [
        { text: "✅ Right", data: `fr:u:${ID}` },
        { text: "✏️ Change", data: `fe:${ID}` },
        { text: "👥 Delegate", data: `dg:${ID}` },
      ],
    ]);
  });

  test("marks a test mail", () => {
    const first = renderUrgentNotice({ ...urgent, synthetic: true }, textTables.en).text.split("\n")[0];
    expect(first?.endsWith("· 🧪 test")).toBe(true);
  });

  test("shows the folder of the mail", () => {
    expect(renderUrgentNotice({ ...urgent, folderTag: "Oferty" }, textTables.en).text.split("\n")[0]).toBe(
      "🔴 Urgent mail · 📁 Oferty"
    );
    expect(
      renderUrgentNotice({ ...urgent, folderTag: "Oferty", synthetic: true }, textTables.en).text.split("\n")[0]
    ).toBe("🔴 Urgent mail · 📁 Oferty · 🧪 test");
  });

  test("prints the warning line after the AI line, in both languages", () => {
    const suspicious = ["lookalike_domain", "risky_attachment"] as const;
    const en = renderUrgentNotice({ ...urgent, suspicious }, textTables.en).text.split("\n");
    expect(en[3]).toBe("💬 The server is down.");
    expect(en[4]).toBe("⚠ Suspicious: look-alike domain, risky attachment");
    expect(en[5]).toBe("Received 07:42");
    const pl = renderUrgentNotice({ ...urgent, suspicious }, textTables.pl).text.split("\n");
    expect(pl[4]).toBe("⚠ Podejrzana wiadomość: domena podobna do znanej, ryzykowny załącznik");
  });

  test("prints the attachment line after the subject line, in both languages", () => {
    const attachments = {
      attachments: [{ name: "faktura.pdf", type: "application/pdf", size: 122880, inline: false }],
      count: 1,
    };
    const en = renderUrgentNotice({ ...urgent, attachments }, textTables.en).text.split("\n");
    expect(en[2]).toBe("Subject: Server down");
    expect(en[3]).toBe("📎 1: faktura.pdf (120 kB)");
    expect(en[4]).toBe("💬 The server is down.");
    const pl = renderUrgentNotice({ ...urgent, attachments: { ...attachments, count: 3 } }, textTables.pl).text.split(
      "\n"
    );
    expect(pl[3]).toBe("📎 3: faktura.pdf (120 kB), +2 więcej");
  });

  test("a view without attachments, or with only inline parts, renders as before", () => {
    const before = renderUrgentNotice(urgent, textTables.en);
    const inline = { attachments: [{ name: "logo.png", type: "image/png", size: 5, inline: true }], count: 1 };
    expect(renderUrgentNotice({ ...urgent, attachments: inline }, textTables.en)).toEqual(before);
    expect(before.text).not.toContain("📎");
  });

  test("F110 stage 16: the percent or the rule after the AI line, in both languages", () => {
    const lineOf = (text: string): string => text.split("\n").find((line) => line.startsWith("💬")) ?? "";
    expect(lineOf(renderUrgentNotice({ ...urgent, confidence: 0.87 }, textTables.en).text)).toBe(
      "💬 The server is down. · 85%"
    );
    expect(lineOf(renderUrgentNotice({ ...urgent, confidence: 0.87, rule: "vip" }, textTables.en).text)).toBe(
      "💬 The server is down. · rule: VIP sender"
    );
    expect(lineOf(renderUrgentNotice({ ...urgent, confidence: 0.87, rule: "vip" }, textTables.pl).text)).toBe(
      "💬 The server is down. · reguła: nadawca VIP"
    );
    expect(lineOf(renderUrgentNotice({ ...urgent, confidence: 0.99 }, textTables.pl).text)).toBe(
      "💬 The server is down. · 95%"
    );
    // No AI text: the mark has a line of its own, in the place of the AI line.
    const bare = renderUrgentNotice({ ...urgent, aiText: null, confidence: 0.8 }, textTables.en).text.split("\n");
    expect(bare.slice(2, 5)).toEqual(["Subject: Server down", "💬 80%", "Received 07:42"]);
    // A view without the keys, or with null keys, renders as before.
    const before = renderUrgentNotice(urgent, textTables.en);
    expect(renderUrgentNotice({ ...urgent, confidence: null, rule: null }, textTables.en)).toEqual(before);
  });

  test("B1. an empty AI text keeps the old output byte for byte without a mark, and gives the mark line with one", () => {
    const empty = { ...urgent, aiText: "" };
    expect(renderUrgentNotice(empty, textTables.en).text).toBe(
      "🔴 Urgent mail\nFrom: Ann <ann@firma.test>\nSubject: Server down\n💬 \nReceived 07:42\n→ would flag"
    );
    expect(renderUrgentNotice({ ...empty, confidence: null, rule: null }, textTables.en).text).toBe(
      renderUrgentNotice(empty, textTables.en).text
    );
    // With a mark the empty text gives the mark line.
    const marked = renderUrgentNotice({ ...empty, confidence: 0.8 }, textTables.en).text.split("\n");
    expect(marked.slice(2, 5)).toEqual(["Subject: Server down", "💬 80%", "Received 07:42"]);
  });

  test("TG3. an AI text over 200 characters is cut at 200, and the mark stays after the cut", () => {
    const long = { ...urgent, aiText: "y".repeat(300) };
    const lineOf = (text: string): string => text.split("\n").find((line) => line.startsWith("💬")) ?? "";
    expect(lineOf(renderUrgentNotice(long, textTables.en).text)).toBe(`💬 ${"y".repeat(199)}…`);
    expect(lineOf(renderUrgentNotice({ ...long, confidence: 0.9 }, textTables.en).text)).toBe(
      `💬 ${"y".repeat(199)}… · 90%`
    );
  });

  test("lists the reasons in the order of the rules, whatever the order of the view", () => {
    const text = renderUrgentNotice({ ...urgent, suspicious: ["risky_attachment", "auth_fail"] }, textTables.en).text;
    expect(text).toContain("⚠ Suspicious: sender check failed, risky attachment");
  });

  test("an old view, or an empty list, renders as before", () => {
    const before = renderUrgentNotice(urgent, textTables.en);
    expect(renderUrgentNotice({ ...urgent, suspicious: [] }, textTables.en)).toEqual(before);
    expect(before.text).not.toContain("⚠");
    expect(before.text).toBe(
      "🔴 Urgent mail\nFrom: Ann <ann@firma.test>\nSubject: Server down\n💬 The server is down.\nReceived 07:42\n→ would flag"
    );
  });

  test("stays short for very long mail fields", () => {
    const long = "x".repeat(10_000);
    const message = renderUrgentNotice({ ...urgent, from: long, subject: long, aiText: long }, textTables.en);
    expect(message.text.length).toBeLessThanOrEqual(MESSAGE_MAX_CHARS);
    const subject = message.text.split("\n")[2]?.slice("Subject: ".length) ?? "";
    expect(Array.from(subject).length).toBeLessThanOrEqual(80);
  });
});

describe("feedbackButtons", () => {
  test("gives only the edit button for unsure", () => {
    expect(feedbackButtons(ID, "unsure", { right: "R", edit: "E" })).toEqual([{ text: "E", data: `fe:${ID}` }]);
  });
});

describe("other notices", () => {
  test("auth_error", () => {
    const message = renderAuthErrorNotice(
      {
        address: "me@firma.test",
        mailboxId: "mb-1",
        since: new Date("2026-11-06T06:40:00Z"),
        now,
        timeZone,
      },
      textTables.en
    );
    expect(message.text).toContain("me@firma.test");
    expect(message.text).toContain("mb-1");
    expect(message.text).toContain("at 07:40");
    expect(message.buttons).toEqual([]);
  });

  test("auth_error without oauth keeps today's text, byte for byte", () => {
    const input = {
      address: "me@firma.test",
      mailboxId: "mb-1",
      since: new Date("2026-11-06T06:40:00Z"),
      now,
      timeZone,
    };
    expect(renderAuthErrorNotice(input, textTables.en).text).toBe(
      [
        "❌ Login to me@firma.test failed at 07:40.",
        "The system does not read this mailbox now. No mail is lost: it stays on the mail server.",
        "To fix it: check the password, then run mailbox:password for mailbox mb-1 (runbook: deploy/README.md).",
      ].join("\n")
    );
    expect(renderAuthErrorNotice(input, textTables.pl).text).toBe(
      [
        "❌ Nie udało się zalogować do skrzynki: me@firma.test. Błąd trwa od 07:40.",
        "System nie czyta teraz tej skrzynki. Żadna wiadomość nie ginie: zostaje na serwerze poczty.",
        "Aby to naprawić, sprawdź hasło i uruchom mailbox:password dla skrzynki mb-1 (instrukcja: deploy/README.md).",
      ].join("\n")
    );
  });

  describe("auth_error of an OAuth mailbox", () => {
    const input = {
      address: "me@firma.test",
      mailboxId: "mb-1",
      since: new Date("2026-11-06T06:40:00Z"),
      now,
      timeZone,
    };
    const fixOf = (locale: "en" | "pl", provider: "microsoft" | "google", reason: AuthErrorReason | null) =>
      renderAuthErrorNotice({ ...input, oauth: { provider, reason } }, textTables[locale]).text.split("\n")[2];

    const expected = [
      [
        "oauth_expired",
        "The sign-in to Google expired. Open the panel, Mailboxes, and tap Reconnect.",
        "Logowanie do Google wygasło. Otwórz panel, Skrzynki, i stuknij „Połącz ponownie”.",
      ],
      [
        "oauth_revoked",
        "Access to the mailbox was withdrawn at Google. Open the panel, Mailboxes, and tap Reconnect.",
        "Dostęp do skrzynki cofnięto po stronie Google. Otwórz panel, Skrzynki, i stuknij „Połącz ponownie”.",
      ],
      [
        "admin_consent_required",
        "This app needs approval at Google, from you or from your administrator. Open the panel, Mailboxes: tap Reconnect, or use the approval link there.",
        "Ta aplikacja wymaga zatwierdzenia w usłudze Google: przez Ciebie lub przez Twojego administratora. Otwórz panel, Skrzynki: stuknij „Połącz ponownie” albo użyj tam linku do zatwierdzenia.",
      ],
      [
        "protocol_disabled",
        "Your administrator turned off IMAP or SMTP for this mailbox. Ask them to turn it on, then tap Reconnect in the panel.",
        "Administrator wyłączył IMAP lub SMTP dla tej skrzynki. Poproś o włączenie, potem stuknij „Połącz ponownie” w panelu.",
      ],
      [
        null,
        "The sign-in to Google fails. Open the panel, Mailboxes, and tap Reconnect.",
        "Logowanie do Google nie działa. Otwórz panel, Skrzynki, i stuknij „Połącz ponownie”.",
      ],
    ] as const;

    for (const [reason, en, pl] of expected) {
      test(`the fix line for ${reason ?? "no reason"} in en and pl`, () => {
        expect(fixOf("en", "google", reason)).toBe(en);
        expect(fixOf("pl", "google", reason)).toBe(pl);
        for (const locale of ["en", "pl"] as const) {
          const text = renderAuthErrorNotice({ ...input, oauth: { provider: "google", reason } }, textTables[locale]);
          expect(text.text).not.toContain("mailbox:password");
          expect(text.text).not.toContain("mb-1");
          expect(text.text.split("\n")).toHaveLength(3);
        }
      });
    }

    test("the provider name is Microsoft or Google", () => {
      expect(fixOf("en", "microsoft", "oauth_expired")).toContain("Microsoft");
      expect(fixOf("pl", "microsoft", null)).toContain("Microsoft");
      expect(fixOf("en", "microsoft", "admin_consent_required")).toContain("Microsoft");
      expect(fixOf("en", "google", "oauth_revoked")).toContain("Google");
    });

    test("the admin consent text also fits a user who must approve the app", () => {
      expect(fixOf("en", "microsoft", "admin_consent_required")).toContain("from you or from your administrator");
      expect(fixOf("pl", "microsoft", "admin_consent_required")).toContain(
        "przez Ciebie lub przez Twojego administratora"
      );
    });

    test("no en text equals its pl text", () => {
      for (const [reason] of expected) expect(fixOf("en", "google", reason)).not.toBe(fixOf("pl", "google", reason));
    });
  });

  test("host_blocked: four lines, no button, no host name and no address", () => {
    const input = { address: "me@firma.test", since: new Date("2026-11-06T06:40:00Z"), now, timeZone };
    const message = renderHostBlockedNotice(input, textTables.en);
    expect(message.text).toBe(
      [
        "⛔ The system stopped connecting to the mail server of me@firma.test at 07:40.",
        "The server name points to a private or local network address, and the system never connects there.",
        "The system does not read or send mail of this mailbox now. No mail is lost: it stays on the mail server.",
        "The system checks the server again at each sync and starts the mailbox again by itself. /status shows the state.",
      ].join("\n")
    );
    expect(message.buttons).toEqual([]);
    for (const text of [message.text, renderHostBlockedNotice(input, textTables.pl).text]) {
      expect(text).not.toContain("imap.x.test");
      expect(text).not.toContain("smtp.x.test");
      expect(text).not.toContain("10.0.0.7");
    }
    const polish = renderHostBlockedNotice(input, textTables.pl).text.split("\n");
    expect(polish).toHaveLength(4);
    expect(polish[0]).toBe("⛔ System przestał łączyć się z serwerem poczty skrzynki me@firma.test (od 07:40).");
  });

  test("host_blocked: a start of the day before shows the date; a long address is cut", () => {
    const earlier = renderHostBlockedNotice(
      { address: "me@firma.test", since: new Date("2026-11-05T13:00:00Z"), now, timeZone },
      textTables.en
    );
    expect(earlier.text.split("\n")[0]).toEndWith("at 5 Nov 14:00.");
    const address = `${"a".repeat(80)}@firma.test`;
    const long = renderHostBlockedNotice({ address, since: now, now, timeZone }, textTables.en).text;
    expect(long).toContain(cutText(address, 60));
    expect(long).not.toContain("a".repeat(61));
  });

  test("sent_missing: two lines, no button; a long address is cut", () => {
    const sentNow = new Date("2026-11-20T10:00:00Z");
    const since = new Date("2026-11-12T09:00:00Z");
    const input = { address: "boss@x.test", since, now: sentNow, timeZone: "Europe/Warsaw" };
    const day = formatClock(since, "Europe/Warsaw", sentNow, "en");
    const message = renderSentMissingNotice(input, textTables.en);
    expect(message.text).toBe(
      [
        `📭 No sent mail seen for boss@x.test since ${day}.`,
        "Does your mail app keep a copy in Sent? The assistant needs it to see what you wait for.",
      ].join("\n")
    );
    expect(message.buttons).toEqual([]);
    const polish = renderSentMissingNotice(input, textTables.pl).text.split("\n");
    expect(polish).toHaveLength(2);
    expect(polish[0]).toStartWith("📭 Brak wysłanej poczty dla boss@x.test od ");
    expect(polish[1]).toStartWith("Czy Twój program pocztowy");
    const address = `${"a".repeat(80)}@firma.test`;
    const long = renderSentMissingNotice({ ...input, address }, textTables.en).text;
    expect(long).toContain(cutText(address, 60));
    expect(long).not.toContain("a".repeat(61));
  });

  test("sync late, never synced", () => {
    const message = renderSyncStaleNotice(
      { address: "me@firma.test", lastSyncedAt: null, now, timeZone },
      textTables.en
    );
    expect(message.text).toContain("Last good sync: never.");
    expect(message.buttons).toEqual([]);
  });

  test("sync late with a last good sync prints its clock, in three lines", () => {
    expect(
      renderSyncStaleNotice(
        { address: "me@firma.test", lastSyncedAt: new Date("2026-11-05T06:00:00Z"), now, timeZone },
        textTables.en
      ).text
    ).toBe(
      "⚠️ Mail sync is late for me@firma.test.\nLast good sync: 5 Nov 07:00. The system keeps trying.\n/status shows the state."
    );
  });

  test("sync works again", () => {
    const message = renderSyncOkNotice(
      {
        address: "me@firma.test",
        lastSyncedAt: new Date("2026-11-06T06:55:00Z"),
        now,
        timeZone,
      },
      textTables.en
    );
    expect(message.text).toContain("Last sync 07:55");
  });
});

describe("renderActionFailedNotice", () => {
  const base = {
    actionType: "move" as const,
    reverse: false,
    reason: "other" as const,
    folderName: "AI/Info",
    sourceFolder: "INBOX",
    currentFolder: "INBOX",
    from: "Ann <ann@firma.test>",
    subject: "Offer, see https://evil.test/x",
    synthetic: false,
    attempts: 3,
  };
  const lines = (input: Parameters<typeof renderActionFailedNotice>[0]) =>
    renderActionFailedNotice(input, textTables.en).text.split("\n");

  test("original move names the folder and cleans the subject", () => {
    expect(lines(base)).toEqual([
      "⚠️ Could not move a mail to AI/Info",
      "From: Ann <ann@firma.test>",
      "Subject: Offer, see [link]",
      "Tried 3 times. The mail stays in INBOX. /status shows the mailbox state.",
    ]);
    expect(renderActionFailedNotice(base, textTables.en).buttons).toEqual([]);
  });

  test("the six shapes carry the verb, the subject and the tries", () => {
    const cases = [
      { actionType: "move", reverse: false, verb: "Could not move a mail to AI/Info" },
      { actionType: "flag", reverse: false, verb: "Could not flag a mail" },
      { actionType: "mark_read", reverse: false, verb: "Could not mark a mail read" },
      { actionType: "move", reverse: true, verb: "Undo failed: could not move a mail back to INBOX" },
      { actionType: "flag", reverse: true, verb: "Undo failed: could not remove the flag" },
      { actionType: "mark_read", reverse: true, verb: "Undo failed: could not mark a mail unread" },
    ] as const;
    for (const { verb, ...shape } of cases) {
      const out = lines({ ...base, ...shape });
      expect(out[0]).toBe(`⚠️ ${verb}`);
      expect(out[2]).toBe("Subject: Offer, see [link]");
      expect(out[3]).toContain("Tried 3 times");
    }
    expect(lines({ ...base, reverse: true })[3]).toContain("The mail stays in AI/Info: move it by hand.");
  });

  test("a reverse create_draft says that the draft stays in Drafts", () => {
    const out = lines({ ...base, actionType: "create_draft", reverse: true, folderName: null });
    expect(out).toEqual([
      "⚠️ Could not remove the draft for a mail",
      "From: Ann <ann@firma.test>",
      "Subject: Offer, see [link]",
      "Tried 3 times. The draft stays in Drafts: delete it by hand. /status shows the mailbox state.",
    ]);
  });

  test("a reverse mail_not_found has the not-found line and no Tried line", () => {
    const out = lines({ ...base, reverse: true, reason: "mail_not_found" });
    expect(out[3]).toBe("The mail was not found: it was moved or deleted in the mail client.");
    expect(out.join("\n")).not.toContain("Tried");
  });

  test("bad_payload has no folder and no Tried line", () => {
    const out = lines({ ...base, reason: "bad_payload", folderName: null, attempts: 0 });
    expect(out[0]).toBe("⚠️ Could not move a mail");
    expect(out[3]).toBe("The plan had an unknown folder. The mail stays in INBOX.");
    expect(out.join("\n")).not.toContain("Tried");
  });

  test("a reverse move names the source folder", () => {
    expect(lines({ ...base, reverse: true, sourceFolder: "Oferty" })[0]).toBe(
      "⚠️ Undo failed: could not move a mail back to Oferty"
    );
  });

  test("a failed original move and bad_payload name the current folder", () => {
    expect(lines({ ...base, currentFolder: "Oferty" })[3]).toContain("The mail stays in Oferty.");
    expect(lines({ ...base, reason: "bad_payload", currentFolder: "Oferty" })[3]).toBe(
      "The plan had an unknown folder. The mail stays in Oferty."
    );
  });

  test("a null folder name ends the first line after 'a mail'", () => {
    expect(lines({ ...base, folderName: null })[0]).toBe("⚠️ Could not move a mail");
  });

  test.each([
    ["move", false, "Tried 3 times. The mail stays in INBOX. /status shows the mailbox state."],
    ["flag", false, "Tried 3 times. /status shows the mailbox state."],
    ["mark_read", false, "Tried 3 times. /status shows the mailbox state."],
    ["create_draft", false, "Tried 3 times. /status shows the mailbox state."],
    ["move", true, "Tried 3 times. The mail stays in AI/Info: move it by hand. /status shows the mailbox state."],
    ["flag", true, "Tried 3 times. /status shows the mailbox state."],
    ["mark_read", true, "Tried 3 times. /status shows the mailbox state."],
    [
      "create_draft",
      true,
      "Tried 3 times. The draft stays in Drafts: delete it by hand. /status shows the mailbox state.",
    ],
  ] as const)("the last line of a %s with reverse %s", (actionType, reverse, last) => {
    expect(lines({ ...base, actionType, reverse }).at(-1)).toBe(last);
  });

  test("a follow-up that failed or may have gone out is one fixed line, with the panel link when set", () => {
    const render = (cause: "failed" | "unknown", panelUrl?: string) =>
      renderActionFailedNotice({ followUp: { cause, panelUrl } }, textTables.en);
    expect(render("failed")).toEqual({ text: "⚠️ A follow-up could not be sent. Nothing went out.", buttons: [] });
    expect(render("unknown", "https://app.test/approvals")).toEqual({
      text: [
        "⚠️ A follow-up may have been sent: the connection broke after the text went out. Check your Sent folder before you write another.",
        "Open in panel: https://app.test/approvals",
      ].join("\n"),
      buttons: [],
    });
  });

  test.each([
    ["an original move with a folder names the folder", { reason: "other" }, "⚠️ Could not move a mail to AI/Info"],
    [
      "an original move after bad_payload does not name the folder",
      { reason: "bad_payload" },
      "⚠️ Could not move a mail",
    ],
    [
      "a reverse move names the source folder",
      { reverse: true },
      "⚠️ Undo failed: could not move a mail back to INBOX",
    ],
    [
      "a reverse move that finds no mail names the source folder",
      { reverse: true, reason: "mail_not_found" },
      "⚠️ Undo failed: could not move a mail back to INBOX",
    ],
  ] as const)("the first line: %s", (_name, patch, first) => {
    expect(lines({ ...base, ...patch })[0]).toBe(first);
  });

  test("marks a test mail after the first line only", () => {
    expect(lines({ ...base, synthetic: true })[1]).toBe("🧪 test");
    expect(renderActionFailedNotice(base, textTables.en).text).not.toContain("🧪");
  });
});

describe("renderSendHeldNotice", () => {
  const base = {
    address: "boss@x.test",
    mailboxId: ID,
    limit: "mailbox_hour" as const,
    waiting: 3,
    nextAt: new Date("2026-11-20T10:10:00Z"),
    now: new Date("2026-11-20T10:00:00Z"),
    timeZone,
  };

  test("names the limit, the count and the local time of the next send", () => {
    expect(renderSendHeldNotice(base, textTables.en)).toEqual({
      text: "⏸ Sends from boss@x.test wait: the hourly send limit of this mailbox is reached.\n3 waiting; the next one goes out at about 11:10.",
      buttons: [],
    });
  });

  test("a follow-up hold is two lines, with the panel link as a third line only when set", () => {
    const held = { ...base, followUps: true };
    const first = "⏸ A follow-up waits: the hourly send limit of this mailbox is reached.";
    expect(renderSendHeldNotice(held, textTables.en)).toEqual({
      text: `${first}\n3 waiting; the next one goes out at about 11:10.`,
      buttons: [],
    });
    expect(renderSendHeldNotice({ ...held, panelUrl: "https://app.test/approvals" }, textTables.en).text).toBe(
      `${first}\n3 waiting; the next one goes out at about 11:10.\nOpen in panel: https://app.test/approvals`
    );
  });

  test("the two other limits have their own text", () => {
    expect(renderSendHeldNotice({ ...base, limit: "mailbox_day" }, textTables.en).text).toContain(
      "wait: the daily send limit of this mailbox is reached."
    );
    expect(renderSendHeldNotice({ ...base, limit: "recipient_day" }, textTables.en).text).toContain(
      "wait: the daily limit for one recipient is reached."
    );
  });
});

describe("Polish notices", () => {
  const pl = textTables.pl;
  const plNow = new Date("2026-11-14T11:00:00Z");
  const plUrgent = { ...urgent, now: plNow, receivedAt: new Date("2026-11-14T10:15:00Z") };

  test("the urgent notice has Polish labels and the same callback data", () => {
    const message = renderUrgentNotice(plUrgent, pl);
    const lines = message.text.split("\n");
    expect(lines[0]).toBe("🔴 Pilna wiadomość");
    expect(lines).toContain("Od: Ann <ann@firma.test>");
    expect(lines).toContain("Temat: Server down");
    expect(lines).toContain("Odebrano 11:15");
    expect(message.buttons).toEqual([
      [
        { text: "✅ Dobrze", data: `fr:u:${ID}` },
        { text: "✏️ Zmień", data: `fe:${ID}` },
      ],
    ]);
    expect(renderUrgentNotice({ ...plUrgent, synthetic: true }, pl).text.split("\n")[0]).toBe(
      "🔴 Pilna wiadomość · 🧪 test"
    );
  });

  test("sync stale never synced names /status", () => {
    const text = renderSyncStaleNotice({ address: "me@firma.test", lastSyncedAt: null, now: plNow, timeZone }, pl).text;
    expect(text).toContain(pl.notices.syncStale.never);
    expect(text).toContain("/status");
  });

  test("a failed move counts the tries with the Polish plural", () => {
    const base = {
      actionType: "move" as const,
      reverse: false,
      reason: "other" as const,
      folderName: "AI/Info",
      sourceFolder: "INBOX",
      currentFolder: "INBOX",
      from: "Ann <ann@firma.test>",
      subject: "Offer",
      synthetic: false,
    };
    for (const [attempts, tried] of [
      [1, "Próbowano 1 raz."],
      [2, "Próbowano 2 razy."],
      [5, "Próbowano 5 razy."],
    ] as const) {
      const lines = renderActionFailedNotice({ ...base, attempts }, pl).text.split("\n");
      expect(lines[0]).toBe("⚠️ Nie udało się przenieść wiadomości do folderu: AI/Info");
      expect(lines[3]).toBe(`${tried} Wiadomość zostaje w folderze: INBOX. /status pokazuje stan skrzynki.`);
    }
  });

  test("the send-held notice names the limit and counts with the Polish plural", () => {
    const base = {
      address: "me@firma.test",
      mailboxId: "mb-1",
      limit: "mailbox_hour" as const,
      waiting: 1,
      nextAt: new Date("2026-11-14T11:10:00Z"),
      now: plNow,
      timeZone,
    };
    for (const [waiting, count] of [
      [1, "1 wiadomość czeka"],
      [3, "3 wiadomości czekają"],
      [5, "5 wiadomości czeka"],
    ] as const) {
      expect(renderSendHeldNotice({ ...base, waiting }, pl).text).toBe(
        `⏸ Wysyłanie czeka (skrzynka me@firma.test): osiągnięto godzinny limit wysyłania z tej skrzynki.\n${count}; następna wyjdzie około 12:10.`
      );
    }
  });

  test("the auth error keeps the command and the mailbox id", () => {
    const text = renderAuthErrorNotice(
      { address: "me@firma.test", mailboxId: "mb-1", since: new Date("2026-11-14T10:00:00Z"), now: plNow, timeZone },
      pl
    ).text;
    expect(text).toContain("mailbox:password");
    expect(text).toContain("mb-1");
    expect(text).toContain("deploy/README.md");
  });
});

describe("reply draft notices (F115 stage 03, stage 12)", () => {
  const at = new Date("2026-11-20T10:05:00Z");

  test("replies_ready prints the count and the clock in the org time zone; a covered owner gets the Review button", () => {
    const input = { count: 1, now: at, timeZone, review: true };
    const clock = formatClock(at, timeZone, at, "en");
    expect(renderRepliesReadyNotice(input, textTables.en)).toEqual({
      text: `✍️ 1 reply draft is ready (${clock}).`,
      buttons: [[{ text: "📝 Review", data: "rv" }]],
    });
    expect(renderRepliesReadyNotice({ ...input, count: 4 }, textTables.en).text).toBe(
      `✍️ 4 reply drafts are ready (${clock}).`
    );
    expect(renderRepliesReadyNotice({ ...input, count: 5 }, textTables.pl).buttons).toEqual([
      [{ text: "📝 Przejrzyj", data: "rv" }],
    ]);
  });

  test("replies_ready for an owner whose consent does not cover reply data: count, consent line, panel link, no button", () => {
    const clock = formatClock(at, timeZone, at, "en");
    const input = { count: 2, now: at, timeZone, review: false, panelUrl: "https://app.test/approvals" };
    expect(renderRepliesReadyNotice(input, textTables.en)).toEqual({
      text: [
        `✍️ 2 reply drafts are ready (${clock}).`,
        "Confirm the new Telegram terms in the panel to review here.",
        "Open in panel: https://app.test/approvals",
      ].join("\n"),
      buttons: [],
    });
    const polish = renderRepliesReadyNotice(input, textTables.pl);
    expect(polish.text.split("\n")[1]).toBe("Potwierdź nowe warunki Telegrama w panelu, aby przeglądać szkice tutaj.");
    expect(polish.buttons).toEqual([]);
  });

  test("replies_ready carries no mail text and no address in any variant", () => {
    for (const review of [true, false]) {
      const text = renderRepliesReadyNotice({ count: 3, now: at, timeZone, review }, textTables.en).text;
      expect(text).not.toMatch(/@/);
    }
  });

  test("replies_ready in Polish: one, few and many forms", () => {
    const clock = formatClock(at, timeZone, at, "pl");
    const polish = (count: number) =>
      renderRepliesReadyNotice({ count, now: at, timeZone, review: true }, textTables.pl).text;
    expect(polish(1)).toBe(`✍️ Gotowy jest 1 szkic odpowiedzi (${clock}).`);
    expect(polish(3)).toBe(`✍️ Gotowe są 3 szkice odpowiedzi (${clock}).`);
    expect(polish(5)).toBe(`✍️ Gotowych jest 5 szkiców odpowiedzi (${clock}).`);
    expect(polish(22)).toBe(`✍️ Gotowe są 22 szkice odpowiedzi (${clock}).`);
    expect(polish(12)).toBe(`✍️ Gotowych jest 12 szkiców odpowiedzi (${clock}).`);
  });

  test("reply_prompt is one fixed line with ForceReply, en and pl, no button", () => {
    expect(renderReplyPromptNotice(textTables.en)).toEqual({
      text: "✍️ Write one line: what should the reply say?",
      buttons: [],
      forceReply: true,
    });
    expect(renderReplyPromptNotice(textTables.pl)).toEqual({
      text: "✍️ Napisz jedną linijkę: co ma być w odpowiedzi?",
      buttons: [],
      forceReply: true,
    });
  });

  test("reply_result is one fixed line for each reason, en and pl, no button", () => {
    const fixed: Record<string, [string, string]> = {
      needs_facts: [
        "✍️ No draft: the reply needs facts that are not in the mail. Write it yourself.",
        "✍️ Brak szkicu: odpowiedź wymaga faktów, których nie ma w wiadomości. Napisz ją samodzielnie.",
      ],
      timeout: ["✍️ The draft took too long. Try once more.", "✍️ Szkic powstawał za długo. Spróbuj jeszcze raz."],
      llm_cap: [
        "✍️ The daily limit of AI calls for this mailbox is reached. Try again tomorrow.",
        "✍️ Dzienny limit wywołań AI dla tej skrzynki został wykorzystany. Spróbuj jutro.",
      ],
      closed: ["✍️ This draft was closed; nothing changed.", "✍️ Ten szkic został zamknięty; nic się nie zmieniło."],
      switch_off: [
        "✍️ Reply drafts are off for this mailbox. Turn them on in the panel.",
        "✍️ Szkice odpowiedzi są wyłączone dla tej skrzynki. Włącz je w panelu.",
      ],
      // A reason of the eligibility rule uses the tap text.
      answered: ["✍️ This mail has an answer already.", "✍️ Ta wiadomość ma już odpowiedź."],
      // A code with no own text.
      bad_recipient: ["✍️ No draft was made.", "✍️ Nie powstał żaden szkic."],
    };
    for (const [reason, [en, pl]] of Object.entries(fixed)) {
      expect(renderReplyResultNotice({ reason }, textTables.en), reason).toEqual({ text: en, buttons: [] });
      expect(renderReplyResultNotice({ reason }, textTables.pl), reason).toEqual({ text: pl, buttons: [] });
    }
  });

  test("every reply result text is one line, has no address and is not empty, en and pl", () => {
    for (const texts of [textTables.en, textTables.pl]) {
      for (const text of Object.values(texts.notices.replyDrafts.results)) {
        expect(text.length).toBeGreaterThan(5);
        expect(text).not.toContain("\n");
        expect(text).not.toMatch(/@/);
      }
      for (const text of Object.values(texts.bot.taps.reply.blocked)) expect(text.length).toBeGreaterThan(5);
    }
  });
});
