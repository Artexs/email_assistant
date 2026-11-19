import { describe, expect, test } from "bun:test";

import { renderDigestWithBrief, type DigestInput } from "../digest/digest";
import { weekStatsExample } from "../metrics/fixtures";
import type { UserLocale } from "../tenancy";
import { textTables } from "../texts";
import { minimalTexts } from "../texts/minimal";

import { encodeNoticeView } from "./encode";
import { noticeKinds, type NoticeKind, type NoticeRenderOptions } from "./kinds";
import { renderNotice, renderNoticeEdit } from "./render";
import { noticeViewSchemas, type NoticeView } from "./views";

// The privacy guard of the `minimal` Telegram render (ADR 0032 point 5). Every string field that a view schema allows holds
// the word CANARY; the text of a `minimal` render must hold none of them, no `@`, no URL of the view and no button.

const id1 = "11111111-1111-4111-8111-111111111111";
const id2 = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-11-13T10:07:33.123Z");
const timeZone = "Europe/Warsaw";
const base = "https://ea.example.ts.net";
const viewUrl = "https://panel.canary.test/approvals";

const approvalView = {
  kind: "delegation" as const,
  recipient: { name: "CANARYrecipient", address: "CANARYto@canary.test" },
  sender: { label: "CANARYsender <CANARYfrom@canary.test>", external: false },
  recipientInactive: false,
  subject: "CANARYsubject",
  dueDate: "CANARYdue",
  body: "CANARYbody",
  quote: { text: "CANARYquote", cut: false },
  synthetic: false,
  to: ["CANARYto@canary.test"],
  cc: ["CANARYcc@canary.test"],
  gaps: ["CANARYgap"],
  replyTo: ["CANARYreply@canary.test"],
  panelUrl: viewUrl,
};

// One view per kind, every free string planted. The fixture table is checked against the schemas below.
const canaryViews: { [K in NoticeKind]: NoticeView<K> } = {
  digest: {
    text: "CANARY digest text from CANARY@canary.test",
    buttons: [[{ text: "CANARYbutton", data: "CANARYdata" }]],
    loopIds: [id1],
  },
  urgent: {
    emailId: id1,
    from: "CANARYfrom@canary.test",
    subject: "CANARYsubject",
    ai: { reasonCode: "CANARYcode", reason: "CANARYreason" },
    receivedAt: now,
    synthetic: false,
    folderTag: "CANARYfolder",
    actions: [
      {
        type: "create_draft",
        status: "CANARYstatus",
        folder: null,
        reverse: false,
        kind: "delegation",
        delegateId: id2,
      },
    ],
    delegateNames: { [id2]: "CANARYdelegate" },
    stayFolder: "CANARYstay",
    now,
    timeZone,
  },
  auth_error: { address: "CANARYbox@canary.test", mailboxId: id2, since: now, now, timeZone },
  sync_stale: { address: "CANARYbox@canary.test", lastSyncedAt: now, now, timeZone },
  sync_ok: { address: "CANARYbox@canary.test", lastSyncedAt: now, now, timeZone },
  action_failed: {
    actionType: "move",
    reverse: false,
    reason: "other",
    folderName: "CANARYfolder",
    sourceFolder: "CANARYsource",
    currentFolder: "CANARYcurrent",
    from: "CANARYfrom@canary.test",
    subject: "CANARYsubject",
    synthetic: false,
    attempts: 3,
  },
  approval: { actionId: id1, view: approvalView, now, timeZone },
  approval_set: {
    setId: id2,
    items: [
      {
        n: 1,
        delegateName: "CANARYname",
        address: "CANARYa@canary.test",
        subject: "CANARYsubject",
        dueAt: now,
        reminder: 1,
        task: "CANARYtask",
      },
      {
        n: 2,
        delegateName: "CANARYname",
        address: "CANARYb@canary.test",
        subject: null,
        dueAt: null,
        reminder: 2,
        task: "CANARYtask",
      },
    ],
    timeZone,
  },
  send_result: {
    actionId: id1,
    sendKind: "delegation",
    result: { kind: "failed", cause: "tries", code: "CANARYcode", tries: 5 },
    recipient: { name: "CANARYname", address: "CANARYto@canary.test" },
    subject: "CANARYsubject",
    synthetic: false,
  },
  delegation_answered: {
    delegationId: id2,
    delegateName: "CANARYname",
    subject: "CANARYsubject",
    receivedAt: now,
    now,
    timeZone,
    synthetic: false,
  },
  mailbox_removed: { access: { page: "google", revoked: true } },
  send_held: {
    mailboxId: id1,
    address: "CANARYbox@canary.test",
    limit: "mailbox_day",
    waiting: 2,
    nextAt: now,
    now,
    timeZone,
    followUps: true,
    panelUrl: viewUrl,
  },
  weekly_report: { week: weekStatsExample(), timeZone, answeredWaiting: 2 },
  host_blocked: { address: "CANARYbox@canary.test", since: now, now, timeZone },
  approval_edit: {
    original: "CANARY stored card text",
    outcome: "approved_held",
    at: now,
    timeZone,
    heldBy: "scope",
    actionId: id1,
  },
  not_triaged: { emailId: id1, mailboxId: id2, sender: "CANARYsender@canary.test" },
  sent_missing: { address: "CANARYbox@canary.test", since: now, now, timeZone },
  loop_consent: { about: "approval", panelUrl: viewUrl },
  replies_ready: { count: 3, now, timeZone, review: true, panelUrl: viewUrl },
  reply_prompt: { emailId: id1 },
  // A lower-case code is the only shape the schema allows; a text of the code must not appear either.
  reply_result: { emailId: id1, reason: "canaryreason" },
  trust_report_ready: {
    mailboxId: id2,
    recommended: ["info", "spam"],
    blocked: 1,
    checked: 212,
    reportUrl: `https://panel.canary.test/report?mailbox=${id2}`,
  },
  autonomy_paused: {
    mailboxId: id2,
    category: "info",
    reason: "corrections",
    corrections: 2,
    settingsUrl: "https://panel.canary.test/settings",
  },
};

const stored = (kind: NoticeKind): unknown => encodeNoticeView(kind, canaryViews[kind] as never);
const locales: UserLocale[] = ["en", "pl"];
const options = (locale: UserLocale, webBaseUrl?: string): NoticeRenderOptions => ({
  channel: "telegram",
  detail: "minimal",
  locale,
  ...(webBaseUrl === undefined ? {} : { webBaseUrl }),
});

// Keys whose value is a code of ours or an id, not text of a person. Every other string of a fixture holds the canary.
const CODE_KEYS = new Set([
  "type",
  "actionType",
  "recommended",
  "kind",
  "limit",
  "sendKind",
  "outcome",
  "heldBy",
  "about",
  "page",
  "cause",
  "category",
  "reason",
  "provider",
  "sentCopy",
  "timeZone",
  "weekStart",
  "decision",
  "scope",
  "source",
  "state",
  "status",
  "mode",
  "model",
  "outcomeKind",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;

function leaks(value: unknown, key = ""): string[] {
  if (typeof value === "string") {
    if (/canary/i.test(value) || UUID.test(value) || ISO.test(value) || CODE_KEYS.has(key)) return [];
    return [`${key}=${value}`];
  }
  if (Array.isArray(value)) return value.flatMap((entry) => leaks(entry, key));
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([name, entry]) => leaks(entry, name));
  }
  return [];
}

describe("the canary fixtures", () => {
  test("one view per kind, every one valid, every free string planted", () => {
    expect(Object.keys(canaryViews).sort()).toEqual([...noticeKinds].sort());
    for (const kind of noticeKinds) {
      expect(noticeViewSchemas[kind].safeParse(stored(kind)).success).toBe(true);
      // A string that holds no canary must be an id, a date or a code: else the fixture misses a free field.
      expect(leaks(stored(kind))).toEqual([]);
    }
  });
});

describe("minimal render of every kind", () => {
  // `approval_edit` edits a card that is already in the chat: its text is the stored text of that card, tested below.
  const kinds = noticeKinds.filter((kind) => kind !== "approval_edit");

  test.each(locales)("holds no planted string, no @, no URL of the view and no button, in %s", (locale) => {
    for (const kind of kinds) {
      for (const webBaseUrl of [undefined, base]) {
        const result = renderNotice(kind, stored(kind), options(locale, webBaseUrl));
        expect(result.ok).toBe(true);
        if (!result.ok) continue;
        expect({ kind, canary: /canary/i.test(result.message.text) }).toEqual({ kind, canary: false });
        expect({ kind, at: result.message.text.includes("@") }).toEqual({ kind, at: false });
        expect({ kind, url: result.message.text.includes("panel.canary.test") }).toEqual({ kind, url: false });
        expect({ kind, buttons: result.message.buttons }).toEqual({ kind, buttons: [] });
      }
    }
  });

  test("the text ends with the panel link, or with 'Open the panel' without a base URL", () => {
    for (const locale of locales) {
      for (const kind of kinds.filter((kind) => kind !== "reply_prompt")) {
        const lines = (webBaseUrl?: string) => {
          const result = renderNotice(kind, stored(kind), options(locale, webBaseUrl));
          return result.ok ? result.message.text.split("\n") : [];
        };
        expect(lines(base).at(-1)).toMatch(/^https:\/\/ea\.example\.ts\.net\/[^/]/);
        expect(lines().at(-1)).toBe(minimalTexts(locale).openPanel);
      }
    }
  });

  test("the question that opens the reply box stays a fixed line with ForceReply", () => {
    const result = renderNotice("reply_prompt", stored("reply_prompt"), options("en", base));
    expect(result).toEqual({
      ok: true,
      message: { text: textTables.en.notices.replyDrafts.prompt, buttons: [], forceReply: true },
    });
  });

  test("an approval links to its page; the base URL has no double slash", () => {
    const result = renderNotice("approval", stored("approval"), options("en", `${base}/`));
    expect(result.ok && result.message.text.split("\n").at(-1)).toBe(`${base}/approvals?id=${id1}`);
    const set = renderNotice("approval_set", stored("approval_set"), options("en", `${base}//`));
    expect(set.ok && set.message.text.split("\n").at(-1)).toBe(`${base}/approvals`);
  });

  test("urgent opens the filtered Activity list and names a count, no mail id", () => {
    const result = renderNotice("urgent", stored("urgent"), options("en", base));
    expect(result).toEqual({
      ok: true,
      message: { text: `🔴 1 urgent mail\n${base}/activity?category=urgent`, buttons: [] },
    });
  });

  test("the count of a kind is the count of its items: replies, drafts of a set, sends on hold", () => {
    const text = (kind: NoticeKind, locale: UserLocale) => {
      const result = renderNotice(kind, stored(kind), options(locale, base));
      return result.ok ? result.message.text : "";
    };
    expect(text("replies_ready", "en")).toBe(`✍️ 3 replies are ready\n${base}/approvals`);
    expect(text("approval_set", "en")).toBe(`📝 2 drafts wait for you\n${base}/approvals`);
    expect(text("approval_set", "pl")).toBe(`📝 2 szkice czekają na Ciebie\n${base}/approvals`);
    expect(text("send_held", "en")).toBe(`⏳ 2 sends are on hold\n${base}/approvals`);
    expect(text("send_held", "pl")).toBe(`⏳ 2 wysyłki są wstrzymane\n${base}/approvals`);
  });

  test("the Polish count phrases of the notice kinds, word for word", () => {
    const line = (kind: Parameters<ReturnType<typeof minimalTexts>["line"]>[0], count: number) =>
      minimalTexts("pl").line(kind, count);
    expect(line("approval", 1)).toBe("📝 1 szkic czeka na Ciebie");
    expect(line("approval", 2)).toBe("📝 2 szkice czekają na Ciebie");
    expect(line("approval", 5)).toBe("📝 5 szkiców czeka na Ciebie");
    expect(line("approval_set", 5)).toBe("📝 5 szkiców czeka na Ciebie");
    expect(line("host_blocked", 1)).toBe("⛔ 1 skrzynka ma niedozwolony serwer");
    expect(line("host_blocked", 2)).toBe("⛔ 2 skrzynki mają niedozwolony serwer");
    expect(line("host_blocked", 5)).toBe("⛔ 5 skrzynek ma niedozwolony serwer");
    expect(line("trust_report_ready", 1)).toBe("📋 Wynik sprawdzenia skrzynki jest gotowy");
    expect(line("autonomy_paused", 1)).toBe("⏸ Wyłączono automatyczne przenoszenie dla jednej kategorii");
    expect(line("reply_result", 1)).toBe("✍️ Jest wynik Twojej prośby o odpowiedź");
  });

  test("the Polish mailbox-problem line has its plural forms (1, 2, 5, 12, 22)", () => {
    const line = (count: number) => minimalTexts("pl").mailboxProblems(count);
    expect([1, 2, 5, 12, 22].map(line)).toEqual([
      "⚠️ 1 skrzynka ma problem",
      "⚠️ 2 skrzynki mają problem",
      "⚠️ 5 skrzynek ma problem",
      "⚠️ 12 skrzynek ma problem",
      "⚠️ 22 skrzynki mają problem",
    ]);
  });

  test("a view the schema refuses, and a mail or push row with the detail minimal, do not render", () => {
    expect(renderNotice("urgent", { subject: "x" }, options("en", base))).toEqual({ ok: false });
    for (const channel of ["mail", "push"] as const) {
      expect(renderNotice("digest", stored("digest"), { ...options("en"), channel })).toEqual({ ok: false });
    }
  });

  test("the polish line of urgent has three plural forms (1, 2, 5)", () => {
    const line = (count: number) => minimalTexts("pl").line("urgent", count);
    expect(line(1)).toBe("🔴 1 pilna wiadomość");
    expect(line(2)).toBe("🔴 2 pilne wiadomości");
    expect(line(5)).toBe("🔴 5 pilnych wiadomości");
    expect(new Set([1, 2, 5].map((count) => line(count).replace(/^\S+ \d+ /, ""))).size).toBe(3);
  });

  test("the phrase table has an English and a Polish line for every kind", () => {
    // The three kinds that print a text of the full render are the exceptions: their lines are tested above.
    const own = noticeKinds.filter((kind) => !["approval_edit", "reply_prompt", "loop_consent"].includes(kind));
    for (const kind of own) {
      for (const locale of locales) {
        const text = minimalTexts(locale).line(kind as never, 1);
        expect({ kind, locale, empty: text.trim() === "" }).toEqual({ kind, locale, empty: false });
      }
      expect(minimalTexts("en").line(kind as never, 1)).not.toBe(minimalTexts("pl").line(kind as never, 1));
    }
  });
});

describe("minimal digest", () => {
  const mailbox = (address: string, status: "active" | "paused", lastSyncedAt: Date | null) => ({
    id: "m1",
    address,
    status,
    lastSyncedAt,
    statusChangedAt: now,
    mode: "assist" as const,
  });
  const item = (n: number, category: "urgent" | "info") => ({
    emailId: `0190a1b2-c3d4-7e5f-8a9b-${n.toString(16).padStart(12, "0")}`,
    category,
    from: `CANARYfrom${n} <canary${n}@canary.test>`,
    subject: `CANARYsubject ${n}`,
    receivedAt: now,
    synthetic: false,
    folderTag: null,
    aiText: "CANARYai",
    wouldDo: "CANARYwould",
    undoable: false,
  });
  const input: DigestInput = {
    kind: "scheduled",
    now: new Date("2026-11-06T07:00:00Z"),
    timeZone,
    slot: { date: "2026-11-06", time: "08:00", late: false },
    periodStart: new Date("2026-11-05T07:00:00Z"),
    mailboxes: [
      mailbox("CANARYok@canary.test", "active", new Date("2026-11-06T06:55:00Z")),
      mailbox("CANARYpaused@canary.test", "paused", null),
    ],
    counts: { urgent: 3, info: 2 },
    items: [item(1, "urgent"), item(2, "info")],
    skippedTooOld: 0,
    skippedBacklog: 0,
    waiting: 0,
    brief: {
      sections: null,
      loopConsent: true,
      owner: true,
      urgentEmailIds: [],
      openLoops: { waiting: 2, promised: 1 },
    },
  };

  test("the facts hold counts and the clock, no mail text and no address", () => {
    const { minimal } = renderDigestWithBrief(input, textTables.en);
    expect(JSON.stringify(minimal)).not.toMatch(/canary/i);
    expect(minimal.action).toEqual({ urgent: 3, needs_reply: 0, delegation: 0, unsure: 0 });
    expect(minimal.other).toEqual({ info: 2, notification: 0, spam: 0 });
    expect(minimal.mailboxProblems).toBe(1);
    expect(minimal.openLoops).toEqual({ waiting: 2, promised: 1 });
  });

  test("3 urgent and 2 info: the counts, no subject and no sender, the link to /activity", () => {
    const { minimal } = renderDigestWithBrief(input, textTables.en);
    const view = encodeNoticeView("digest", { text: "full text", buttons: [], minimal });
    const result = renderNotice("digest", view, options("en", base));
    expect(result).toEqual({
      ok: true,
      message: {
        text: [
          "📬 Digest 08:00 · Fri 6 Nov",
          "NEEDS ACTION · 3: 3 urgent",
          "OTHER MAIL · 2: 2 info",
          "⚠️ 1 mailbox has a problem",
          "🔁 Open loops: 2 waiting, 1 promise due",
          `${base}/activity`,
        ].join("\n"),
        buttons: [],
      },
    });
  });

  test("the open loops of the facts are the loop counts of the brief, the first digest of the day too; without them the count line", () => {
    const part = { lines: [], more: 0, hidden: 0 };
    const sections = { urgent: part, reply: part, waiting: part, promised: part, stale: part };
    const facts = (brief: Partial<NonNullable<DigestInput["brief"]>>) =>
      renderDigestWithBrief(
        {
          ...input,
          brief: { sections, loopConsent: false, owner: true, urgentEmailIds: [], openLoops: null, ...brief },
        },
        textTables.en
      ).minimal.openLoops;
    // A first digest with no consent: the sections hold the loops only, the counts hold loops and delegations.
    expect(facts({ loopCounts: { waiting: 3, promised: 1 } })).toEqual({ waiting: 3, promised: 1 });
    expect(facts({ openLoops: { waiting: 2, promised: 0 } })).toEqual({ waiting: 2, promised: 0 });
    expect(facts({})).toBeNull();
  });

  test("a late digest (now 08:40, slot 08:00): the header names the slot and says late", () => {
    const late = {
      ...input,
      now: new Date("2026-11-06T07:40:00Z"),
      slot: { date: "2026-11-06", time: "08:00", late: true },
    };
    const { minimal } = renderDigestWithBrief(late, textTables.en);
    expect(minimal.at.toISOString()).toBe("2026-11-06T07:00:00.000Z");
    expect(minimal.late).toBe(true);
    const view = encodeNoticeView("digest", { text: "t", buttons: [], minimal });
    const english = renderNotice("digest", view, options("en", base));
    expect(english.ok && english.message.text.split("\n")[0]).toBe("📬 Digest 08:00 · Fri 6 Nov (late)");
    const polish = renderNotice("digest", view, options("pl", base));
    expect(polish.ok && polish.message.text.split("\n")[0]).toBe("📬 Podsumowanie 08:00 · pt. 6 lis (spóźnione)");
  });

  test("every category keeps its own count: no two counts swap", () => {
    const counts = { urgent: 1, needs_reply: 2, delegation: 3, unsure: 4, info: 5, notification: 6, spam: 7 };
    const { minimal } = renderDigestWithBrief({ ...input, counts }, textTables.en);
    expect(minimal.action).toEqual({ urgent: 1, needs_reply: 2, delegation: 3, unsure: 4 });
    expect(minimal.other).toEqual({ info: 5, notification: 6, spam: 7 });
    const view = encodeNoticeView("digest", { text: "t", buttons: [], minimal });
    const result = renderNotice("digest", view, options("en", base));
    const lines = result.ok ? result.message.text.split("\n") : [];
    expect(lines).toContain("NEEDS ACTION · 10: 1 urgent, 2 reply, 3 delegate, 4 unsure");
    expect(lines).toContain("OTHER MAIL · 18: 5 info, 6 notification, 7 spam");
  });

  test("a mailbox that never synced or synced late counts as a problem, a fresh one does not", () => {
    const fresh = mailbox("a@canary.test", "active", new Date("2026-11-06T06:55:00Z"));
    const late = mailbox("b@canary.test", "active", new Date("2026-11-06T06:00:00Z"));
    const never = mailbox("c@canary.test", "active", null);
    const count = (mailboxes: DigestInput["mailboxes"]) =>
      renderDigestWithBrief({ ...input, mailboxes }, textTables.en).minimal.mailboxProblems;
    expect([count([fresh]), count([fresh, late]), count([fresh, late, never]), count([])]).toEqual([0, 1, 2, 0]);
  });

  test("the Polish digest and a digest on demand", () => {
    const { minimal } = renderDigestWithBrief(
      { ...input, kind: "on_demand", slot: null, brief: undefined },
      textTables.pl
    );
    expect(minimal.scheduled).toBe(false);
    expect(minimal.openLoops).toBeNull();
    const result = renderNotice(
      "digest",
      encodeNoticeView("digest", { text: "t", buttons: [], minimal }),
      options("pl")
    );
    expect(result.ok && result.message.text.split("\n")).toEqual([
      expect.stringContaining("📬 Podsumowanie teraz"),
      "WYMAGA DZIAŁANIA · 3: 3 pilne",
      "POZOSTAŁE · 2: 2 info",
      "⚠️ 1 skrzynka ma problem",
      "Otwórz panel",
    ]);
  });

  test("a digest row queued before the facts existed prints the fixed phrase and the link", () => {
    const result = renderNotice(
      "digest",
      encodeNoticeView("digest", { text: "CANARY", buttons: [] }),
      options("en", base)
    );
    expect(result).toEqual({ ok: true, message: { text: `📬 Your digest is ready\n${base}/activity`, buttons: [] } });
  });
});

describe("minimal weekly report, loop consent and card edit", () => {
  test("the weekly report prints two numbers and the link to /stats", () => {
    const week = weekStatsExample();
    const result = renderNotice("weekly_report", stored("weekly_report"), options("en", base));
    expect(result).toEqual({
      ok: true,
      message: {
        text: `📊 Weekly report · sorted: ${week.m4.triaged} · handled: ${week.m4.handled}\n${base}/stats`,
        buttons: [],
      },
    });
  });

  test("the loop consent line is the fixed line of the full render and not the URL of the view", () => {
    const result = renderNotice("loop_consent", stored("loop_consent"), options("en", base));
    expect(result).toEqual({
      ok: true,
      message: { text: `${textTables.en.notices.loopConsent.approval}\n${base}/approvals`, buttons: [] },
    });
  });

  test("the edit of a card keeps the stored text and one status line, and has no button", () => {
    const view = stored("approval_edit");
    for (const render of [
      renderNotice("approval_edit", view, options("en")),
      { ok: true as const, message: renderNoticeEdit(noticeViewSchemas.approval_edit.parse(view), options("en")) },
    ]) {
      expect(render.ok && render.message.text).toContain("CANARY stored card text");
      expect(render.ok && render.message.buttons).toEqual([]);
    }
    // The full edit of the same outcome keeps the Reject button: the guard is the minimal level only.
    const full = renderNotice("approval_edit", view, { ...options("en"), detail: "full" });
    expect(full.ok && full.message.buttons).toEqual([[{ text: "✖️ Reject", data: `ar:${id1}` }]]);
  });

  test("the minimal edit adds the panel link of the send when the stored text has none, once, and never at full", () => {
    const view = { ...(stored("approval_edit") as object), sendId: id1 };
    const link = `${base}/approvals?id=${id1}`;
    const withBase = renderNotice("approval_edit", view, options("en", base));
    expect(withBase.ok && withBase.message.text.endsWith(`\n${link}`)).toBe(true);
    expect(withBase.ok && withBase.message.buttons).toEqual([]);
    // No base URL: the fixed line, no URL.
    const noBase = renderNotice("approval_edit", view, options("pl"));
    expect(noBase.ok && noBase.message.text.endsWith("\nOtwórz panel")).toBe(true);
    // A card that has the link already (it went out at minimal) gets no second one.
    const had = { ...view, original: `Card\n${link}` };
    const again = renderNotice("approval_edit", had, options("en", base));
    expect(again.ok && again.message.text.split(link)).toHaveLength(2);
    // A view with no send id (queued before the field) has no link line; the full level never has one.
    const old = renderNotice("approval_edit", stored("approval_edit"), options("en", base));
    expect(old.ok && old.message.text).not.toContain("/approvals");
    const full = renderNotice("approval_edit", view, { ...options("en", base), detail: "full" });
    expect(full.ok && full.message.text).not.toContain("/approvals");
  });

  test("renderNoticeEdit takes the panel path of the card and adds it at minimal only", () => {
    const input = { ...noticeViewSchemas.approval_edit.parse(stored("approval_edit")), panelPath: "/approvals" };
    const minimal = renderNoticeEdit(input, options("en", base));
    expect(minimal.text.endsWith(`\n${base}/approvals`)).toBe(true);
    expect(minimal.buttons).toEqual([]);
    expect(renderNoticeEdit(input, { ...options("en", base), detail: "full" }).text).not.toContain(base);
  });
});
