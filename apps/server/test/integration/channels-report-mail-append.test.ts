import { randomUUID } from "node:crypto";

import { MINUTE_MS, HOUR_MS, DAY_MS } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";
import { simpleParser, type AddressObject } from "mailparser";

import {
  createImapReportMailbox,
  createReportMailSender,
  createOutboxSender,
  insertOutbox,
  REPORT_MAIL_WAIT_MS,
  ReportMailError,
  type ReportMailbox,
} from "../../src/modules/channels";
import { createFakeChannel } from "../../src/modules/channels/fake/channel";
import {
  MailAuthError,
  OAuthGrantError,
  setMailboxStatus,
  type MailboxStatus,
  type MailProvider,
} from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import { insertCredentials, insertMailbox } from "../../src/modules/mail/repo";
import { insertDigest } from "../../src/modules/reports";
import { setMemberReportChannel, setOrgFeature } from "../../src/modules/tenancy";
import { loadConfig } from "../../src/platform/config";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB, TenantContext } from "../../src/platform/db";
import { HardError, SoftError } from "../../src/platform/errors";

import { createOrgWithMailbox, isolateChannels, testCapabilities } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// ADR 0022: the report mail sender APPENDs the `mail` rows of the outbox into the INBOX of their mailbox. The mail
// server here is the fake provider; `trust-report-mail-greenmail.test.ts` runs the same path against GreenMail.
const db = testDb();
const config = loadConfig();
const secrets = createSecretBox(config.CREDENTIALS_KEY, config.CREDENTIALS_KEY_VERSION);

afterAll(async () => {
  await db.destroy();
});

let spies: ReturnType<typeof spyOn>[] = [];
let errorLines: string[] = [];

beforeEach(() => {
  errorLines = [];
  spies = [
    spyOn(console, "log").mockImplementation((): void => undefined),
    // `warn` and `error` lines of the log module go to console.error.
    spyOn(console, "error").mockImplementation((...args: unknown[]): void => void errorLines.push(args.join(" "))),
    spyOn(console, "warn").mockImplementation((): void => undefined),
  ];
});

afterEach(() => {
  for (const spy of spies) spy.mockRestore();
});

// 11:00 in Europe/Warsaw (UTC+1): outside the default quiet hours 22:00-07:00.
const T = new Date("2026-11-17T10:00:00Z");
const BASE = "https://app.example.test";

interface Box {
  ctx: TenantContext;
  orgId: string;
  userId: string;
  mailboxId: string;
  address: string;
  fake: FakeMailProvider;
  appended: { raw: Buffer; flags: string[] }[];
  opened: { count: number };
  port: ReportMailbox;
}

interface BoxOptions {
  channel?: "telegram" | "mail" | "both";
  flag?: boolean;
  status?: MailboxStatus;
  openProvider?: () => Promise<MailProvider>;
}

// One organization: an owner who chose `mail`, a mailbox with a stored password, the flag on, a fake mail server that records its APPENDs.
async function box(trx: Transaction<DB>, opts: BoxOptions = {}): Promise<Box> {
  await isolateChannels(trx);
  const address = `box-${randomUUID()}@x.test`;
  const { orgId, userId, mailboxId } = await createOrgWithMailbox(trx, { address });
  const ctx = { orgId };
  const secret = secrets.encrypt("pw", `mailbox:${mailboxId}`);
  await insertCredentials(trx, ctx, {
    mailboxId,
    encryptedSecret: secret.ciphertext,
    secretKind: "password",
    keyVersion: secret.keyVersion,
  });
  await setMemberReportChannel(trx, ctx, userId, { channel: opts.channel ?? "mail", mailboxId });
  if (opts.flag !== false) await setOrgFeature(trx, ctx, { flag: "report_mail", enabled: true, actor: "cli", now: T });
  if (opts.status !== undefined) await setMailboxStatus(trx, ctx, mailboxId, opts.status, T);
  const fake = createFakeMailProvider();
  const appended: Box["appended"] = [];
  const opened = { count: 0 };
  const open = async (): Promise<MailProvider> => {
    opened.count += 1;
    if (opts.openProvider !== undefined) return opts.openProvider();
    return {
      ...fake,
      appendMessage: async (folder, raw, flags, internalDate) => {
        appended.push({ raw: Buffer.from(raw), flags });
        return fake.appendMessage(folder, raw, flags, internalDate);
      },
    };
  };
  const port = createImapReportMailbox({ db: trx, secrets, openProvider: open, now: () => T });
  return { ctx, orgId, userId, mailboxId, address, fake, appended, opened, port };
}

function sender(trx: Transaction<DB>, b: Box, now: Date = T, port: ReportMailbox = b.port) {
  return createReportMailSender({ db: trx, mailbox: port, now: () => now, webBaseUrl: BASE });
}

let slotCount = 0;

type Kind = "digest" | "weekly_report" | "trust_report_ready" | "autonomy_paused";

// A `mail` row. A digest row needs its digest; the other kinds take a view of their own.
async function mailRow(
  trx: Transaction<DB>,
  b: Box,
  opts: { kind?: Kind; locale?: "en" | "pl"; createdAt?: Date; view?: Record<string, unknown>; mailboxId?: string } = {}
): Promise<string> {
  const kind = opts.kind ?? "digest";
  const createdAt = opts.createdAt ?? T;
  let digestId: string | undefined;
  if (kind === "digest") {
    const id = await insertDigest(trx, b.ctx, {
      userId: b.userId,
      slotKey: `${new Date(Date.UTC(2026, 0, 1 + slotCount++)).toISOString().slice(0, 10)}T08:00`,
      periodStart: new Date(createdAt.getTime() - DAY_MS),
      periodEnd: createdAt,
    });
    digestId = id ?? undefined;
  }
  const views: Record<Kind, Record<string, unknown>> = {
    digest: {
      text: `📬 Digest\n1 mail needs action.\nOpen the panel: ${BASE}/activity?category=spam.\nFrom: <b>evil@attacker.test</b> https://attacker.test/x\n<form action="https://attacker.test"><input></form>`,
      buttons: [],
    },
    weekly_report: {},
    trust_report_ready: {
      mailboxId: b.mailboxId,
      recommended: ["info"],
      blocked: 0,
      checked: 40,
      reportUrl: `${BASE}/report?mailbox=${b.mailboxId}`,
    },
    autonomy_paused: {
      mailboxId: b.mailboxId,
      category: "info",
      reason: "model_switch",
      corrections: 0,
      settingsUrl: `${BASE}/settings`,
    },
  };
  const id = await insertOutbox(trx, b.ctx, {
    userId: b.userId,
    kind,
    dedupKey: `${kind}:${randomUUID()}:mail`,
    mailboxId: opts.mailboxId ?? b.mailboxId,
    ...(digestId === undefined ? {} : { digestId }),
    view: opts.view ?? views[kind],
    locale: opts.locale ?? "en",
    channel: "mail",
    createdAt,
    nextAttemptAt: createdAt,
  });
  if (id === null) throw new Error("no mail row");
  return id;
}

function addressesOf(field: AddressObject | AddressObject[] | undefined): (string | undefined)[] {
  const objects = field === undefined ? [] : Array.isArray(field) ? field : [field];
  return objects.flatMap((object) => object.value.map((entry) => entry.address));
}

const stateOf = (trx: Transaction<DB>, id: string) =>
  trx
    .selectFrom("outbox")
    .select(["status", "attempts", "locked_at", "error_code", "external_message_id", "next_attempt_at", "sent_at"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();

describe("step 1: the sender APPENDs a mail row into the INBOX", () => {
  test("1: a digest row becomes one message in the INBOX; the row is sent", async () => {
    await withRollback(db, async (trx) => {
      const b = await box(trx);
      const id = await mailRow(trx, b);
      await sender(trx, b).run();

      expect(b.appended).toHaveLength(1);
      const first = b.appended[0];
      if (first === undefined) throw new Error("nothing appended");
      expect(first.flags).toEqual([]);
      const parsed = await simpleParser(first.raw);
      expect(parsed.subject).toBe("[Email assistant] Digest");
      expect(parsed.headers.get("x-ea-action-id")).toBe(id);
      expect(parsed.messageId).toBe(`<ea-report-${id}@x.test>`);
      // The only address in the headers is the mailbox itself.
      expect(addressesOf(parsed.to)).toEqual([b.address]);
      expect(addressesOf(parsed.from)).toEqual([b.address]);
      expect(parsed.cc).toBeUndefined();
      expect(parsed.bcc).toBeUndefined();
      const headerBlock = first.raw.toString("utf8").split("\r\n\r\n")[0] ?? "";
      expect(headerBlock).not.toContain("attacker");
      // Text and HTML parts; the HTML has no form and every link starts with the base.
      expect(parsed.text).toContain("1 mail needs action.");
      const html = parsed.html === false ? "" : (parsed.html ?? "");
      expect(html).not.toContain("<form");
      const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
      expect(hrefs).toEqual([`${BASE}/activity?category=spam`]);
      expect(html).toContain("&lt;form");
      // The INBOX of the fake holds the message; the row is sent with no Telegram message id.
      expect((await b.fake.fetchAbove("INBOX", 0)).map((meta) => meta.actionId)).toEqual([id]);
      expect(await stateOf(trx, id)).toMatchObject({ status: "sent", external_message_id: null, locked_at: null });
      // The digest of a mail-only member is sent with its mail row.
      const digest = await trx
        .selectFrom("digests")
        .select("sent_at")
        .where("org_id", "=", b.orgId)
        .executeTakeFirstOrThrow();
      expect(digest.sent_at?.toISOString()).toBe(T.toISOString());
      // A second run appends nothing more.
      await sender(trx, b, new Date(T.getTime() + MINUTE_MS)).run();
      expect(b.appended).toHaveLength(1);
    });
  });

  test("trust reports are appended; a bad view and a kind outside the four never are", async () => {
    await withRollback(db, async (trx) => {
      const b = await box(trx);
      const ids = [
        await mailRow(trx, b, { kind: "weekly_report", view: {} }),
        await mailRow(trx, b, { kind: "trust_report_ready" }),
        await mailRow(trx, b, { kind: "autonomy_paused" }),
      ];
      await sender(trx, b).run();
      // A weekly row with a view that does not render is a bad row: it fails and nothing is appended for it.
      expect(await stateOf(trx, ids[0] ?? "")).toMatchObject({ status: "failed", error_code: "bad_view" });
      expect(await stateOf(trx, ids[1] ?? "")).toMatchObject({ status: "sent" });
      expect(await stateOf(trx, ids[2] ?? "")).toMatchObject({ status: "sent" });
      const subjects = await Promise.all(b.appended.map(async (entry) => (await simpleParser(entry.raw)).subject));
      expect(subjects.sort()).toEqual([
        "[Email assistant] Automatic moves paused",
        "[Email assistant] Mailbox check ready",
      ]);

      // A kind outside the four, with channel mail, is a bad row: the renderer has no mail form for it.
      const other = await insertOutbox(trx, b.ctx, {
        userId: b.userId,
        kind: "sync_ok",
        dedupKey: `sync_ok:${randomUUID()}:mail`,
        mailboxId: b.mailboxId,
        view: { address: "x@x.test", lastSyncedAt: T.toISOString(), now: T.toISOString(), timeZone: "Europe/Warsaw" },
        locale: "en",
        channel: "mail",
        createdAt: T,
        nextAttemptAt: T,
      });
      await sender(trx, b, new Date(T.getTime() + MINUTE_MS)).run();
      expect(await stateOf(trx, other ?? "")).toMatchObject({ status: "failed", error_code: "bad_view" });
      expect(b.appended).toHaveLength(2);
    });
  });

  test("3: a Polish member gets the Polish prefix", async () => {
    await withRollback(db, async (trx) => {
      const b = await box(trx);
      await mailRow(trx, b, { locale: "pl" });
      await sender(trx, b).run();
      const first = b.appended[0];
      expect((await simpleParser(first?.raw ?? Buffer.alloc(0))).subject).toBe("[Asystent poczty] Podsumowanie");
    });
  });

  test("2: a paused mailbox: the row waits with no attempt and no login; after 24 h it expires", async () => {
    await withRollback(db, async (trx) => {
      for (const status of ["paused", "auth_error", "host_blocked"] as const) {
        const b = await box(trx, { status });
        const id = await mailRow(trx, b);
        await sender(trx, b).run();
        expect(b.opened.count).toBe(0);
        expect(b.appended).toHaveLength(0);
        const waiting = await stateOf(trx, id);
        expect(waiting).toMatchObject({ status: "pending", attempts: 0, error_code: null, locked_at: null });
        expect(waiting.next_attempt_at.toISOString()).toBe(new Date(T.getTime() + REPORT_MAIL_WAIT_MS).toISOString());
        // The mailbox is active again: the next run sends.
        await setMailboxStatus(trx, b.ctx, b.mailboxId, "active", T);
        await sender(trx, b, new Date(T.getTime() + REPORT_MAIL_WAIT_MS)).run();
        expect(await stateOf(trx, id)).toMatchObject({ status: "sent" });
      }
      const stuck = await box(trx, { status: "paused" });
      const old = await mailRow(trx, stuck);
      await sender(trx, stuck, new Date(T.getTime() + 25 * HOUR_MS)).run();
      expect(await stateOf(trx, old)).toMatchObject({ status: "failed", error_code: "expired", locked_at: null });
      expect(stuck.appended).toHaveLength(0);
      // A younger row of the same mailbox waits.
      const young = await mailRow(trx, stuck, { createdAt: new Date(T.getTime() + 2 * HOUR_MS) });
      await sender(trx, stuck, new Date(T.getTime() + 25 * HOUR_MS)).run();
      expect(await stateOf(trx, young)).toMatchObject({ status: "pending", error_code: null });
    });
  });

  test("the status is read again after the claim: a mailbox paused after the row was queued takes no mail", async () => {
    await withRollback(db, async (trx) => {
      const b = await box(trx);
      const id = await mailRow(trx, b);
      // The row was queued while the mailbox was active; the pause came after.
      await setMailboxStatus(trx, b.ctx, b.mailboxId, "paused", T);
      await sender(trx, b).run();
      expect(b.appended).toHaveLength(0);
      expect(await stateOf(trx, id)).toMatchObject({ status: "pending", attempts: 0 });
    });
  });

  test("the flag off at send time: nothing is appended and the row waits", async () => {
    await withRollback(db, async (trx) => {
      const b = await box(trx, { flag: false });
      const id = await mailRow(trx, b);
      await sender(trx, b).run();
      expect(b.opened.count).toBe(0);
      expect(await stateOf(trx, id)).toMatchObject({ status: "pending", attempts: 0 });
      await setOrgFeature(trx, b.ctx, { flag: "report_mail", enabled: true, actor: "cli", now: T });
      await sender(trx, b, new Date(T.getTime() + REPORT_MAIL_WAIT_MS)).run();
      expect(await stateOf(trx, id)).toMatchObject({ status: "sent" });
    });
  });

  test("a member who went back to Telegram, or chose another mailbox, gets no mail: the row is outdated", async () => {
    await withRollback(db, async (trx) => {
      const b = await box(trx);
      const back = await mailRow(trx, b);
      await setMemberReportChannel(trx, b.ctx, b.userId, { channel: "telegram", mailboxId: null });
      await sender(trx, b).run();
      expect(await stateOf(trx, back)).toMatchObject({ status: "failed", error_code: "outdated" });

      // The channel is `telegram` again but the mailbox is still stored: no mail either.
      const t = await box(trx);
      const kept = await mailRow(trx, t);
      await setMemberReportChannel(trx, t.ctx, t.userId, { channel: "telegram", mailboxId: t.mailboxId });
      await sender(trx, t).run();
      expect(await stateOf(trx, kept)).toMatchObject({ status: "failed", error_code: "outdated" });
      expect(t.appended).toHaveLength(0);

      const c = await box(trx);
      const other = await mailRow(trx, c);
      const second = randomUUID();
      await insertMailbox(trx, c.ctx, {
        id: second,
        address: `second-${second}@x.test`,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: {},
      });
      await setMemberReportChannel(trx, c.ctx, c.userId, { channel: "mail", mailboxId: second });
      await sender(trx, c).run();
      expect(await stateOf(trx, other)).toMatchObject({ status: "failed", error_code: "outdated" });
      expect(b.appended).toHaveLength(0);
      expect(c.appended).toHaveLength(0);
    });
  });

  test("a network error: the row backs off and counts an attempt; the next row of the mailbox waits; one message in the end", async () => {
    await withRollback(db, async (trx) => {
      const b = await box(trx);
      const first = await mailRow(trx, b, { createdAt: new Date(T.getTime() - 2 * MINUTE_MS) });
      const second = await mailRow(trx, b, { createdAt: new Date(T.getTime() - MINUTE_MS) });
      b.fake.failOn("appendMessage", new SoftError("lost connection"));
      await sender(trx, b).run();
      const hit = await stateOf(trx, first);
      expect(hit).toMatchObject({ status: "pending", attempts: 1 });
      expect(hit.next_attempt_at.toISOString()).toBe(new Date(T.getTime() + 30_000).toISOString());
      // The second row is held until the same time and counts no attempt.
      expect(await stateOf(trx, second)).toMatchObject({ status: "pending", attempts: 0 });
      expect(b.appended).toHaveLength(1);
      expect((await b.fake.fetchAbove("INBOX", 0)).length).toBe(0);
      await sender(trx, b, new Date(T.getTime() + 31_000)).run();
      expect((await stateOf(trx, first)).status).toBe("sent");
      expect((await stateOf(trx, second)).status).toBe("sent");
      expect((await b.fake.fetchAbove("INBOX", 0)).length).toBe(2);
    });
  });

  test("a refused APPEND (NO) fails the row as append_refused and is not tried again", async () => {
    await withRollback(db, async (trx) => {
      const b = await box(trx);
      const id = await mailRow(trx, b);
      b.fake.failOn("appendMessage", new HardError("NO [OVERQUOTA]"), 5);
      await sender(trx, b).run();
      expect(await stateOf(trx, id)).toMatchObject({ status: "failed", error_code: "append_refused", locked_at: null });
      await sender(trx, b, new Date(T.getTime() + HOUR_MS)).run();
      expect(b.appended).toHaveLength(1);
    });
  });

  test("a refused login leaves the row waiting with no attempt", async () => {
    await withRollback(db, async (trx) => {
      const b = await box(trx, {
        openProvider: async () => {
          throw new MailAuthError("IMAP login failed");
        },
      });
      const id = await mailRow(trx, b);
      await sender(trx, b).run();
      const waiting = await stateOf(trx, id);
      expect(waiting).toMatchObject({ status: "pending", attempts: 0 });
      expect(waiting.next_attempt_at.toISOString()).toBe(new Date(T.getTime() + REPORT_MAIL_WAIT_MS).toISOString());
    });
  });

  test("another failure to connect backs off and fails the row after five attempts", async () => {
    await withRollback(db, async (trx) => {
      const b = await box(trx, {
        openProvider: async () => {
          throw new HardError("IMAP connect failed");
        },
      });
      const id = await mailRow(trx, b);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await sender(trx, b, new Date(T.getTime() + attempt * HOUR_MS)).run();
      }
      expect(await stateOf(trx, id)).toMatchObject({ status: "failed", error_code: "too_many_errors" });
    });
  });

  test("quiet hours hold a trust report, not a digest", async () => {
    await withRollback(db, async (trx) => {
      const b = await box(trx);
      const night = new Date("2026-11-17T22:30:00Z"); // 23:30 in Warsaw
      const trust = await mailRow(trx, b, { kind: "trust_report_ready", createdAt: night });
      const digest = await mailRow(trx, b, { createdAt: night });
      await sender(trx, b, night).run();
      expect(await stateOf(trx, digest)).toMatchObject({ status: "sent" });
      const held = await stateOf(trx, trust);
      expect(held).toMatchObject({ status: "pending", attempts: 0 });
      // 07:00 Warsaw the next morning.
      expect(held.next_attempt_at.toISOString()).toBe("2026-11-18T06:00:00.000Z");
      expect(b.appended).toHaveLength(1);
    });
  });

  test("a row that a crash left `sending` is appended again after the stale time, with one warn line (at least once)", async () => {
    await withRollback(db, async (trx) => {
      const b = await box(trx);
      const id = await mailRow(trx, b);
      await trx
        .updateTable("outbox")
        .set({ status: "sending", locked_at: new Date(T.getTime() - 10 * MINUTE_MS) })
        .where("id", "=", id)
        .execute();
      await sender(trx, b).run();
      expect(b.appended).toHaveLength(1);
      expect((await stateOf(trx, id)).status).toBe("sent");
      expect(errorLines.some((line) => line.includes("outbox_mail_resent_after_stale"))).toBe(true);
    });
  });

  test("the sender and the adapter have no way to send: no SMTP, Graph or recipient code", async () => {
    const files = ["report-mail-sender.ts", "report-mailbox.ts", "report-mailbox-imap.ts"];
    for (const file of files) {
      const source = await Bun.file(`${import.meta.dir}/../../src/modules/channels/${file}`).text();
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const word of [
        /smtp/i,
        /\bopenSender\b/,
        /\bopenGraphSender\b/,
        /\bMailSender\b/,
        /\bwithSender\b/,
        /\bsendMail\b/,
        /recipient/i,
      ]) {
        expect(code, `${file}: ${word}`).not.toMatch(word);
      }
    }
  });
});

describe("the Telegram sender leaves mail rows alone and the mail sender leaves Telegram rows alone", () => {
  test("a pending Telegram row and a pending mail row: each sender takes its own", async () => {
    await withRollback(db, async (trx) => {
      const b = await box(trx);
      const mail = await mailRow(trx, b);
      const telegram = await insertOutbox(trx, b.ctx, {
        userId: b.userId,
        kind: "weekly_report",
        dedupKey: `weekly_report:${randomUUID()}`,
        mailboxId: b.mailboxId,
        view: {},
        locale: "en",
        createdAt: T,
        nextAttemptAt: T,
      });
      // The mail sender takes the mail row and leaves the Telegram row pending.
      await sender(trx, b).run();
      expect(await stateOf(trx, telegram ?? "")).toMatchObject({ status: "pending", error_code: null });
      expect((await stateOf(trx, mail)).status).toBe("sent");
      // The Telegram sender takes the Telegram row only: it sends one message and never the mail row.
      const mail2 = await mailRow(trx, b);
      const channel = createFakeChannel();
      await createOutboxSender({ db: trx, channel, now: () => T }).run();
      expect(await stateOf(trx, mail2)).toMatchObject({ status: "pending", attempts: 0 });
      expect((await stateOf(trx, telegram ?? "")).status).not.toBe("pending");
    });
  });

  test("a mail row older than 24 h expires; a younger one stays pending; a Telegram row is left alone", async () => {
    await withRollback(db, async (trx) => {
      const b = await box(trx, { status: "paused" });
      const old = await mailRow(trx, b, { createdAt: new Date(T.getTime() - 25 * HOUR_MS) });
      const young = await mailRow(trx, b, { createdAt: new Date(T.getTime() - 23 * HOUR_MS) });
      const telegram = await insertOutbox(trx, b.ctx, {
        userId: b.userId,
        kind: "weekly_report",
        dedupKey: `weekly_report:${randomUUID()}`,
        mailboxId: b.mailboxId,
        view: {},
        locale: "en",
        createdAt: new Date(T.getTime() - 25 * HOUR_MS),
        nextAttemptAt: T,
      });
      await sender(trx, b).run();
      expect(await stateOf(trx, old)).toMatchObject({ status: "failed", error_code: "expired", locked_at: null });
      expect(await stateOf(trx, young)).toMatchObject({ status: "pending", error_code: null });
      expect(await stateOf(trx, telegram ?? "")).toMatchObject({ status: "pending", error_code: null });
    });
  });
});

describe("the port", () => {
  test("a ReportMailError never carries the message of its cause", () => {
    const error = new ReportMailError("refused", "append_refused");
    expect(error.message).toBe("report mail error append_refused");
  });
});

// A review fix:
describe("one login per mailbox per run (review TG1, N2)", () => {
  async function threeRows(trx: Transaction<DB>, b: Box): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      ids.push(await mailRow(trx, b, { createdAt: new Date(T.getTime() - (3 - i) * MINUTE_MS) }));
    }
    return ids;
  }

  test("TG1: a refused login with three rows of one mailbox opens one login; the others wait with no attempt", async () => {
    await withRollback(db, async (trx) => {
      const b = await box(trx, {
        openProvider: async () => {
          throw new MailAuthError("IMAP login failed");
        },
      });
      const ids = await threeRows(trx, b);
      await sender(trx, b).run();
      expect(b.opened.count).toBe(1);
      for (const id of ids) expect(await stateOf(trx, id)).toMatchObject({ status: "pending", attempts: 0 });
    });
  });

  test("N2: a revoked OAuth grant at open waits like a refused login: no attempt, one login", async () => {
    await withRollback(db, async (trx) => {
      const b = await box(trx, {
        openProvider: async () => {
          throw new OAuthGrantError("oauth_revoked", "invalid_grant", null);
        },
      });
      const ids = await threeRows(trx, b);
      await sender(trx, b).run();
      expect(b.opened.count).toBe(1);
      for (const id of ids) {
        const row = await stateOf(trx, id);
        expect(row).toMatchObject({ status: "pending", attempts: 0 });
        expect(row.next_attempt_at.toISOString()).toBe(new Date(T.getTime() + REPORT_MAIL_WAIT_MS).toISOString());
      }
    });
  });

  test("N2: another failure at open holds the mailbox: one login, one attempt for the first row, none for the others", async () => {
    await withRollback(db, async (trx) => {
      const b = await box(trx, {
        openProvider: async () => {
          throw new HardError("IMAP connect failed");
        },
      });
      const ids = await threeRows(trx, b);
      await sender(trx, b).run();
      expect(b.opened.count).toBe(1);
      expect(await stateOf(trx, ids[0] ?? "")).toMatchObject({ status: "pending", attempts: 1 });
      expect(await stateOf(trx, ids[1] ?? "")).toMatchObject({ status: "pending", attempts: 0 });
      expect(await stateOf(trx, ids[2] ?? "")).toMatchObject({ status: "pending", attempts: 0 });
    });
  });

  test("N2: a refused APPEND (a full mailbox) fails the first row and holds the mailbox: one login", async () => {
    await withRollback(db, async (trx) => {
      const fake = createFakeMailProvider();
      const b = await box(trx, {
        openProvider: async () => ({
          ...fake,
          appendMessage: async () => {
            throw new HardError("NO [OVERQUOTA]");
          },
        }),
      });
      const ids = await threeRows(trx, b);
      await sender(trx, b).run();
      expect(b.opened.count).toBe(1);
      expect(await stateOf(trx, ids[0] ?? "")).toMatchObject({ status: "failed", error_code: "append_refused" });
      for (const id of ids.slice(1)) {
        const row = await stateOf(trx, id);
        expect(row).toMatchObject({ status: "pending", attempts: 0 });
        expect(row.next_attempt_at.toISOString()).toBe(new Date(T.getTime() + REPORT_MAIL_WAIT_MS).toISOString());
      }
    });
  });
});

describe("a retry looks for the message first (review N1)", () => {
  const messageIdOf = (id: string, b: Box) => `<ea-report-${id}@${b.address.split("@")[1]}>`;

  test("a stale reclaim after an APPEND that landed finds the message and appends nothing; the row ends sent", async () => {
    await withRollback(db, async (trx) => {
      const b = await box(trx);
      const id = await mailRow(trx, b);
      await sender(trx, b).run();
      expect(b.appended).toHaveLength(1);
      // The mark never landed: the row is `sending` with an old lock, as a crash leaves it.
      await trx
        .updateTable("outbox")
        .set({ status: "sending", sent_at: null, locked_at: new Date(T.getTime() - 10 * MINUTE_MS) })
        .where("id", "=", id)
        .execute();
      await sender(trx, b, new Date(T.getTime() + MINUTE_MS)).run();
      expect(b.appended).toHaveLength(1);
      expect((await b.fake.fetchAbove("INBOX", 0)).map((meta) => meta.messageId)).toEqual([messageIdOf(id, b)]);
      expect(await stateOf(trx, id)).toMatchObject({ status: "sent", attempts: 1 });
      expect(errorLines.some((line) => line.includes("outbox_mail_resent_after_stale"))).toBe(true);
    });
  });

  test("a network timeout after the server stored the mail: the next try finds it and appends nothing", async () => {
    await withRollback(db, async (trx) => {
      const fake = createFakeMailProvider();
      const stored: Buffer[] = [];
      const b = await box(trx, {
        openProvider: async () => ({
          ...fake,
          appendMessage: async (folder, raw, flags, date) => {
            const result = await fake.appendMessage(folder, raw, flags, date);
            stored.push(Buffer.from(raw));
            if (stored.length === 1) throw new SoftError("timeout after the server stored the mail");
            return result;
          },
        }),
      });
      const id = await mailRow(trx, b);
      await sender(trx, b).run();
      expect(await stateOf(trx, id)).toMatchObject({ status: "pending", attempts: 1 });
      await sender(trx, b, new Date(T.getTime() + 31_000)).run();
      expect(await stateOf(trx, id)).toMatchObject({ status: "sent", attempts: 1 });
      expect(stored).toHaveLength(1);
      expect(await fake.fetchAbove("INBOX", 0)).toHaveLength(1);
    });
  });

  test("a retry whose message is not there appends it; a first try never searches", async () => {
    await withRollback(db, async (trx) => {
      const b = await box(trx);
      const first = await mailRow(trx, b);
      await sender(trx, b).run();
      expect(b.fake.calls).not.toContain("searchSinceIn");
      expect(await stateOf(trx, first)).toMatchObject({ status: "sent", attempts: 0 });
      const retried = await mailRow(trx, b);
      await trx.updateTable("outbox").set({ attempts: 1 }).where("id", "=", retried).execute();
      await sender(trx, b, new Date(T.getTime() + MINUTE_MS)).run();
      expect(b.fake.calls).toContain("searchSinceIn");
      expect(b.appended).toHaveLength(2);
      expect(await stateOf(trx, retried)).toMatchObject({ status: "sent" });
    });
  });

  test("a search that fails never leads to a blind APPEND: the row backs off", async () => {
    await withRollback(db, async (trx) => {
      const b = await box(trx);
      const id = await mailRow(trx, b);
      await trx.updateTable("outbox").set({ attempts: 1 }).where("id", "=", id).execute();
      b.fake.failOn("searchSinceIn", new SoftError("lost connection"));
      await sender(trx, b).run();
      expect(b.appended).toHaveLength(0);
      expect(await stateOf(trx, id)).toMatchObject({ status: "pending", attempts: 2 });
    });
  });

  test("a stale reclaim counts an attempt; a row that keeps crashing its sender ends as too_many_errors with no APPEND", async () => {
    await withRollback(db, async (trx) => {
      const b = await box(trx);
      const id = await mailRow(trx, b);
      await trx
        .updateTable("outbox")
        .set({ status: "sending", attempts: 4, locked_at: new Date(T.getTime() - 10 * MINUTE_MS) })
        .where("id", "=", id)
        .execute();
      await sender(trx, b).run();
      expect(await stateOf(trx, id)).toMatchObject({ status: "failed", error_code: "too_many_errors" });
      expect(b.opened.count).toBe(0);

      const other = await mailRow(trx, b);
      await trx
        .updateTable("outbox")
        .set({ status: "sending", attempts: 0, locked_at: new Date(T.getTime() - 10 * MINUTE_MS) })
        .where("id", "=", other)
        .execute();
      await sender(trx, b, new Date(T.getTime() + MINUTE_MS)).run();
      expect(await stateOf(trx, other)).toMatchObject({ status: "sent", attempts: 1 });
    });
  });

  test("the adapter only reads and appends: a Proxy provider that throws on any other method sees search, fetch, append and close", async () => {
    await withRollback(db, async (trx) => {
      const fake = createFakeMailProvider();
      const seen: string[] = [];
      const allowed = new Set(["searchSinceIn", "fetchByUidsIn", "appendMessage", "close"]);
      const guarded = new Proxy(fake, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver) as unknown;
          if (typeof prop !== "string" || typeof value !== "function") return value;
          return (...args: unknown[]) => {
            if (!allowed.has(prop)) throw new Error(`the report mail adapter called ${prop}`);
            seen.push(prop);
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        },
      });
      const b = await box(trx, { openProvider: async () => guarded as unknown as MailProvider });
      const id = await mailRow(trx, b);
      await sender(trx, b).run();
      await trx
        .updateTable("outbox")
        .set({ status: "sending", sent_at: null, locked_at: new Date(T.getTime() - HOUR_MS) })
        .where("id", "=", id)
        .execute();
      await sender(trx, b, new Date(T.getTime() + MINUTE_MS)).run();
      expect(await stateOf(trx, id)).toMatchObject({ status: "sent" });
      expect(seen).toEqual(["appendMessage", "close", "searchSinceIn", "fetchByUidsIn", "close"]);
    });
  });
});
