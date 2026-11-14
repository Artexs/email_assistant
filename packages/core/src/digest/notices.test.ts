import { describe, expect, test } from "bun:test";

import { textTables } from "../texts";

import { MESSAGE_MAX_CHARS } from "./message";
import {
  feedbackButtons,
  renderActionFailedNotice,
  renderAuthErrorNotice,
  renderHostBlockedNotice,
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

  test("leaves out the AI line when there is no AI text", () => {
    expect(renderUrgentNotice({ ...urgent, aiText: null }, textTables.en).text).not.toContain("💬");
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
    expect(polish[0]).toBe("⛔ System przestał łączyć się z serwerem poczty skrzynki: me@firma.test. Od: 07:40.");
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

  test("sync late, never synced", () => {
    const message = renderSyncStaleNotice(
      { address: "me@firma.test", lastSyncedAt: null, now, timeZone },
      textTables.en
    );
    expect(message.text).toContain("Last good sync: never.");
    expect(message.buttons).toEqual([]);
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
        `⏸ Wysyłanie czeka (skrzynka: me@firma.test): osiągnięto godzinny limit wysyłania z tej skrzynki.\n${count}; następna wyjdzie około 12:10.`
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
