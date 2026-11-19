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

  test("the first digest of the day counts the loops of its brief sections, the lines left out and the hidden ones", () => {
    const part = (more: number, hidden: number) => ({ lines: [], more, hidden });
    const sections = {
      urgent: part(0, 0),
      reply: part(0, 0),
      waiting: part(5, 0),
      promised: part(0, 4),
      stale: part(2, 0),
    };
    const { minimal } = renderDigestWithBrief(
      { ...input, brief: { sections, loopConsent: false, owner: true, urgentEmailIds: [], openLoops: null } },
      textTables.en
    );
    // The stale (closed) loops are not open loops.
    expect(minimal.openLoops).toEqual({ waiting: 5, promised: 4 });
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
      message: { text: `${textTables.en.notices.loopConsent.approval}\n${base}/settings`, buttons: [] },
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
});
