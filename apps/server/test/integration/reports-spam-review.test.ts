import { randomUUID } from "node:crypto";

import { DAY_MS, HOUR_MS, MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { noDelegationHooks } from "../../src/modules/actions";
import { digestNowMessage, scheduleDigests, type CommandDeps, type LinkedChat } from "../../src/modules/channels";
import { insertDefaultSettings } from "../../src/modules/config";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { insertInboxFolder, insertMailbox, markSynced } from "../../src/modules/mail/repo";
import { buildDigestMessage } from "../../src/modules/reports";
import { setDigestTimes, setOrgFeature } from "../../src/modules/tenancy";
import type { DB } from "../../src/platform/db";

import {
  createOrgWithMailbox,
  insertAction,
  insertTriagedWithActions,
  isolateChannels,
  linkChat,
  randomChatId,
  testCapabilities,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

// The spam review line of the digest. T is 08:00 in Warsaw (UTC+1 in November).
const T = new Date("2026-11-06T07:00:00Z");
const MIN = MINUTE_MS;
const at = (offset: number) => new Date(T.getTime() + offset);

const request = {
  kind: "on_demand" as const,
  periodStart: at(-3 * HOUR_MS),
  periodEnd: T,
  slot: null,
  now: T,
  locale: "en" as const,
  role: "owner" as const,
  testMail: NO_TEST_SENDERS,
};
const BASE = "https://panel.test";
const URL_LINE = "review: https://panel.test/activity?category=spam";

interface Ctx {
  orgId: string;
}

async function setMode(trx: Transaction<DB>, mailboxId: string, mode: "shadow" | "assist"): Promise<void> {
  await trx.updateTable("mailbox_settings").set({ mode }).where("mailbox_id", "=", mailboxId).execute();
}

let nextUid = 1;

// A mail with one original `move` action. `applied` rows take `applied_at` = `when`; `logged` rows take `created_at` = `when`.
async function moveMail(
  trx: Transaction<DB>,
  ctx: Ctx,
  mailboxId: string,
  when: Date,
  opts: { status?: string; folder?: string; category?: "spam" | "info" } = {}
): Promise<string> {
  const { emailId } = await insertTriagedWithActions(trx, ctx, mailboxId, {
    category: opts.category ?? "spam",
    createdAt: when,
    subject: "SUBJECT-SPAM",
    uid: nextUid,
    contentHash: `h${nextUid++}`,
    actions: [{ type: "move", status: opts.status ?? "applied", payload: { folder: opts.folder ?? "ai_spam" } }],
  });
  return emailId;
}

async function orgOn(trx: Transaction<DB>, mode: "shadow" | "assist", flag = true) {
  const a = await createOrgWithMailbox(trx);
  const ctx = { orgId: a.orgId };
  await insertDefaultSettings(trx, ctx, a.mailboxId);
  await setMode(trx, a.mailboxId, mode);
  if (flag) await setOrgFeature(trx, ctx, { flag: "spam_review_line", enabled: true, actor: "cli", now: T });
  return { ...a, ctx };
}

const spamLines = (text: string): string[] => text.split("\n").filter((line) => line.startsWith("🗑"));

describe("digest spam review line (F110 stage 17)", () => {
  test("3. assist: two applied moves in the window count; a logged move and an applied one before the window do not", async () => {
    await withRollback(db, async (trx) => {
      const a = await orgOn(trx, "assist");
      await moveMail(trx, a.ctx, a.mailboxId, at(-2 * HOUR_MS));
      await moveMail(trx, a.ctx, a.mailboxId, at(-30 * MIN));
      await moveMail(trx, a.ctx, a.mailboxId, at(-90 * MIN), { status: "logged" });
      await moveMail(trx, a.ctx, a.mailboxId, at(-4 * HOUR_MS));
      const text = (await buildDigestMessage(trx, a.ctx, { ...request, panelBase: BASE })).text;
      expect(spamLines(text)).toEqual([`🗑 2 went to spam · ${URL_LINE}`]);
    });
  });

  test("4. shadow: two logged moves read 'would have gone to spam'; an applied row of a shadow mailbox is not counted", async () => {
    await withRollback(db, async (trx) => {
      const a = await orgOn(trx, "shadow");
      await moveMail(trx, a.ctx, a.mailboxId, at(-2 * HOUR_MS), { status: "logged" });
      await moveMail(trx, a.ctx, a.mailboxId, at(-1 * HOUR_MS), { status: "logged" });
      await moveMail(trx, a.ctx, a.mailboxId, at(-1 * HOUR_MS), { status: "applied" });
      const text = (await buildDigestMessage(trx, a.ctx, { ...request, panelBase: BASE })).text;
      expect(spamLines(text)).toEqual([`🗑 2 would have gone to spam · ${URL_LINE}`]);
    });
  });

  test("5. flag off: no line, whatever the counts", async () => {
    await withRollback(db, async (trx) => {
      const a = await orgOn(trx, "assist", false);
      await moveMail(trx, a.ctx, a.mailboxId, at(-2 * HOUR_MS));
      const text = (await buildDigestMessage(trx, a.ctx, { ...request, panelBase: BASE })).text;
      expect(spamLines(text)).toEqual([]);
      expect(text).not.toContain("went to spam");
    });
  });

  test("no spam move in the window: no line", async () => {
    await withRollback(db, async (trx) => {
      const a = await orgOn(trx, "assist");
      await moveMail(trx, a.ctx, a.mailboxId, at(-2 * HOUR_MS), { folder: "ai_info", category: "info" });
      expect(spamLines((await buildDigestMessage(trx, a.ctx, request)).text)).toEqual([]);
    });
  });

  test("without a base URL the line sends the reader to the panel; a trailing slash of the base does not double", async () => {
    await withRollback(db, async (trx) => {
      const a = await orgOn(trx, "assist");
      await moveMail(trx, a.ctx, a.mailboxId, at(-2 * HOUR_MS));
      expect(spamLines((await buildDigestMessage(trx, a.ctx, request)).text)).toEqual([
        "🗑 1 went to spam · check them in the panel",
      ]);
      const slash = (await buildDigestMessage(trx, a.ctx, { ...request, panelBase: `${BASE}/` })).text;
      expect(spamLines(slash)).toEqual([`🗑 1 went to spam · ${URL_LINE}`]);
    });
  });

  test("6. the Polish line", async () => {
    await withRollback(db, async (trx) => {
      const a = await orgOn(trx, "assist");
      await moveMail(trx, a.ctx, a.mailboxId, at(-2 * HOUR_MS));
      const text = (await buildDigestMessage(trx, a.ctx, { ...request, locale: "pl", panelBase: BASE })).text;
      expect(spamLines(text)).toEqual([
        "🗑 1 wiadomość trafiła do spamu · sprawdź: https://panel.test/activity?category=spam",
      ]);
    });
  });

  test("the window: after the digest start (excluded), up to its end (included), at most 24 h back", async () => {
    await withRollback(db, async (trx) => {
      const a = await orgOn(trx, "assist");
      const start = at(-3 * HOUR_MS);
      await moveMail(trx, a.ctx, a.mailboxId, start); // not after the start
      await moveMail(trx, a.ctx, a.mailboxId, new Date(start.getTime() + 1)); // counts
      await moveMail(trx, a.ctx, a.mailboxId, T); // the end counts
      await moveMail(trx, a.ctx, a.mailboxId, new Date(T.getTime() + 1)); // after the end
      const text = (await buildDigestMessage(trx, a.ctx, { ...request, panelBase: BASE })).text;
      expect(spamLines(text)).toEqual([`🗑 2 went to spam · ${URL_LINE}`]);

      // A digest that covers 3 days counts the last 24 hours only: the three rows above and the one at -23 h, not the one at -25 h.
      const wide = { ...request, periodStart: at(-3 * DAY_MS), panelBase: BASE };
      await moveMail(trx, a.ctx, a.mailboxId, at(-25 * HOUR_MS));
      await moveMail(trx, a.ctx, a.mailboxId, at(-23 * HOUR_MS));
      expect(spamLines((await buildDigestMessage(trx, a.ctx, wide)).text)).toEqual([`🗑 4 went to spam · ${URL_LINE}`]);
    });
  });

  test("the window of logged moves has the same bounds: after the start, up to the end, at most 24 h back", async () => {
    await withRollback(db, async (trx) => {
      const a = await orgOn(trx, "shadow");
      const start = at(-3 * HOUR_MS);
      const logged = { status: "logged" };
      await moveMail(trx, a.ctx, a.mailboxId, start, logged); // not after the start
      await moveMail(trx, a.ctx, a.mailboxId, new Date(start.getTime() + 1), logged);
      await moveMail(trx, a.ctx, a.mailboxId, T, logged);
      await moveMail(trx, a.ctx, a.mailboxId, new Date(T.getTime() + 1), logged); // after the end
      expect(spamLines((await buildDigestMessage(trx, a.ctx, request)).text)).toEqual([
        "🗑 2 would have gone to spam · check them in the panel",
      ]);
      const wide = { ...request, periodStart: at(-3 * DAY_MS) };
      await moveMail(trx, a.ctx, a.mailboxId, at(-25 * HOUR_MS), logged);
      expect(spamLines((await buildDigestMessage(trx, a.ctx, wide)).text)).toEqual([
        "🗑 3 would have gone to spam · check them in the panel",
      ]);
    });
  });

  test("a mailbox without settings is not a shadow mailbox: its applied move counts, a logged one does not", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId };
      await setOrgFeature(trx, ctx, { flag: "spam_review_line", enabled: true, actor: "cli", now: T });
      await moveMail(trx, ctx, a.mailboxId, at(-2 * HOUR_MS));
      await moveMail(trx, ctx, a.mailboxId, at(-1 * HOUR_MS), { status: "logged" });
      expect(spamLines((await buildDigestMessage(trx, ctx, request)).text)).toEqual([
        "🗑 1 went to spam · check them in the panel",
      ]);
    });
  });

  test("a mail counts once; an undone move, a reverse action and a move to another folder do not count", async () => {
    await withRollback(db, async (trx) => {
      const a = await orgOn(trx, "assist");
      const once = await moveMail(trx, a.ctx, a.mailboxId, at(-2 * HOUR_MS));
      await insertAction(trx, a.ctx, once, {
        type: "move",
        status: "applied",
        payload: { folder: "ai_spam" },
        createdAt: at(-1 * HOUR_MS),
      });
      await moveMail(trx, a.ctx, a.mailboxId, at(-2 * HOUR_MS), { status: "undone" });
      const reversed = await moveMail(trx, a.ctx, a.mailboxId, at(-2 * HOUR_MS));
      const [original] = await trx.selectFrom("actions").select("id").where("email_id", "=", reversed).execute();
      const noise = await moveMail(trx, a.ctx, a.mailboxId, at(-2 * HOUR_MS), { status: "failed" });
      await insertAction(trx, a.ctx, noise, {
        type: "move",
        status: "applied",
        payload: { folder: "ai_spam" },
        reversesActionId: original?.id ?? null,
        createdAt: at(-1 * HOUR_MS),
      });
      await moveMail(trx, a.ctx, a.mailboxId, at(-2 * HOUR_MS), { folder: "ai_info", category: "info" });
      const text = (await buildDigestMessage(trx, a.ctx, request)).text;
      // `once` and `reversed` count; the undone, failed and ai_info mails do not.
      expect(spamLines(text)).toEqual(["🗑 2 went to spam · check them in the panel"]);
    });
  });

  test("another organization's moves are not counted, and its flag does not leak", async () => {
    await withRollback(db, async (trx) => {
      const a = await orgOn(trx, "assist");
      const b = await orgOn(trx, "assist", false);
      await moveMail(trx, b.ctx, b.mailboxId, at(-2 * HOUR_MS));
      await moveMail(trx, b.ctx, b.mailboxId, at(-1 * HOUR_MS));
      await moveMail(trx, a.ctx, a.mailboxId, at(-2 * HOUR_MS));
      expect(spamLines((await buildDigestMessage(trx, a.ctx, request)).text)).toEqual([
        "🗑 1 went to spam · check them in the panel",
      ]);
      expect(spamLines((await buildDigestMessage(trx, b.ctx, request)).text)).toEqual([]);
    });
  });

  test("two mailboxes: applied moves of the assist one, logged moves of the shadow one, each with its own text", async () => {
    await withRollback(db, async (trx) => {
      const a = await orgOn(trx, "assist");
      const second = { id: randomUUID() };
      await insertMailbox(trx, a.ctx, {
        id: second.id,
        address: `second-${second.id}@x.test`,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: { drafts: "Drafts" },
      });
      await insertInboxFolder(trx, a.ctx, second.id);
      await insertDefaultSettings(trx, a.ctx, second.id);
      await setMode(trx, second.id, "shadow");
      await moveMail(trx, a.ctx, a.mailboxId, at(-2 * HOUR_MS));
      await moveMail(trx, a.ctx, a.mailboxId, at(-2 * HOUR_MS), { status: "logged" }); // a logged row of an assist mailbox
      await moveMail(trx, a.ctx, second.id, at(-2 * HOUR_MS), { status: "logged" });
      await moveMail(trx, a.ctx, second.id, at(-1 * HOUR_MS), { status: "logged" });
      expect(spamLines((await buildDigestMessage(trx, a.ctx, request)).text)).toEqual([
        "🗑 1 went to spam · check them in the panel",
        "🗑 2 would have gone to spam · check them in the panel",
      ]);
    });
  });
});

describe("digest spam review line: the callers pass the panel URL (F110 stage 17)", () => {
  test("the scheduled digest and /digest link to the Activity list when WEB_BASE_URL is set", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const a = await orgOn(trx, "assist");
      await markSynced(trx, a.ctx, a.mailboxId, at(-5 * MIN));
      const linkedAt = new Date("2026-11-05T20:00:00Z");
      await linkChat(trx, a.ctx, a.userId, randomChatId(), linkedAt);
      await setDigestTimes(trx, a.ctx, a.userId, ["08:00"]);
      await moveMail(trx, a.ctx, a.mailboxId, at(-2 * HOUR_MS));

      await scheduleDigests({ db: trx, now: () => T, testMail: NO_TEST_SENDERS, webBaseUrl: BASE });
      const rows = await trx
        .selectFrom("outbox")
        .select("view")
        .where("org_id", "=", a.orgId)
        .where("kind", "=", "digest")
        .execute();
      expect(rows).toHaveLength(1);
      const scheduled = (rows[0]?.view as { text: string }).text;
      expect(spamLines(scheduled)).toEqual([`🗑 1 went to spam · ${URL_LINE}`]);

      const link: LinkedChat = { orgId: a.orgId, userId: a.userId, role: "owner", chatId: 1, linkedAt, locale: "en" };
      const deps = (extra: Partial<CommandDeps>): CommandDeps => ({
        db: trx,
        now: () => T,
        llmDailyCap: 300,
        triageScope: "all",
        actionsScope: { kind: "off" },
        llm: { provider: "gemini", classifierModel: "gemini-3.5-flash-lite" },
        hooks: noDelegationHooks,
        uidplus: async () => true,
        sendScope: { kind: "off" },
        testMail: NO_TEST_SENDERS,
        operatorContact: null,
        syncEveryMin: 2,
        ...extra,
      });
      expect(spamLines((await digestNowMessage(deps({ webBaseUrl: BASE }), link)).text)).toEqual([
        `🗑 1 went to spam · ${URL_LINE}`,
      ]);
      expect(spamLines((await digestNowMessage(deps({}), link)).text)).toEqual([
        "🗑 1 went to spam · check them in the panel",
      ]);
    });
  });
});
