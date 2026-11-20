import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { GrammyError, HttpError } from "grammy";
import { sql, type Transaction } from "kysely";

import { auditEvents, hasAuditKey, recordAudit } from "../../src/modules/audit";
import { setMailboxStatus } from "../../src/modules/mail/repo";
import { createOperatorNotices } from "../../src/modules/operator";
import type { DB } from "../../src/platform/db";
import { setLogFormat, setLogLevel } from "../../src/platform/log";

import { createOrgWithMailbox, insertDraftAndSend, suspendOrg } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const NOW = new Date("2026-11-12T10:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// The log is JSON; `lines` holds every line of both console streams.
let lines: string[] = [];
let logSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  setLogFormat("json");
  lines = [];
  logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.join(" "));
  });
  errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    lines.push(args.join(" "));
  });
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  setLogFormat("text");
  setLogLevel("info");
});

const BASE_KEYS = ["time", "level", "module", "event", "msg"];
// A fake bot token: it passes the value rule of the logger, so only a correct field list keeps it out of a line.
const CANARY = "123456:MARKER-TOKEN";

interface LoggedEvent {
  level: string;
  fields: Record<string, unknown>;
}

// The `channels` event lines of one name: the level and the fields after the base keys. A dropped field shows as
// `dropped_fields`, so an exact match on `fields` also proves that every value passed the logger.
function eventsOf(event: string): LoggedEvent[] {
  return lines.flatMap((line) => {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (parsed.module !== "channels" || parsed.event !== event) return [];
    const fields = Object.fromEntries(Object.entries(parsed).filter(([key]) => !BASE_KEYS.includes(key)));
    return [{ level: String(parsed.level), fields }];
  });
}

function expectEvent(event: string, level: string, fields: Record<string, unknown>): void {
  expect(eventsOf(event)).toEqual([{ level, fields }]);
}

function expectNoMarker(): void {
  expect(lines.some((line) => line.includes("MARKER"))).toBe(false);
}

// A db whose `selectFrom`, `insertInto` or raw `sql` (`getExecutor`) throws an error that holds the canary in its message.
function failingDb(trx: Transaction<DB>, method: string): Transaction<DB> {
  return new Proxy(trx, {
    get(target, property) {
      if (property === method) {
        return () => {
          throw new Error(CANARY);
        };
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

async function setTrial(trx: Transaction<DB>, orgId: string, endsAt: Date): Promise<void> {
  await trx
    .updateTable("organizations")
    .set({ plan: "trial", trial_ends_at: endsAt })
    .where("id", "=", orgId)
    .execute();
}

async function noticeRows(trx: Transaction<DB>, orgId: string): Promise<{ kind: unknown; key: unknown }[]> {
  const rows = await trx
    .selectFrom("audit_log")
    .select("data")
    .where("org_id", "=", orgId)
    .where("event", "=", auditEvents.operatorNotice)
    .execute();
  return rows.map((row) => row.data as { kind: unknown; key: unknown });
}

function recorder(): { texts: string[]; send: (text: string) => Promise<void> } {
  const texts: string[] = [];
  return {
    texts,
    send: (text) => {
      texts.push(text);
      return Promise.resolve();
    },
  };
}

const mine = (texts: string[], ...ids: string[]): string[] =>
  texts.filter((text) => ids.some((id) => text.includes(id)));

describe("operator notices: hourly run", () => {
  test("trial_ending: one text for an org ending in 2 d, none for 5 d, no repeat", async () => {
    await withRollback(db, async (trx) => {
      const soon = await createOrgWithMailbox(trx);
      const later = await createOrgWithMailbox(trx);
      const endsAt = new Date(NOW.getTime() + 2 * DAY);
      await setTrial(trx, soon.orgId, endsAt);
      await setTrial(trx, later.orgId, new Date(NOW.getTime() + 5 * DAY));
      const { texts, send } = recorder();
      await createOperatorNotices({ db: trx, now: () => NOW, send, locale: "en" }).run();

      expect(mine(texts, soon.orgId)).toEqual([`Trial of org ${soon.orgId} ends ${endsAt.toISOString()}.`]);
      expect(mine(texts, later.orgId)).toEqual([]);
      const key = `trial_ending:${soon.orgId}:${endsAt.getTime()}`;
      expect(await noticeRows(trx, soon.orgId)).toEqual([{ kind: "trial_ending", key }]);

      // The row dedups, also for a new instance (no memory set).
      const before = texts.length;
      await createOperatorNotices({ db: trx, now: () => NOW, send, locale: "en" }).run();
      expect(texts.length).toBe(before);
      expect(await noticeRows(trx, soon.orgId)).toHaveLength(1);
    });
  });

  test("trial_ending: locale pl sends the Polish text (OPERATOR_LOCALE)", async () => {
    await withRollback(db, async (trx) => {
      const org = await createOrgWithMailbox(trx);
      const endsAt = new Date(NOW.getTime() + 2 * DAY);
      await setTrial(trx, org.orgId, endsAt);
      const { texts, send } = recorder();
      await createOperatorNotices({ db: trx, now: () => NOW, send, locale: "pl" }).run();
      expect(mine(texts, org.orgId)).toEqual([
        `Okres próbny organizacji ${org.orgId} kończy się ${endsAt.toISOString()}.`,
      ]);
    });
  });

  test("trial_ending: an ended trial gets the 'ended' text once", async () => {
    await withRollback(db, async (trx) => {
      const org = await createOrgWithMailbox(trx);
      const endsAt = new Date(NOW.getTime() - DAY);
      await setTrial(trx, org.orgId, endsAt);
      const { texts, send } = recorder();
      const notices = createOperatorNotices({ db: trx, now: () => NOW, send, locale: "en" });
      await notices.run();
      await notices.run();
      expect(mine(texts, org.orgId)).toEqual([`Trial of org ${org.orgId} ended ${endsAt.toISOString()}.`]);
    });
  });

  test("auth_error_24h: 25 h sends, 23 h does not, a new episode sends again", async () => {
    await withRollback(db, async (trx) => {
      const old = await createOrgWithMailbox(trx);
      const fresh = await createOrgWithMailbox(trx);
      const since = new Date(NOW.getTime() - 25 * HOUR);
      await setMailboxStatus(trx, { orgId: old.orgId }, old.mailboxId, "auth_error", since);
      await setMailboxStatus(
        trx,
        { orgId: fresh.orgId },
        fresh.mailboxId,
        "auth_error",
        new Date(NOW.getTime() - 23 * HOUR)
      );
      const { texts, send } = recorder();
      const notices = createOperatorNotices({ db: trx, now: () => NOW, send, locale: "en" });
      await notices.run();
      expect(mine(texts, old.mailboxId)).toEqual([
        `Mailbox ${old.mailboxId} of org ${old.orgId} has been in auth_error since ${since.toISOString()}.`,
      ]);
      expect(mine(texts, fresh.mailboxId)).toEqual([]);

      await notices.run();
      expect(mine(texts, old.mailboxId)).toHaveLength(1);

      // A new episode: active again, then auth_error with a new status_changed_at.
      await setMailboxStatus(trx, { orgId: old.orgId }, old.mailboxId, "active", new Date(NOW.getTime() - 20 * HOUR));
      const again = new Date(NOW.getTime() - 26 * HOUR + 1000);
      await setMailboxStatus(trx, { orgId: old.orgId }, old.mailboxId, "auth_error", again);
      await notices.run();
      expect(mine(texts, old.mailboxId)).toHaveLength(2);
    });
  });

  test("a suspended org gets no auth_error notice", async () => {
    await withRollback(db, async (trx) => {
      const org = await createOrgWithMailbox(trx);
      await setMailboxStatus(
        trx,
        { orgId: org.orgId },
        org.mailboxId,
        "auth_error",
        new Date(NOW.getTime() - 30 * HOUR)
      );
      await suspendOrg(trx, org.orgId);
      const { texts, send } = recorder();
      await createOperatorNotices({ db: trx, now: () => NOW, send, locale: "en" }).run();
      expect(mine(texts, org.orgId, org.mailboxId)).toEqual([]);
    });
  });

  test("a failed send writes no row and logs one error; the next run sends", async () => {
    await withRollback(db, async (trx) => {
      const org = await createOrgWithMailbox(trx);
      await setTrial(trx, org.orgId, new Date(NOW.getTime() + DAY));
      const texts: string[] = [];
      let failed = false;
      // Other orgs of the DB may send too: fail only the text of this org, once.
      const failOnce = (text: string): Promise<void> => {
        if (text.includes(org.orgId) && !failed) {
          failed = true;
          return Promise.reject(new Error("boom"));
        }
        texts.push(text);
        return Promise.resolve();
      };
      const notices = createOperatorNotices({ db: trx, now: () => NOW, send: failOnce, locale: "en" });
      await notices.run();
      expect(mine(texts, org.orgId)).toEqual([]);
      expect(await noticeRows(trx, org.orgId)).toEqual([]);
      expectEvent("operator_notice_send_failed", "error", { kind: "trial_ending", error: "Error" });

      await notices.run();
      expect(mine(texts, org.orgId)).toHaveLength(1);
      expect(await noticeRows(trx, org.orgId)).toHaveLength(1);
    });
  });

  test("send null: a warn line and the audit row", async () => {
    await withRollback(db, async (trx) => {
      const org = await createOrgWithMailbox(trx);
      await setTrial(trx, org.orgId, new Date(NOW.getTime() + DAY));
      await createOperatorNotices({ db: trx, now: () => NOW, send: null, locale: "en" }).run();
      // The run reads every organization of the DB: another file's committed organization may add a warn line of its own kind.
      expect(eventsOf("operator_notice_unsent")).toContainEqual({ level: "warn", fields: { kind: "trial_ending" } });
      expect(await noticeRows(trx, org.orgId)).toHaveLength(1);
    });
  });
});

// Rows written by an older release: the key is a literal string, never built by `operatorEventKey`, so a changed key format fails here.
describe("operator notices: rows of an earlier release", () => {
  const AT = new Date("2026-11-18T10:00:00Z");

  test("llm_cap: a row with the old key keeps the notice back", async () => {
    await withRollback(db, async (trx) => {
      const org = await createOrgWithMailbox(trx);
      const key = "llm_cap:22222222-2222-4222-8222-222222222222:2026-11-18T10:00:00.000Z";
      await recordAudit(
        trx,
        { orgId: org.orgId },
        {
          actor: "system",
          event: auditEvents.operatorNotice,
          data: { kind: "llm_cap", key },
        }
      );
      const { texts, send } = recorder();
      const notices = createOperatorNotices({ db: trx, now: () => AT, send, locale: "en" });
      notices.capReached({ orgId: org.orgId }, "22222222-2222-4222-8222-222222222222", AT, 300);
      await notices.idle();
      expect(texts).toEqual([]);
      expect(await noticeRows(trx, org.orgId)).toEqual([{ kind: "llm_cap", key }]);
    });
  });

  test("auth_error_24h: a row with the old key keeps the notice back", async () => {
    await withRollback(db, async (trx) => {
      const org = await createOrgWithMailbox(trx);
      await setMailboxStatus(trx, { orgId: org.orgId }, org.mailboxId, "auth_error", AT);
      const key = `auth_error_24h:${org.mailboxId}:1794996000000`;
      await recordAudit(
        trx,
        { orgId: org.orgId },
        {
          actor: "system",
          event: auditEvents.operatorNotice,
          data: { kind: "auth_error_24h", key },
        }
      );
      const { texts, send } = recorder();
      await createOperatorNotices({ db: trx, now: () => new Date(AT.getTime() + 25 * HOUR), send, locale: "en" }).run();
      expect(mine(texts, org.mailboxId)).toEqual([]);
      expect(await noticeRows(trx, org.orgId)).toEqual([{ kind: "auth_error_24h", key }]);
    });
  });
});

describe("operator notices: capReached", () => {
  const dayStart = new Date("2026-11-12T08:00:00Z");

  test("the same key sends once; the next day sends again", async () => {
    await withRollback(db, async (trx) => {
      const org = await createOrgWithMailbox(trx);
      const { texts, send } = recorder();
      const notices = createOperatorNotices({ db: trx, now: () => NOW, send, locale: "en" });
      notices.capReached({ orgId: org.orgId }, org.mailboxId, dayStart, 300);
      notices.capReached({ orgId: org.orgId }, org.mailboxId, dayStart, 300);
      await notices.idle();
      expect(texts).toEqual([
        `Mailbox ${org.mailboxId} of org ${org.orgId} reached the daily LLM cap (300 calls) on the quota day from ${dayStart.toISOString()}.`,
      ]);
      notices.capReached({ orgId: org.orgId }, org.mailboxId, new Date(dayStart.getTime() + DAY), 300);
      await notices.idle();
      expect(texts).toHaveLength(2);
    });
  });

  test("a send that never resolves does not block, and the same key starts no second send", async () => {
    await withRollback(db, async (trx) => {
      const org = await createOrgWithMailbox(trx);
      let calls = 0;
      const send = (): Promise<void> => {
        calls += 1;
        return new Promise<void>(() => undefined);
      };
      const notices = createOperatorNotices({ db: trx, now: () => NOW, send, locale: "en" });
      const started = performance.now();
      notices.capReached({ orgId: org.orgId }, org.mailboxId, dayStart, 300);
      expect(performance.now() - started).toBeLessThan(50);
      // Let the audit lookup finish so the send is reached.
      await Bun.sleep(100);
      notices.capReached({ orgId: org.orgId }, org.mailboxId, dayStart, 300);
      await Bun.sleep(100);
      expect(calls).toBe(1);
    });
  });

  test("a failed send: no row, no second try by capReached, the next run retries", async () => {
    await withRollback(db, async (trx) => {
      const org = await createOrgWithMailbox(trx);
      const texts: string[] = [];
      let fail = true;
      let calls = 0;
      const send = (text: string): Promise<void> => {
        if (!text.includes(org.mailboxId)) return Promise.resolve();
        calls += 1;
        if (fail) return Promise.reject(new Error("boom"));
        texts.push(text);
        return Promise.resolve();
      };
      const notices = createOperatorNotices({ db: trx, now: () => NOW, send, locale: "en" });
      notices.capReached({ orgId: org.orgId }, org.mailboxId, dayStart, 300);
      await notices.idle();
      expect(await noticeRows(trx, org.orgId)).toEqual([]);
      expect(calls).toBe(1);

      notices.capReached({ orgId: org.orgId }, org.mailboxId, dayStart, 300);
      await notices.idle();
      expect(calls).toBe(1);

      fail = false;
      await notices.run();
      expect(texts).toHaveLength(1);
      expect(await noticeRows(trx, org.orgId)).toHaveLength(1);
    });
  });
});

describe("operator notices: sendLimitReached", () => {
  const AT = new Date("2026-11-20T10:00:00Z");
  const until = new Date("2026-11-20T10:10:00Z");

  test("one text per mailbox and UTC day, with an audit row; the next day sends again", async () => {
    await withRollback(db, async (trx) => {
      const org = await createOrgWithMailbox(trx);
      const ctx = { orgId: org.orgId };
      const { texts, send } = recorder();
      const notices = createOperatorNotices({ db: trx, now: () => NOW, send, locale: "en" });
      notices.sendLimitReached(ctx, { mailboxId: org.mailboxId, limit: "mailbox_hour", until, at: AT });
      await notices.idle();
      expect(texts).toEqual([
        `Mailbox ${org.mailboxId} of org ${org.orgId} hit the send limit mailbox_hour at 2026-11-20T10:00:00.000Z; its sends wait until 2026-11-20T10:10:00.000Z.`,
      ]);
      expect(await noticeRows(trx, org.orgId)).toEqual([
        { kind: "send_limit", key: `send_limit:${org.mailboxId}:2026-11-20` },
      ]);

      const later = new Date(AT.getTime() + 3 * HOUR);
      notices.sendLimitReached(ctx, { mailboxId: org.mailboxId, limit: "mailbox_day", until, at: later });
      await notices.idle();
      expect(texts).toHaveLength(1);

      const nextDay = new Date("2026-11-21T00:30:00Z");
      notices.sendLimitReached(ctx, { mailboxId: org.mailboxId, limit: "mailbox_hour", until, at: nextDay });
      await notices.idle();
      expect(texts).toHaveLength(2);
    });
  });

  test("a failed send: no throw, no row, one label-only error line; the next run retries", async () => {
    await withRollback(db, async (trx) => {
      const org = await createOrgWithMailbox(trx);
      const ctx = { orgId: org.orgId };
      const texts: string[] = [];
      let fail = true;
      const send = (text: string): Promise<void> => {
        if (!text.includes(org.mailboxId)) return Promise.resolve();
        if (fail) return Promise.reject(new Error("boom secret@example.com"));
        texts.push(text);
        return Promise.resolve();
      };
      const notices = createOperatorNotices({ db: trx, now: () => NOW, send, locale: "en" });
      const hit = { mailboxId: org.mailboxId, limit: "recipient_day" as const, until, at: AT };
      expect(() => notices.sendLimitReached(ctx, hit)).not.toThrow();
      notices.sendLimitReached(ctx, hit);
      await notices.idle();
      expect(await noticeRows(trx, org.orgId)).toEqual([]);
      expectEvent("operator_notice_send_failed", "error", { kind: "send_limit", error: "Error" });
      expect(lines.some((line) => line.includes("secret"))).toBe(false);

      fail = false;
      await notices.run();
      expect(texts).toHaveLength(1);
      expect(await noticeRows(trx, org.orgId)).toHaveLength(1);
    });
  });

  test("(9) the hourly run sends one text for a held mailbox; a second run sends none", async () => {
    await withRollback(db, async (trx) => {
      const org = await createOrgWithMailbox(trx);
      const ctx = { orgId: org.orgId };
      const { sendId } = await insertDraftAndSend(trx, ctx, org.mailboxId, {
        sendStatus: "approved",
        approved: { userId: org.userId, at: new Date(NOW.getTime() - HOUR) },
        outgoingMessageId: `<${randomUUID()}@x.test>`,
      });
      await trx
        .updateTable("actions")
        .set({ last_error: "send_limit:recipient_day", next_attempt_at: new Date(NOW.getTime() + 10 * 60_000) })
        .where("id", "=", sendId)
        .execute();
      const { texts, send } = recorder();
      const notices = createOperatorNotices({ db: trx, now: () => NOW, send, locale: "en" });

      await notices.run();
      expect(mine(texts, org.mailboxId)).toEqual([
        `Mailbox ${org.mailboxId} of org ${org.orgId} hit the send limit recipient_day at 2026-11-12T10:00:00.000Z; its sends wait until 2026-11-12T10:10:00.000Z.`,
      ]);
      expect(await noticeRows(trx, org.orgId)).toEqual([
        { kind: "send_limit", key: `send_limit:${org.mailboxId}:2026-11-12` },
      ]);

      await notices.run();
      expect(mine(texts, org.mailboxId)).toHaveLength(1);
    });
  });

  test("the text holds no @", async () => {
    await withRollback(db, async (trx) => {
      const org = await createOrgWithMailbox(trx);
      const { texts, send } = recorder();
      const notices = createOperatorNotices({ db: trx, now: () => NOW, send, locale: "en" });
      notices.sendLimitReached(
        { orgId: org.orgId },
        { mailboxId: org.mailboxId, limit: "mailbox_hour", until, at: AT }
      );
      await notices.idle();
      expect(texts).toHaveLength(1);
      expect(texts[0]).not.toContain("@");
    });
  });
});

describe("operator notices: authMailFailed", () => {
  const day = new Date("2026-11-20T10:00:00Z");

  test("one text per user, code and UTC day, with an audit row", async () => {
    await withRollback(db, async (trx) => {
      const org = await createOrgWithMailbox(trx);
      const userId = randomUUID();
      const { texts, send } = recorder();
      const notices = createOperatorNotices({ db: trx, now: () => NOW, send, locale: "en" });
      notices.authMailFailed({ orgId: org.orgId }, userId, "reset", "EAUTH", day);
      notices.authMailFailed({ orgId: org.orgId }, userId, "reset", "EAUTH", day);
      await notices.idle();
      expect(texts).toEqual([`Auth mail reset to user ${userId} of org ${org.orgId} failed (EAUTH).`]);
      expect(await noticeRows(trx, org.orgId)).toEqual([
        { kind: "auth_mail_failed", key: `auth_mail_failed:${userId}:EAUTH:2026-11-20` },
      ]);

      notices.authMailFailed({ orgId: org.orgId }, userId, "reset", "ETIMEDOUT", day);
      await notices.idle();
      expect(texts).toHaveLength(2);

      notices.authMailFailed({ orgId: org.orgId }, userId, "reset", "EAUTH", new Date("2026-11-21T00:30:00Z"));
      await notices.idle();
      expect(texts).toHaveLength(3);
    });
  });

  test("without a send function: a warn line and the audit row", async () => {
    await withRollback(db, async (trx) => {
      const org = await createOrgWithMailbox(trx);
      const userId = randomUUID();
      const notices = createOperatorNotices({ db: trx, now: () => NOW, send: null, locale: "en" });
      notices.authMailFailed({ orgId: org.orgId }, userId, "invite", "EAUTH", day);
      await notices.idle();
      expectEvent("operator_notice_unsent", "warn", { kind: "auth_mail_failed" });
      expect(await noticeRows(trx, org.orgId)).toHaveLength(1);
    });
  });

  test("a send that throws: the call returns, no audit row", async () => {
    await withRollback(db, async (trx) => {
      const org = await createOrgWithMailbox(trx);
      const send = (): Promise<void> => Promise.reject(new Error("boom"));
      const notices = createOperatorNotices({ db: trx, now: () => NOW, send, locale: "en" });
      expect(() => notices.authMailFailed({ orgId: org.orgId }, randomUUID(), "lockout", "EAUTH", day)).not.toThrow();
      await notices.idle();
      expect(await noticeRows(trx, org.orgId)).toEqual([]);
    });
  });
});

test("no private data: a notice text holds ids, dates and counts only", async () => {
  await withRollback(db, async (trx) => {
    const org = await createOrgWithMailbox(trx);
    const { texts, send } = recorder();
    const notices = createOperatorNotices({ db: trx, now: () => NOW, send, locale: "en" });
    notices.capReached({ orgId: org.orgId }, org.mailboxId, NOW, 300);
    await notices.idle();
    expect(texts[0]).not.toContain("@");
    expect(texts[0]).not.toContain("Org ");
  });
});

test("hasAuditKey filters by organization and key", async () => {
  await withRollback(db, async (trx) => {
    const a = await createOrgWithMailbox(trx);
    const b = await createOrgWithMailbox(trx);
    await recordAudit(
      trx,
      { orgId: a.orgId },
      { actor: "system", event: auditEvents.operatorNotice, data: { kind: "llm_cap", key: "k1" } }
    );
    expect(await hasAuditKey(trx, { orgId: a.orgId }, auditEvents.operatorNotice, "k1")).toBe(true);
    expect(await hasAuditKey(trx, { orgId: a.orgId }, auditEvents.operatorNotice, "k2")).toBe(false);
    expect(await hasAuditKey(trx, { orgId: b.orgId }, auditEvents.operatorNotice, "k1")).toBe(false);
  });
});

describe("operator notices: log events", () => {
  test("no operator chat: the unsent event holds the kind, never the notice text", async () => {
    await withRollback(db, async (trx) => {
      const org = await createOrgWithMailbox(trx);
      const notices = createOperatorNotices({ db: trx, now: () => NOW, send: null, locale: "en" });
      notices.authMailFailed({ orgId: org.orgId }, randomUUID(), "reset", "MARKER-NOTICE-TEXT", NOW);
      await notices.idle();
      expectEvent("operator_notice_unsent", "warn", { kind: "auth_mail_failed" });
      expectNoMarker();
      // The audit row keeps the text of the notice: the code stays in its key.
      expect(await noticeRows(trx, org.orgId)).toHaveLength(1);
    });
  });

  const telegramErrors: [string, () => unknown, Record<string, unknown>][] = [
    [
      "a GrammyError",
      () =>
        new GrammyError(
          "Call to 'sendMessage' failed!",
          { ok: false, error_code: 403, description: CANARY },
          "sendMessage",
          { text: CANARY }
        ),
      { error: "GrammyError", error_code: 403, method: "sendMessage" },
    ],
    [
      "an HttpError",
      () =>
        new HttpError(
          "Network request for 'sendMessage' failed!",
          new Error(`https://api.telegram.org/bot${CANARY}/x`)
        ),
      { error: "HttpError", method: "sendMessage" },
    ],
    ["another error", () => new Error(CANARY), { error: "Error" }],
  ];

  for (const [name, make, expected] of telegramErrors) {
    test(`a failed send of ${name} writes operator_notice_send_failed with fields only`, async () => {
      await withRollback(db, async (trx) => {
        const org = await createOrgWithMailbox(trx);
        const send = (): Promise<void> => Promise.reject(make());
        const notices = createOperatorNotices({ db: trx, now: () => NOW, send, locale: "en" });
        notices.capReached({ orgId: org.orgId }, org.mailboxId, NOW, 300);
        await notices.idle();
        expectEvent("operator_notice_send_failed", "error", { kind: "llm_cap", ...expected });
        expectNoMarker();
      });
    });
  }

  test("a failed audit lookup writes operator_notice_failed with the error name only", async () => {
    await withRollback(db, async (trx) => {
      const org = await createOrgWithMailbox(trx);
      const notices = createOperatorNotices({
        db: failingDb(trx, "selectFrom"),
        now: () => NOW,
        send: recorder().send,
        locale: "en",
      });
      notices.capReached({ orgId: org.orgId }, org.mailboxId, NOW, 300);
      await notices.idle();
      expectEvent("operator_notice_failed", "error", { kind: "llm_cap", error: "Error" });
      expectNoMarker();
    });
  });

  test("a failed audit write after the send writes operator_notice_failed with the error name only", async () => {
    await withRollback(db, async (trx) => {
      const org = await createOrgWithMailbox(trx);
      const { texts, send } = recorder();
      const notices = createOperatorNotices({ db: failingDb(trx, "insertInto"), now: () => NOW, send, locale: "en" });
      notices.capReached({ orgId: org.orgId }, org.mailboxId, NOW, 300);
      await notices.idle();
      expect(texts).toHaveLength(1);
      expectEvent("operator_notice_failed", "error", { kind: "llm_cap", error: "Error" });
      expectNoMarker();
    });
  });

  test("a failed hourly run writes one operator_notices_failed per failed part, error name only", async () => {
    await withRollback(db, async (trx) => {
      const notices = createOperatorNotices({
        db: failingDb(trx, "selectFrom"),
        now: () => NOW,
        send: recorder().send,
        locale: "en",
      });
      await notices.run();
      // organizations, auth errors and send limits read the database; the retries do not.
      expect(eventsOf("operator_notices_failed")).toEqual(
        Array.from({ length: 3 }, () => ({ level: "error", fields: { error: "Error" } }))
      );
      expectNoMarker();
    });
  });

  test("a failed send limit read for one org writes operator_notice_failed for kind send_limit", async () => {
    await withRollback(db, async (trx) => {
      await createOrgWithMailbox(trx);
      const notices = createOperatorNotices({
        db: failingDb(trx, "getExecutor"),
        now: () => NOW,
        send: recorder().send,
        locale: "en",
      });
      await notices.run();
      const events = eventsOf("operator_notice_failed");
      expect(events.length).toBeGreaterThan(0);
      for (const event of events)
        expect(event).toEqual({ level: "error", fields: { kind: "send_limit", error: "Error" } });
      expectNoMarker();
    });
  });

  test("an invalid date makes the guarded entry points write operator_notice_failed with the error name", async () => {
    await withRollback(db, async (trx) => {
      const org = await createOrgWithMailbox(trx);
      const ctx = { orgId: org.orgId };
      const invalid = new Date(Number.NaN);
      const notices = createOperatorNotices({ db: trx, now: () => NOW, send: recorder().send, locale: "en" });
      notices.capReached(ctx, org.mailboxId, invalid, 300);
      notices.authMailFailed(ctx, randomUUID(), "reset", "EAUTH", invalid);
      notices.sendLimitReached(ctx, { mailboxId: org.mailboxId, limit: "mailbox_hour", until: NOW, at: invalid });
      await notices.idle();
      const kinds = eventsOf("operator_notice_failed").map((event) => {
        expect(event.level).toBe("error");
        expect(event.fields.error).toBe("RangeError");
        return event.fields.kind;
      });
      expect(kinds.sort()).toEqual(["auth_mail_failed", "llm_cap", "send_limit"]);
    });
  });

  test("a row the hourly run cannot read writes operator_notice_failed for its kind", async () => {
    await withRollback(db, async (trx) => {
      const trial = await createOrgWithMailbox(trx);
      await sql`update organizations set plan = 'trial', trial_ends_at = 'infinity' where id = ${trial.orgId}`.execute(
        trx
      );
      const auth = await createOrgWithMailbox(trx);
      await sql`update mailboxes set status = 'auth_error', status_changed_at = '-infinity' where id = ${auth.mailboxId}`.execute(
        trx
      );
      await createOperatorNotices({ db: trx, now: () => NOW, send: recorder().send, locale: "en" }).run();
      const events = eventsOf("operator_notice_failed");
      for (const kind of ["trial_ending", "auth_error_24h"]) {
        expect(events.filter((event) => event.fields.kind === kind)).toEqual([
          { level: "error", fields: { kind, error: "TypeError" } },
        ]);
      }
    });
  });
});
