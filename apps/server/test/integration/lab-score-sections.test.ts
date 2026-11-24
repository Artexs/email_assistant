import { resolve } from "node:path";

import { localToInstant, unitCost, type LiveRunPlan, type LlmCallRow, type Slot, MINUTE_MS } from "@ea/core";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { auditEvents, recordAudit, recordLlmCall } from "../../src/modules/audit";
import { listDelegationOutcomes } from "../../src/modules/delegation";
import { joinRun, loadLabCorpus, type LabCorpus, type LabEvent, type LabRun } from "../../src/modules/lab";
import { scoreDelegatesSection } from "../../src/modules/lab/score/delegates";
import { scoreExecutiveSection } from "../../src/modules/lab/score/executive";
import { scoreLimitsSection } from "../../src/modules/lab/score/limits";
import { scoreMetricsSection } from "../../src/modules/lab/score/metrics";
import { scorePhishingSection } from "../../src/modules/lab/score/phishing";
import type { SectionScope } from "../../src/modules/lab/score/section";
import { setOrgFeature } from "../../src/modules/tenancy";
import type { DB } from "../../src/platform/db";

import {
  createOrgWithMailbox,
  insertAction,
  insertDelegate,
  insertDelegation,
  insertDraftAndSend,
  insertTestEmail,
  insertTriaged,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();
afterAll(async () => {
  await db.destroy();
});

const ROOT = resolve(import.meta.dir, "../../../../evals/sim");
const NOW = new Date("2026-12-10T10:00:00.000Z");

let corpus: LabCorpus;
beforeAll(async () => {
  corpus = await loadLabCorpus(ROOT, "lab-01");
});

const slotsWith = (pick: (slot: Slot) => boolean, count: number): Slot[] =>
  [...corpus.slots.values()].filter((slot) => slot.direction === "in" && pick(slot)).slice(0, count);
const byBehaviour = (behaviour: string, count = 1): Slot[] =>
  slotsWith((slot) => slot.delegateBehaviour === behaviour, count);

interface Org {
  orgId: string;
  userId: string;
  mailboxId: string;
}

// A week run from Monday 2026-11-23: the 7 run days end Mon 2026-11-30 00:00 Warsaw, the tail Fri 2026-12-04 00:00 Warsaw.
const WEEK = {
  id: "week-20261123-0a1b",
  start: "2026-11-23",
  endsAt: "2026-11-29T23:00:00.000Z",
  tail: "2026-12-03T23:00:00.000Z",
};
// A day run on Friday 2026-11-27: the tail ends Sat 2026-11-28 00:00 Warsaw.
const DAY_RUN = {
  id: "day-20261127-0a1b",
  start: "2026-11-27",
  endsAt: "2026-11-27T23:00:00.000Z",
  tail: "2026-11-28T23:00:00.000Z",
};

function runOf(kind: typeof WEEK, mode: "day" | "week", slotIds: string[]): LabRun {
  const plan: LiveRunPlan = {
    runId: kind.id,
    mode,
    startDate: kind.start,
    offsetDays: 0,
    scenarioDays: [1],
    items: slotIds.map((slotId) => ({ slotId, at: "2026-11-23T08:00:00.000Z" })),
    endsAt: kind.endsAt,
    tailEndsAt: kind.tail,
    deadlines: [],
  };
  return { plan, org: "lab", capUsd: 5 };
}

const idOf = (runId: string, slotId: string): string => `<${slotId}.${runId}@partner.test>`;
const injected = (run: LabRun, slotIds: string[]): LabEvent[] =>
  slotIds.map((slotId) => ({ t: "inject_done", slotId, messageId: idOf(run.plan.runId, slotId) }));

function scopeOf(run: LabRun, events: LabEvent[], org: Org, now = NOW): SectionScope {
  return {
    run,
    events,
    corpus,
    mailboxId: org.mailboxId,
    now,
    window: { start: localToInstant(run.plan.startDate, "00:00", "Europe/Warsaw"), end: new Date(run.plan.tailEndsAt) },
  };
}

interface DelegationFixture {
  slot: Slot;
  sentAt?: Date;
  // The row order of a mail with more than one delegation; without it the database clock sets it.
  createdAt?: Date;
  dueAt?: Date | null;
  status?: string;
  remindersSent?: number;
  answeredAt?: Date | null;
  // The answering mail carries this `Auto-Submitted` token.
  autoSubmitted?: string;
  overdueAt?: Date;
}

// The mail of the slot (triaged `delegation`, lab Message-ID) with a delegation of the given outcome.
async function addDelegation(
  trx: Transaction<DB>,
  org: Org,
  runId: string,
  fixture: DelegationFixture
): Promise<string> {
  const ctx = { orgId: org.orgId };
  const delegateId = await insertDelegate(trx, ctx);
  const { emailId, draftId, sendId } = await insertDraftAndSend(trx, ctx, org.mailboxId, {
    delegateId,
    sendStatus: "applied",
    approved: { userId: org.userId, at: new Date("2026-11-23T08:30:00.000Z") },
    messageId: idOf(runId, fixture.slot.id),
  });
  const sentAt = fixture.sentAt ?? new Date("2026-11-23T09:00:00.000Z");
  const delegationId = await insertDelegation(trx, ctx, {
    mailboxId: org.mailboxId,
    emailId,
    delegateId,
    draftActionId: draftId,
    sendActionId: sendId,
    status: fixture.status ?? "sent",
    sentAt,
    createdAt: fixture.createdAt,
    dueAt: fixture.dueAt ?? null,
    remindersSent: fixture.remindersSent ?? 0,
    answeredAt: fixture.answeredAt ?? null,
  });
  if (fixture.autoSubmitted !== undefined) {
    const answerId = await insertTestEmail(trx, ctx, org.mailboxId);
    await trx
      .insertInto("email_headers")
      .values({
        email_id: answerId,
        org_id: org.orgId,
        auto_submitted: fixture.autoSubmitted,
        attachments: "[]",
        attachment_count: 0,
        parts_known: true,
        captured_at: sentAt,
      })
      .execute();
    await trx
      .updateTable("delegations")
      .set({ answered_email_id: answerId })
      .where("id", "=", delegationId)
      .where("org_id", "=", org.orgId)
      .execute();
  }
  if (fixture.overdueAt !== undefined) {
    await recordAudit(trx, ctx, {
      emailId,
      actor: "system",
      event: auditEvents.delegationOverdue,
      data: { delegation_id: delegationId },
      at: fixture.overdueAt,
    });
  }
  return emailId;
}

const llmCall = (trx: Transaction<DB>, org: Org, at: string, mailboxId = org.mailboxId) =>
  recordLlmCall(
    trx,
    { orgId: org.orgId },
    {
      mailboxId,
      role: "classifier",
      promptVersion: "test",
      model: "gpt-6-luna",
      endpoint: "standard",
      provider: "openai" as const,
      outcome: "ok",
      tokensIn: 1000,
      tokensOut: 200,
      latencyMs: 10,
      at: new Date(at),
    }
  );

describe("M2 and M7 of the run window (stage 13 tests 5, 6, 6b)", () => {
  test("5: two delegations due in the window, one answered before its due time: on time 1 of 2", async () => {
    await withRollback(db, async (trx) => {
      const org = await createOrgWithMailbox(trx);
      const [a, b] = byBehaviour("done", 2) as [Slot, Slot];
      const run = runOf(WEEK, "week", [a.id, b.id]);
      const due = new Date("2026-11-25T09:00:00.000Z");
      await addDelegation(trx, org, WEEK.id, {
        slot: a,
        dueAt: due,
        status: "answered",
        answeredAt: new Date("2026-11-24T08:00:00.000Z"),
      });
      await addDelegation(trx, org, WEEK.id, { slot: b, dueAt: due });
      const events = injected(run, [a.id, b.id]);
      const ctx = { orgId: org.orgId };
      const joined = await joinRun(trx, ctx, run, events, corpus, org.mailboxId);
      const { section } = await scoreMetricsSection(trx, ctx, scopeOf(run, events, org), joined);
      // Due Wed 10:00 Warsaw; the deadline is one working day later. A closed on 11-24; B never closed or surfaced.
      expect(section.m2).toEqual({ due: 2, closedOnTime: 1, surfacedOnTime: 1, pending: 0 });
    });
  });

  test("6: 3 llm.call rows inside the 7 run days and 1 in the tail: M7 is the cost of the 3, the tail line is the fourth", async () => {
    await withRollback(db, async (trx) => {
      const org = await createOrgWithMailbox(trx);
      const run = runOf(WEEK, "week", []);
      for (const at of [
        "2026-11-23T10:00:00Z",
        "2026-11-25T10:00:00Z",
        "2026-11-29T22:59:00Z",
        "2026-12-01T10:00:00Z",
      ]) {
        await llmCall(trx, org, at);
      }
      const { section } = await scoreMetricsSection(trx, { orgId: org.orgId }, scopeOf(run, [], org), []);
      const rows: LlmCallRow[] = [1, 2, 3].map((n) => ({
        mailboxId: org.mailboxId,
        model: "gpt-6-luna",
        endpoint: "standard",
        provider: "openai" as const,
        tokensIn: 1000,
        tokensOut: 200,
        at: new Date(`2026-11-2${n}T10:00:00Z`),
      }));
      // gpt-6-luna: 1000 in at $0.10 per M plus 200 out at $0.50 per M = $0.0002 a call.
      expect(section.m7.usd).toBeCloseTo(0.0006, 10);
      expect(section.m7.calls).toBe(3);
      expect(section.m7.usd).toBeCloseTo(unitCost(rows, { mailboxes: 1 }).llmUsdWeek, 10);
      // 0.0006 * 30 / 7 + hosting 7.1 / 20 + backup 0.05 = 0.002571 + 0.355 + 0.05.
      expect(section.m7.perMailboxMonthUsd).toBeCloseTo(0.407571, 6);
      expect(section.m7.tail?.usd).toBeCloseTo(0.0002, 10);
      expect(section.m7.tail?.calls).toBe(1);
      expect(section.m7.usdPerMail).toBeNull();
    });
  });

  test("6b: a day run from 2026-11-27 with a silent delegation sent at 10:00 (due 11-30): reminder not reachable, no mismatch", async () => {
    await withRollback(db, async (trx) => {
      const org = await createOrgWithMailbox(trx);
      const [silent] = byBehaviour("silent") as [Slot];
      const run = runOf(DAY_RUN, "day", [silent.id]);
      await addDelegation(trx, org, DAY_RUN.id, { slot: silent, sentAt: new Date("2026-11-27T09:00:00.000Z") });
      const events = injected(run, [silent.id]);
      const ctx = { orgId: org.orgId };
      const joined = await joinRun(trx, ctx, run, events, corpus, org.mailboxId);
      const delegates = await scoreDelegatesSection(trx, ctx, scopeOf(run, events, org), joined);
      expect(delegates.rows.find((row) => row.behaviour === "silent")).toMatchObject({
        planned: 1,
        sent: 1,
        reminders: 0,
        reminderNotReachable: 1,
        differ: 0,
      });
      // The day run has the total and no month figure.
      const { section } = await scoreMetricsSection(trx, ctx, scopeOf(run, events, org), joined);
      expect(section.m7.perMailboxMonthUsd).toBeNull();
      expect(section.m7.tail).toBeNull();
    });
  });
});

describe("M3 of the run window takes the truth of the slot (stage 13)", () => {
  test("an urgent slot moved out of the inbox is a hidden important mail; without the slot truth the reader finds none", async () => {
    await withRollback(db, async (trx) => {
      const org = await createOrgWithMailbox(trx);
      const ctx = { orgId: org.orgId };
      const [slot, calm] = slotsWith((candidate) => candidate.category === "urgent", 2) as [Slot, Slot];
      const run = runOf(WEEK, "week", [slot.id, calm.id]);
      const moved = async (target: Slot) => {
        const emailId = await insertTriaged(trx, ctx, org.mailboxId, {
          category: "spam",
          createdAt: new Date("2026-11-24T08:00:00Z"),
          messageId: idOf(WEEK.id, target.id),
        });
        await insertAction(trx, ctx, emailId, {
          type: "move",
          status: "applied",
          payload: { folder: "ai_spam" },
          appliedAt: new Date("2026-11-24T08:01:00Z"),
        });
      };
      await moved(slot);
      const events = injected(run, [slot.id]);
      const joined = await joinRun(trx, ctx, run, events, corpus, org.mailboxId);
      const scope = scopeOf(run, events, org);
      // The slot says urgent: the move into ai_spam hides an important mail.
      expect((await scoreMetricsSection(trx, ctx, scope, joined)).section.m3.hiddenImportant).toBe(1);
      // With no slot truth (no joined row) the feedback reader has none either, so the move counts as nothing.
      expect((await scoreMetricsSection(trx, ctx, scope, [])).section.m3.hiddenImportant).toBe(0);
    });
  });
});

describe("review fixes of stage 13", () => {
  test("TG1: delegations of org A are not read with the context of org B, even with the email id of org A", async () => {
    await withRollback(db, async (trx) => {
      const org = await createOrgWithMailbox(trx);
      const other = await createOrgWithMailbox(trx);
      const [slot] = byBehaviour("done") as [Slot];
      const emailId = await addDelegation(trx, org, WEEK.id, { slot });
      expect(await listDelegationOutcomes(trx, { orgId: org.orgId }, [emailId])).toHaveLength(1);
      expect(await listDelegationOutcomes(trx, { orgId: other.orgId }, [emailId])).toEqual([]);
    });
  });

  test("TG2: two delegations on one mail: the newest sent one is the one scored", async () => {
    await withRollback(db, async (trx) => {
      const org = await createOrgWithMailbox(trx);
      const ctx = { orgId: org.orgId };
      const [slot] = byBehaviour("done") as [Slot];
      const run = runOf(WEEK, "week", [slot.id]);
      // The older delegation was cancelled after a send with no answer; the newer one was answered.
      const emailId = await addDelegation(trx, org, WEEK.id, {
        slot,
        status: "cancelled",
        sentAt: new Date("2026-11-23T09:00:00.000Z"),
        createdAt: new Date("2026-11-23T08:30:00.000Z"),
      });
      const delegateId = await insertDelegate(trx, ctx);
      const approved = {
        approvedAt: new Date("2026-11-24T08:00:00Z"),
        approvedBy: org.userId,
        approvedVia: "telegram",
      };
      const draftId = await insertAction(trx, ctx, emailId, { type: "create_draft", status: "applied" });
      const sendId = await insertAction(trx, ctx, emailId, { type: "send", status: "applied", ...approved });
      await insertDelegation(trx, ctx, {
        mailboxId: org.mailboxId,
        emailId,
        delegateId,
        draftActionId: draftId,
        sendActionId: sendId,
        status: "answered",
        sentAt: new Date("2026-11-24T09:00:00.000Z"),
        answeredAt: new Date("2026-11-24T10:00:00.000Z"),
        createdAt: new Date("2026-11-24T08:30:00.000Z"),
      });
      const events = injected(run, [slot.id]);
      const joined = await joinRun(trx, ctx, run, events, corpus, org.mailboxId);
      const delegates = await scoreDelegatesSection(trx, ctx, scopeOf(run, events, org), joined);
      expect(delegates.rows.find((row) => row.behaviour === "done")).toMatchObject({ sent: 1, answered: 1, differ: 0 });
    });
  });
});

// One organization with a little of everything the five sections read. The numbers are counted by hand in the tests.
async function fillWorld(trx: Transaction<DB>, org: Org) {
  const ctx = { orgId: org.orgId };
  const [done] = byBehaviour("done") as [Slot];
  const [silent] = byBehaviour("silent") as [Slot];
  const [ooo] = byBehaviour("out_of_office") as [Slot];
  const phishing = slotsWith((slot) => slot.hardCases.includes("phishing_urgent_push"), 4);
  const [lateUrgent] = slotsWith(
    (slot) => slot.category === "urgent" && !slot.hardCases.some((tag) => tag.startsWith("phishing_")),
    1
  ) as [Slot];
  const notInjected = phishing[3] as Slot;
  const slotIds = [done, silent, ooo, ...phishing, lateUrgent].map((slot) => slot.id);
  const run = runOf(WEEK, "week", slotIds);

  // done: answered. silent: sent Mon 11-23 10:00 Warsaw, due Thu 11-26; overdue, 1 reminder. out_of_office: answered by an auto-reply.
  await addDelegation(trx, org, WEEK.id, {
    slot: done,
    status: "answered",
    answeredAt: new Date("2026-11-23T11:00:00Z"),
  });
  await addDelegation(trx, org, WEEK.id, {
    slot: silent,
    status: "overdue",
    remindersSent: 1,
    overdueAt: new Date("2026-11-27T06:30:00Z"),
  });
  await addDelegation(trx, org, WEEK.id, {
    slot: ooo,
    status: "answered",
    answeredAt: new Date("2026-11-23T09:05:00Z"),
    autoSubmitted: "auto-replied",
  });

  // Three phishing mails triaged urgent: two get an urgent notice (the first has a suspicious reason), the third gets none.
  // The fourth phishing slot is in the plan and was not injected.
  await setOrgFeature(trx, ctx, { flag: "suspicious_mail", enabled: true, actor: "cli", now: NOW });
  const [warned, unwarned, unnoticed] = phishing as [Slot, Slot, Slot];
  for (const [slot, reasons, minute, notice] of [
    [warned, ["lookalike_domain"], 10, true],
    [unwarned, [], 20, true],
    [unnoticed, [], 30, false],
  ] as const) {
    const receivedAt = new Date(`2026-11-24T10:${minute}:00Z`);
    const emailId = await insertTriaged(trx, ctx, org.mailboxId, {
      category: "urgent",
      createdAt: receivedAt,
      messageId: idOf(WEEK.id, slot.id),
      suspiciousReasons: reasons,
    });
    if (!notice) continue;
    await trx
      .insertInto("outbox")
      .values({
        org_id: org.orgId,
        user_id: org.userId,
        kind: "urgent",
        dedup_key: `urgent:${emailId}`,
        email_id: emailId,
        text: "Urgent",
        buttons: "[]",
        status: "sent",
        created_at: receivedAt,
        next_attempt_at: receivedAt,
        sent_at: new Date(receivedAt.getTime() + 5 * MINUTE_MS),
      })
      .execute();
  }

  // Limits: 2 recipient_day and 1 mailbox_hour hit; one send waits on a limit now.
  for (const limit of ["recipient_day", "recipient_day", "mailbox_hour"]) {
    await recordAudit(trx, ctx, {
      actor: "system",
      event: auditEvents.actionSendLimited,
      reasonCode: "send_limit",
      data: { limit, until: "2026-11-25T00:00:00Z", mailbox_id: org.mailboxId },
      at: new Date("2026-11-24T12:00:00Z"),
    });
  }
  const held = await insertTestEmail(trx, ctx, org.mailboxId);
  await insertAction(trx, ctx, held, {
    type: "send",
    status: "approved",
    approvedAt: new Date("2026-12-09T10:00:00Z"),
    lastError: "send_limit:recipient_day",
    nextAttemptAt: new Date("2026-12-11T00:00:00Z"),
  });

  // Expired approvals: 2 timeouts with no tap count; one closed by its delegation and one that had a tap do not.
  const expired = (reason: string, approved: boolean) =>
    insertDraftAndSend(trx, ctx, org.mailboxId, {
      sendStatus: "expired",
      createdAt: new Date("2026-11-24T09:00:00Z"),
      ...(approved ? { approved: { userId: org.userId, at: new Date("2026-11-24T10:00:00Z") } } : {}),
    }).then(async ({ sendId }) => {
      await trx.updateTable("actions").set({ status_reason: reason }).where("id", "=", sendId).execute();
    });
  await expired("timeout", false);
  await expired("timeout", false);
  await expired("delegation_closed", false);
  await expired("timeout", true);

  await llmCall(trx, org, "2026-11-24T10:00:00Z");
  const events: LabEvent[] = [
    // The fourth phishing slot is planned and not injected; an urgent slot went out 400 s late.
    ...injected(
      run,
      slotIds.filter((id) => id !== notInjected.id)
    ).map((event) =>
      event.t === "inject_done" && event.slotId === lateUrgent.id ? { ...event, lateBySec: 400 } : event
    ),
    { t: "tap_planned", key: "1:ap:a", at: "2026-11-24T09:00:00Z", data: "ap:a", messageId: 1 },
    { t: "tap_done", key: "1:ap:a", data: "ap:a" },
    { t: "skip", code: "unmapped", ref: "2:b" },
    { t: "skip", code: "auto_submitted", ref: "ksiegowa:3" },
  ];
  return { run, events, slotIds };
}

async function sectionsOf(trx: Transaction<DB>, ctx: { orgId: string }, scope: SectionScope) {
  const joined = await joinRun(trx, ctx, scope.run, scope.events, corpus, scope.mailboxId);
  const metrics = await scoreMetricsSection(trx, ctx, scope, joined);
  return {
    metrics: metrics.section,
    delegates: await scoreDelegatesSection(trx, ctx, scope, joined),
    executive: await scoreExecutiveSection(trx, ctx, scope),
    limits: await scoreLimitsSection(trx, ctx, scope),
    phishing: await scorePhishingSection(trx, ctx, scope, joined, metrics.urgent),
  };
}

describe("the five sections read the run window of one organization (stage 13 test 7, tenant)", () => {
  test("7: the numbers of the world are counted by hand; rows of a second org change none; its context shows none of them", async () => {
    await withRollback(db, async (trx) => {
      const org = await createOrgWithMailbox(trx);
      const other = await createOrgWithMailbox(trx);
      const world = await fillWorld(trx, org);
      const scope = scopeOf(world.run, world.events, org);
      const ctx = { orgId: org.orgId };
      const before = await sectionsOf(trx, ctx, scope);

      // The same kinds of rows in another org, some of them naming the mailbox of the first org in their JSON.
      const rival = await fillWorld(trx, other);
      void rival;
      for (const limit of ["mailbox_day", "mailbox_day", "mailbox_day"]) {
        await recordAudit(
          trx,
          { orgId: other.orgId },
          {
            actor: "system",
            event: auditEvents.actionSendLimited,
            reasonCode: "send_limit",
            data: { limit, until: "2026-11-25T00:00:00Z", mailbox_id: org.mailboxId },
            at: new Date("2026-11-24T12:00:00Z"),
          }
        );
      }
      await llmCall(trx, other, "2026-11-24T11:00:00Z", org.mailboxId);
      const after = await sectionsOf(trx, ctx, scope);
      expect(after).toEqual(before);

      // Counted by hand.
      expect(after.limits).toEqual({
        hits: { mailbox_hour: 1, mailbox_day: 0, recipient_day: 2 },
        total: 3,
        heldAtEnd: 1,
      });
      expect(after.executive.approvalsExpired).toEqual({ total: 2, byReason: { timeout: 2 } });
      expect(after.executive).toMatchObject({ pressed: 1, planned: 1, unmapped: 1 });
      expect(after.executive.presses.approve).toBe(1);
      const row = (behaviour: string) => after.delegates.rows.find((candidate) => candidate.behaviour === behaviour);
      expect(row("done")).toMatchObject({ planned: 1, sent: 1, answered: 1, differ: 0 });
      // silent: due Thu 11-26 10:00 Warsaw, the first chaser run Fri 07:30: reachable in the week run; 1 reminder, not answered.
      expect(row("silent")).toMatchObject({
        sent: 1,
        answered: 0,
        reminders: 1,
        overdue: 1,
        reminderNotReachable: 0,
        differ: 0,
      });
      // out_of_office: answered by an auto-reply, so the server closed it: it differs from the expected outcome.
      expect(row("out_of_office")).toMatchObject({ sent: 1, answered: 1, answeredByAuto: 1, differ: 1 });
      expect(after.delegates.bots.skips).toEqual({ auto_submitted: 1 });
      // The one llm call of the org inside the run days.
      expect(after.metrics.m7).toMatchObject({ calls: 1, tail: { calls: 0 } });
      expect(after.metrics.m7.usd).toBeCloseTo(0.0002, 10);
      // Phishing: 4 planned, 3 injected, 3 triaged urgent, 2 notices, the warning on 1 of them (the flag is on in the org).
      expect(after.phishing).toMatchObject({
        injected: 3,
        triagedUrgent: 3,
        noticed: 2,
        warned: 1,
        warningField: true,
        unwarnedUrgentPush: 1,
      });
      // M5: both urgent mails arrived at 11:10 and 11:20 Warsaw and were noticed after 5 minutes.
      // The third urgent mail (11:30 Warsaw) got no notice. The first injection was late: its slot is listed.
      expect(after.metrics.m5).toMatchObject({ urgent: 3, noticed: 2, withoutNotice: 1, p90Minutes: 5 });
      expect(after.metrics.m5Late).toEqual([world.slotIds[7] as string]);

      // The other organization's own context holds its rows and none of the first org's (it has no run mail of the first).
      const otherCtx = { orgId: other.orgId };
      const rivalScope = scopeOf(world.run, world.events, other);
      const seen = await sectionsOf(trx, otherCtx, rivalScope);
      expect(seen.limits.hits).toEqual({ mailbox_hour: 1, mailbox_day: 0, recipient_day: 2 });
      expect(seen.limits.total).toBe(3);
      // A context of the other org with the first org's mailbox: the metric join refuses the mailbox, and the other
      // readers see none of the first org's rows (its own audit rows name that mailbox in their JSON, so they count).
      const crossed = scopeOf(world.run, world.events, org);
      await expect(scoreMetricsSection(trx, otherCtx, crossed, [])).rejects.toThrow("not in the run organization");
      expect(await scoreLimitsSection(trx, otherCtx, crossed)).toEqual({
        hits: { mailbox_hour: 0, mailbox_day: 3, recipient_day: 0 },
        total: 3,
        heldAtEnd: 0,
      });
      expect((await scoreExecutiveSection(trx, otherCtx, crossed)).approvalsExpired.total).toBe(0);
      const joinedCrossed = await joinRun(trx, otherCtx, world.run, world.events, corpus, org.mailboxId);
      expect(joinedCrossed.every((mail) => mail.emailId === null)).toBe(true);
      const delegatesCrossed = await scoreDelegatesSection(trx, otherCtx, crossed, joinedCrossed);
      expect(delegatesCrossed.rows.every((delegates) => delegates.sent === 0 && delegates.answered === 0)).toBe(true);
    });
  });
});
