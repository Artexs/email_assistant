import { format } from "node:util";

import type { Category, UrgencyProfile } from "@ea/core";
import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import type { KyselyPlugin, Transaction } from "kysely";

import { getMailboxSettings, insertDefaultSettings } from "../../src/modules/config";
import { claimEmails, NO_TEST_SENDERS, type TestMailRule } from "../../src/modules/mail";
import {
  type ClassifierPromptChoice,
  createLlmPause,
  loadClassifierExtras,
  triageOne,
  type TriageMailbox,
  noGateEvidence,
} from "../../src/modules/triage";
import type { DB, TenantContext } from "../../src/platform/db";
import type { LlmClient } from "../../src/platform/llm";
import { setLogLevel } from "../../src/platform/log";

import {
  createOrgWithMailbox,
  insertAttachmentHeaders,
  insertTestEmail,
  noSuspiciousContext,
  pauseOtherMailboxes,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";

// The real-mail readers of `classifier-v3` (tests 1-7 of the stage file) and the log canary.

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

afterEach(() => setLogLevel("info"));

const DAY = 24 * 3_600_000;
const now = new Date("2026-11-15T12:00:00Z");
const V3_ALL: ClassifierPromptChoice = { version: "classifier-v3", parts: ["urgency", "history", "list"] };
const V3_PLAIN: ClassifierPromptChoice = { version: "classifier-v3", parts: [] };
const SYNTHETIC_ID = "<seed-1@ea-seed.test>";
const SENDER = "partner@shop.test";

interface Scene {
  ctx: TenantContext;
  mailboxId: string;
  settingsVersion: string;
}

async function scene(trx: Transaction<DB>): Promise<Scene> {
  const created = await createOrgWithMailbox(trx);
  const ctx: TenantContext = { orgId: created.orgId };
  await insertDefaultSettings(trx, ctx, created.mailboxId);
  const settings = await getMailboxSettings(trx, ctx, created.mailboxId);
  if (!settings) throw new Error("no settings");
  return { ctx, mailboxId: created.mailboxId, settingsVersion: settings.version };
}

// An earlier mail of the triage job: status `triaged`, so no claim picks it.
async function earlier(
  trx: Transaction<DB>,
  s: Scene,
  opts: { from?: string; ageDays?: number; messageId?: string | null; at?: Date } = {}
): Promise<string> {
  return insertTestEmail(trx, s.ctx, s.mailboxId, {
    from_address: opts.from ?? SENDER,
    status: "triaged",
    received_at: opts.at ?? new Date(now.getTime() - (opts.ageDays ?? 5) * DAY),
    ...(opts.messageId === undefined ? {} : { message_id_header: opts.messageId }),
  });
}

async function feedback(
  trx: Transaction<DB>,
  s: Scene,
  emailId: string,
  row: { verdict: "right" | "wrong"; trueCategory: Category | null; at: Date }
): Promise<void> {
  await trx
    .insertInto("triage_feedback")
    .values({
      org_id: s.ctx.orgId,
      email_id: emailId,
      verdict: row.verdict,
      true_category: row.trueCategory,
      source: "cli",
      created_at: row.at,
    })
    .execute();
}

async function claimed(trx: Transaction<DB>, s: Scene, emailId: string) {
  const mails = await claimEmails(trx, s.ctx, s.mailboxId, {
    now,
    limit: 10,
    staleBefore: new Date(now.getTime() - 5 * 60_000),
    syntheticOnly: false,
  });
  const email = mails.find((mail) => mail.id === emailId);
  if (!email) throw new Error("claim failed");
  return email;
}

// A pending mail, claimed. `receivedAt` defaults to one minute before `now`.
async function pending(
  trx: Transaction<DB>,
  s: Scene,
  opts: { from?: string; receivedAt?: Date; messageId?: string | null } = {}
) {
  const emailId = await insertTestEmail(trx, s.ctx, s.mailboxId, {
    from_address: opts.from ?? SENDER,
    received_at: opts.receivedAt ?? new Date(now.getTime() - 60_000),
    subject: "Offer",
    body_text: "Please look at the offer.",
    ...(opts.messageId === undefined ? {} : { message_id_header: opts.messageId }),
  });
  return claimed(trx, s, emailId);
}

interface CapturingLlm extends LlmClient {
  prompts: string[];
}

function capturingLlm(): CapturingLlm {
  const llm = {
    prompts: [] as string[],
    modelOf: () => "fake-model",
    endpointOf: () => "standard",
    providerOf: () => "openai",
    async generate(req) {
      llm.prompts.push(req.prompt);
      return {
        data: req.schema.parse({
          category: "info",
          confidence: 0.95,
          reason_code: "newsletter",
          reason: "test",
          summary: "short summary",
          fields: { due_date: null, language: "en", delegate_id: null, task: null, clarification: null },
        }),
        usage: {
          role: req.role,
          promptVersion: req.promptVersion,
          model: "fake-model",
          tokensIn: 100,
          tokensOut: 20,
          latencyMs: 300,
          endpoint: "standard",
          provider: "openai" as const,
        },
      };
    },
  } as CapturingLlm;
  return llm;
}

function mailboxOf(s: Scene, urgencyProfile: UrgencyProfile | null = null): TriageMailbox {
  return {
    id: s.mailboxId,
    settingsVersion: s.settingsVersion,
    mode: "shadow",
    toolSwitches: { move: false, mark_read: false, flag: false, create_draft: false, move_unsure: false },
    runningKey: noGateEvidence.runningKey,
    policy: {},
    rules: [],
    movesSupported: false,
    delegates: [],
    timezone: "Europe/Warsaw",
    junkFolder: null,
    resumedAt: null,
    suspicious: noSuspiciousContext,
    urgencyProfile,
  };
}

// One triage run of a claimed mail with the fake LLM; returns the user prompt the LLM got.
async function promptOf(
  trx: Transaction<DB>,
  s: Scene,
  email: Awaited<ReturnType<typeof claimed>>,
  opts: { prompt?: ClassifierPromptChoice; profile?: UrgencyProfile | null; testMail?: TestMailRule } = {}
): Promise<string> {
  const llm = capturingLlm();
  const outcome = await triageOne(
    {
      db: trx,
      llm,
      pause: createLlmPause(),
      testMail: opts.testMail ?? NO_TEST_SENDERS,
      dailyCap: 1000,
      junkDailyCap: 1000,
      now: () => now,
      ...(opts.prompt === undefined ? {} : { prompt: opts.prompt }),
    },
    s.ctx,
    mailboxOf(s, opts.profile ?? null),
    email
  );
  expect(outcome.kind).toBe("triaged");
  expect(llm.prompts).toHaveLength(1);
  return llm.prompts[0] as string;
}

async function history(
  trx: Transaction<DB>,
  s: Scene,
  email: Awaited<ReturnType<typeof claimed>>,
  opts: { suspicious?: string[]; testMail?: TestMailRule } = {}
) {
  const extras = await loadClassifierExtras(trx, s.ctx, {
    mailbox: { id: s.mailboxId, urgencyProfile: null },
    email,
    parts: ["history"],
    timezone: "Europe/Warsaw",
    testMail: opts.testMail ?? NO_TEST_SENDERS,
    suspicious: opts.suspicious ?? [],
  });
  return extras.senderHistory;
}

describe("loadClassifierExtras in triage", () => {
  test("1. a mail with one PDF: the v3 prompt holds the attachment name inside the nonce block; v2 does not", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const s = await scene(trx);
      const email = await pending(trx, s);
      await insertAttachmentHeaders(trx, s.ctx, email.id, [
        { name: "offer-2027.pdf", type: "application/pdf", size: 2048, inline: false },
        { name: "logo.png", type: "image/png", size: 10, inline: true },
      ]);
      const prompt = await promptOf(trx, s, email, { prompt: V3_PLAIN });
      const open = prompt.indexOf("<<<EMAIL_DATA", prompt.indexOf("The email to classify:"));
      const close = prompt.indexOf("<<<END_EMAIL_DATA", open);
      const block = prompt.slice(open, close);
      expect(block).toContain("- offer-2027.pdf | application/pdf | 2048 bytes");
      expect(prompt.indexOf("offer-2027.pdf")).toBeGreaterThan(open);
      expect(prompt.split("offer-2027.pdf")).toHaveLength(2);
      // An inline part is no attachment.
      expect(prompt).not.toContain("logo.png");
    });
  });

  test("1b. production v2 (no injection): the prompt has no attachment name", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const s = await scene(trx);
      const email = await pending(trx, s);
      await insertAttachmentHeaders(trx, s.ctx, email.id, [
        { name: "offer-2027.pdf", type: "application/pdf", size: 2048, inline: false },
      ]);
      expect(await promptOf(trx, s, email)).not.toContain("offer-2027.pdf");
    });
  });

  test("2. 4 earlier mails and one wrong feedback: received 4, corrections; a flagged mail gets null", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      const ids = [await earlier(trx, s, { ageDays: 5 }), await earlier(trx, s, { ageDays: 10 })];
      ids.push(await earlier(trx, s, { ageDays: 20 }), await earlier(trx, s, { ageDays: 80 }));
      await feedback(trx, s, ids[0] as string, { verdict: "wrong", trueCategory: "needs_reply", at: now });
      // The newest feedback row counts: an older wrong row under a newer right row does not.
      await feedback(trx, s, ids[1] as string, {
        verdict: "wrong",
        trueCategory: "urgent",
        at: new Date(now.getTime() - 2 * DAY),
      });
      await feedback(trx, s, ids[1] as string, {
        verdict: "right",
        trueCategory: null,
        at: new Date(now.getTime() - DAY),
      });
      // A "right" verdict is no correction, also when it names a category.
      await feedback(trx, s, ids[2] as string, { verdict: "right", trueCategory: "info", at: now });
      const email = await pending(trx, s);
      expect(await history(trx, s, email)).toEqual({ days: 90, received: 4, corrections: { needs_reply: 1 } });
      expect(await history(trx, s, email, { suspicious: ["lookalike_domain"] })).toBeNull();
      // The prompt carries the counts only.
      const prompt = await promptOf(trx, s, email, { prompt: V3_ALL });
      expect(prompt).toContain("mails received from this sender in the last 90 days: 4");
      expect(prompt).toContain("by the category the user wants: needs_reply 1");
    });
  });

  test("3. mail 100 days old and the mail itself are not counted; no earlier mail gives null", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await earlier(trx, s, { ageDays: 100 });
      const email = await pending(trx, s);
      expect(await history(trx, s, email)).toBeNull();
      await earlier(trx, s, { ageDays: 89 });
      expect(await history(trx, s, email)).toEqual({ days: 90, received: 1, corrections: {} });
      // A mail that arrived after this one is not earlier mail.
      await earlier(trx, s, { at: new Date(now.getTime() + DAY) });
      expect(await history(trx, s, email)).toEqual({ days: 90, received: 1, corrections: {} });
    });
  });

  test("3b. the sender match is case-insensitive and exact", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await earlier(trx, s, { from: "Partner@Shop.test" });
      await earlier(trx, s, { from: "other@shop.test" });
      const email = await pending(trx, s);
      expect(await history(trx, s, email)).toEqual({ days: 90, received: 1, corrections: {} });
    });
  });

  test("4. a test mail counts test mail only, a real mail real mail only", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      const rule: TestMailRule = { senders: ["tester@lab.test"] };
      // Same address, one test and one real mail; plus a test mail by the sender rule.
      await earlier(trx, s, { messageId: SYNTHETIC_ID });
      await earlier(trx, s, { messageId: "<real-1@shop.test>" });
      await earlier(trx, s, { messageId: "<real-2@shop.test>" });
      await earlier(trx, s, { from: "tester@lab.test", messageId: "<real-3@lab.test>" });
      const testMail = await pending(trx, s, { messageId: "<seed-2@ea-seed.test>" });
      expect(await history(trx, s, testMail, { testMail: rule })).toEqual({ days: 90, received: 1, corrections: {} });
      const realMail = await pending(trx, s, { messageId: "<real-4@shop.test>" });
      expect(await history(trx, s, realMail, { testMail: rule })).toEqual({ days: 90, received: 2, corrections: {} });
      // A sender in the rule is test mail: its history counts the test mail of that address only.
      const ruleMail = await pending(trx, s, { from: "tester@lab.test", messageId: "<real-5@lab.test>" });
      expect(await history(trx, s, ruleMail, { testMail: rule })).toEqual({ days: 90, received: 1, corrections: {} });
    });
  });

  test("5. mail of the same address in another organization is not counted", async () => {
    await withRollback(db, async (trx) => {
      const a = await scene(trx);
      const b = await scene(trx);
      const otherId = await earlier(trx, b);
      await feedback(trx, b, otherId, { verdict: "wrong", trueCategory: "urgent", at: now });
      await earlier(trx, a, { ageDays: 3 });
      const email = await pending(trx, a);
      expect(await history(trx, a, email)).toEqual({ days: 90, received: 1, corrections: {} });
    });
  });

  test("6. profile deadline 2027-01-20, mail at 00:30 Warsaw time: today is 2027-01-15, the deadline is in", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      const email = await pending(trx, s, { receivedAt: new Date("2027-01-14T23:30:00Z") });
      const profile: UrgencyProfile = {
        topics: [{ label: "Fusion", keywords: ["beta"] }],
        deadlines: [
          { label: "Tax return", due: "2027-01-20" },
          { label: "Old", due: "2026-12-01" },
        ],
      };
      const extras = await loadClassifierExtras(trx, s.ctx, {
        mailbox: { id: s.mailboxId, urgencyProfile: profile },
        email,
        parts: ["urgency"],
        timezone: "Europe/Warsaw",
        testMail: NO_TEST_SENDERS,
        suspicious: [],
      });
      expect(extras.urgency).toEqual({
        today: "2027-01-15",
        topics: [{ label: "Fusion", keywords: ["beta"] }],
        deadlines: [{ label: "Tax return", due: "2027-01-20" }],
      });
      // No profile: null. No urgency part: null.
      const none = await loadClassifierExtras(trx, s.ctx, {
        mailbox: { id: s.mailboxId, urgencyProfile: null },
        email,
        parts: ["urgency"],
        timezone: "Europe/Warsaw",
        testMail: NO_TEST_SENDERS,
        suspicious: [],
      });
      expect(none.urgency).toBeNull();
      const noPart = await loadClassifierExtras(trx, s.ctx, {
        mailbox: { id: s.mailboxId, urgencyProfile: profile },
        email,
        parts: [],
        timezone: "Europe/Warsaw",
        testMail: NO_TEST_SENDERS,
        suspicious: [],
      });
      expect(noPart.urgency).toBeNull();
    });
  });

  test("6b. the prompt of a triage run holds the urgency context of the batch profile", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const s = await scene(trx);
      const email = await pending(trx, s, { receivedAt: new Date("2027-01-14T23:30:00Z") });
      const prompt = await promptOf(trx, s, email, {
        prompt: V3_ALL,
        profile: { topics: [], deadlines: [{ label: "Tax return", due: "2027-01-20" }] },
      });
      expect(prompt).toContain("- today: 2027-01-15");
      expect(prompt).toContain("- deadline: Tax return, due 2027-01-20");
    });
  });

  test("7. production v2: a triage run reads no sender history and no headers for the prompt", async () => {
    const queries: string[] = [];
    const plugin: KyselyPlugin = {
      transformQuery: ({ node }) => {
        queries.push(JSON.stringify(node, (_key, value) => (typeof value === "bigint" ? String(value) : value)));
        return node;
      },
      transformResult: async ({ result }) => result,
    };
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const s = await scene(trx);
      await earlier(trx, s);
      const v2 = await pending(trx, s);
      const watched = trx.withPlugin(plugin);
      const llm = capturingLlm();
      const deps = (database: typeof watched) => ({
        db: database,
        llm,
        pause: createLlmPause(),
        testMail: NO_TEST_SENDERS,
        dailyCap: 1000,
        junkDailyCap: 1000,
        now: () => now,
      });
      expect((await triageOne(deps(watched), s.ctx, mailboxOf(s), v2)).kind).toBe("triaged");
      const sawHistory = (list: string[]) => list.filter((q) => q.includes("triage_feedback"));
      const headerReads = (list: string[]) => list.filter((q) => q.includes("email_headers"));
      expect(sawHistory(queries)).toHaveLength(0);
      // `assessEmail` reads the header row once; the v2 prompt needs nothing more.
      expect(headerReads(queries)).toHaveLength(1);

      // The same mail on a v3 prompt with `history` adds the history query and one more header read.
      queries.length = 0;
      const v3 = await pending(trx, s, { receivedAt: new Date(now.getTime() - 30_000) });
      expect((await triageOne({ ...deps(watched), prompt: V3_ALL }, s.ctx, mailboxOf(s), v3)).kind).toBe("triaged");
      expect(sawHistory(queries)).toHaveLength(1);
      expect(headerReads(queries)).toHaveLength(2);
    });
  });

  test("7b. a part list without `history` or `urgency` reads neither, also when the data exists", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await earlier(trx, s);
      const email = await pending(trx, s);
      const extras = await loadClassifierExtras(trx, s.ctx, {
        mailbox: { id: s.mailboxId, urgencyProfile: { topics: [], deadlines: [{ label: "x", due: "2026-11-16" }] } },
        email,
        parts: ["list"],
        timezone: "Europe/Warsaw",
        testMail: NO_TEST_SENDERS,
        suspicious: [],
      });
      expect(extras.senderHistory).toBeNull();
      expect(extras.urgency).toBeNull();
    });
  });

  test("8. canary: a triage run of v3 logs no sender, subject, attachment name or text", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = spyOn(console, "warn").mockImplementation(() => undefined);
    setLogLevel("debug");
    try {
      await withRollback(db, async (trx) => {
        await pauseOtherMailboxes(trx);
        const s = await scene(trx);
        const sender = "canary-sender-0001@canary.test";
        await earlier(trx, s, { from: sender });
        const email = await pending(trx, s, { from: sender });
        await insertAttachmentHeaders(trx, s.ctx, email.id, [
          { name: "CANARY-ATTACHMENT-0002.pdf", type: "application/pdf", size: 1, inline: false },
        ]);
        await promptOf(trx, s, email, {
          prompt: V3_ALL,
          profile: { topics: [{ label: "CANARY-TOPIC-0003", keywords: [] }], deadlines: [] },
        });
      });
      const lines = [...logSpy.mock.calls, ...errorSpy.mock.calls, ...warnSpy.mock.calls].map((call: unknown[]) =>
        format(...call)
      );
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).not.toMatch(/canary-sender|CANARY-|canary\.test|Offer|offer/);
      }
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
