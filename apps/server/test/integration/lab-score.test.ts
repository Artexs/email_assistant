import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { LiveRunPlan, Slot } from "@ea/core";
import { MINUTE_MS } from "@ea/core";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { recordLlmCall } from "../../src/modules/audit";
import {
  coverageOf,
  createLabState,
  joinRun,
  joinSentCopies,
  loadLabCorpus,
  scoreLabRun,
  SECTION_RENDERERS,
  writeLabReport,
  type LabCorpus,
  type LabEvent,
  type LabRun,
  type LabScore,
} from "../../src/modules/lab";
import { insertSentEmails } from "../../src/modules/mail";
import { listLatestTriageByEmailIds } from "../../src/modules/triage";
import type { DB } from "../../src/platform/db";

import { createOrgWithMailbox, insertTestEmail, insertTriaged } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();
afterAll(async () => {
  await db.destroy();
});

const ROOT = resolve(import.meta.dir, "../../../../evals/sim");
const RUN = "day-20261123-0a1b";
const T0 = new Date("2026-11-23T08:00:00.000Z");

let corpus: LabCorpus;
let inbound: Slot[];
let sentSlot: Slot;
beforeAll(async () => {
  corpus = await loadLabCorpus(ROOT, "lab-01");
  inbound = [...corpus.slots.values()].filter((slot) => slot.direction === "in").slice(0, 4);
  sentSlot = [...corpus.slots.values()].find((slot) => slot.direction === "sent") as Slot;
});

const idOf = (slotId: string): string => `<${slotId}.${RUN}@partner.test>`;

function runOf(slotIds: string[]): LabRun {
  const plan: LiveRunPlan = {
    runId: RUN,
    mode: "day",
    startDate: "2026-11-23",
    offsetDays: 0,
    scenarioDays: [1],
    items: slotIds.map((slotId) => ({ slotId, at: T0.toISOString() })),
    endsAt: "2026-11-23T23:00:00.000Z",
    tailEndsAt: "2026-11-24T23:00:00.000Z",
    deadlines: [],
  };
  return { plan, org: "lab", capUsd: 1 };
}

const done = (slotId: string, lateBySec?: number): LabEvent => ({
  t: "inject_done",
  slotId,
  messageId: idOf(slotId),
  ...(lateBySec === undefined ? {} : { lateBySec }),
});

// A mail row of a slot in a mailbox, with a triage result of `category` (created at `at`).
const mailOf = (
  trx: Transaction<DB>,
  org: { orgId: string; mailboxId: string },
  slotId: string,
  category: string,
  at: Date
) =>
  insertTriaged(trx, { orgId: org.orgId }, org.mailboxId, {
    category: category as never,
    createdAt: at,
    messageId: idOf(slotId),
  });

describe("joinRun (stage 12 tests 6 to 8)", () => {
  test("6: 3 injected slots with mail and a result are joined; one with no mail is not_synced", async () => {
    await withRollback(db, async (trx) => {
      const org = await createOrgWithMailbox(trx);
      const [a, b, c, d] = inbound as [Slot, Slot, Slot, Slot];
      const ids = await Promise.all(
        [a, b, c].map((slot, index) => mailOf(trx, org, slot.id, ["info", "spam", "urgent"][index] as string, T0))
      );
      const rows = await joinRun(
        trx,
        { orgId: org.orgId },
        runOf(inbound.map((slot) => slot.id)),
        [a, b, c, d].map((slot) => done(slot.id, slot === b ? 400 : undefined)),
        corpus,
        org.mailboxId
      );
      expect(rows.map((row) => row.slotId)).toEqual(inbound.map((slot) => slot.id));
      expect(rows.filter((row) => row.predicted !== null)).toHaveLength(3);
      expect(rows.map((row) => row.emailId)).toEqual([...ids, null]);
      expect(rows.map((row) => row.predicted)).toEqual(["info", "spam", "urgent", null]);
      expect(rows[3]).toMatchObject({ skipped: "not_synced", slotId: d.id });
      expect(rows[0]?.truth).toBe(a.category);
      expect(rows[0]?.hardCases).toEqual(a.hardCases);
      expect(rows[1]?.lateBySec).toBe(400);
      expect(rows[0]?.lateBySec).toBeUndefined();
    });
  });

  test("6b: a mail with no result is not_triaged; a skipped slot keeps its code; a slot not tried yet is no row", async () => {
    await withRollback(db, async (trx) => {
      const org = await createOrgWithMailbox(trx);
      const [a, b, c, d] = inbound as [Slot, Slot, Slot, Slot];
      const bare = await insertTestEmail(trx, { orgId: org.orgId }, org.mailboxId, { message_id_header: idOf(b.id) });
      await mailOf(trx, org, a.id, "info", T0);
      const events: LabEvent[] = [done(a.id), done(b.id), { t: "skip", code: "smtp_failed", ref: c.id }];
      const rows = await joinRun(
        trx,
        { orgId: org.orgId },
        runOf([a.id, b.id, c.id, d.id]),
        events,
        corpus,
        org.mailboxId
      );
      expect(rows.map((row) => [row.slotId, row.skipped ?? null])).toEqual([
        [a.id, null],
        [b.id, "not_triaged"],
        [c.id, "smtp_failed"],
      ]);
      expect(rows[1]).toMatchObject({ emailId: bare, predicted: null });
      expect(rows[2]).toMatchObject({ emailId: null, predicted: null });
    });
  });

  test("7: a mail of another org with the same Message-ID is not joined (tenant)", async () => {
    await withRollback(db, async (trx) => {
      const orgA = await createOrgWithMailbox(trx);
      const orgB = await createOrgWithMailbox(trx);
      const [a] = inbound as [Slot];
      await mailOf(trx, orgB, a.id, "urgent", T0);
      const events = [done(a.id)];
      // Org A has no such mail. Even with the mailbox of org B named, org A reads none of it.
      for (const mailboxId of [orgA.mailboxId, orgB.mailboxId]) {
        const rows = await joinRun(trx, { orgId: orgA.orgId }, runOf([a.id]), events, corpus, mailboxId);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ emailId: null, predicted: null, skipped: "not_synced" });
      }
      // The same call for org B joins it.
      const own = await joinRun(trx, { orgId: orgB.orgId }, runOf([a.id]), events, corpus, orgB.mailboxId);
      expect(own[0]?.predicted).toBe("urgent");
    });
  });

  test("8b: two mail rows with one Message-ID: the row that has a result wins, whatever the order of the ids", async () => {
    await withRollback(db, async (trx) => {
      const org = await createOrgWithMailbox(trx);
      const [a] = inbound as [Slot];
      const first = await insertTestEmail(trx, { orgId: org.orgId }, org.mailboxId, { message_id_header: idOf(a.id) });
      const second = await insertTestEmail(trx, { orgId: org.orgId }, org.mailboxId, { message_id_header: idOf(a.id) });
      // The result goes to the copy with the higher id, so a pick of the lowest id would lose it.
      const [, higher] = [first, second].sort((x, y) => x.localeCompare(y)) as [string, string];
      await trx
        .insertInto("triage_results")
        .values({ org_id: org.orgId, email_id: higher, category: "spam", confidence: 0.9, reason_code: "other" })
        .execute();
      const [row] = await joinRun(trx, { orgId: org.orgId }, runOf([a.id]), [done(a.id)], corpus, org.mailboxId);
      expect(row).toMatchObject({ emailId: higher, predicted: "spam" });
    });
  });

  test("9: the triage result of a mail of another org is not read with this org context", async () => {
    await withRollback(db, async (trx) => {
      const orgA = await createOrgWithMailbox(trx);
      const orgB = await createOrgWithMailbox(trx);
      const [a] = inbound as [Slot];
      const emailId = await mailOf(trx, orgA, a.id, "urgent", T0);
      expect(await listLatestTriageByEmailIds(trx, { orgId: orgB.orgId }, [emailId])).toEqual([]);
      expect(await listLatestTriageByEmailIds(trx, { orgId: orgA.orgId }, [emailId])).toHaveLength(1);
    });
  });

  test("8: two triage rows for one mail: the latest is used", async () => {
    await withRollback(db, async (trx) => {
      const org = await createOrgWithMailbox(trx);
      const [a] = inbound as [Slot];
      const emailId = await mailOf(trx, org, a.id, "info", new Date(T0.getTime() - MINUTE_MS));
      await trx
        .insertInto("triage_results")
        .values({
          org_id: org.orgId,
          email_id: emailId,
          category: "urgent",
          confidence: 0.9,
          reason_code: "direct_request",
          created_at: new Date(T0.getTime() + MINUTE_MS),
        })
        .execute();
      // An older row inserted after the newest one must not win: the order is by time, not by insert order.
      await trx
        .insertInto("triage_results")
        .values({
          org_id: org.orgId,
          email_id: emailId,
          category: "spam",
          confidence: 0.9,
          reason_code: "direct_request",
          created_at: new Date(T0.getTime() - 120_000),
        })
        .execute();
      const [row] = await joinRun(trx, { orgId: org.orgId }, runOf([a.id]), [done(a.id)], corpus, org.mailboxId);
      expect(row?.predicted).toBe("urgent");
    });
  });
});

describe("joinSentCopies", () => {
  test("counts appended sent slots and those the server saw, in emails or in the Sent store; another org sees none", async () => {
    await withRollback(db, async (trx) => {
      const org = await createOrgWithMailbox(trx);
      const other = await createOrgWithMailbox(trx);
      const sent = [...corpus.slots.values()].filter((slot) => slot.direction === "sent").slice(0, 3);
      expect(sent).toHaveLength(3);
      const [s1, s2, s3] = sent as [Slot, Slot, Slot];
      const run = runOf([s1.id, s2.id, s3.id, (inbound[0] as Slot).id]);
      // s1: an emails row in the Sent folder. s2: a row in the Sent store. s3: appended, never seen.
      await insertTestEmail(trx, { orgId: org.orgId }, org.mailboxId, {
        message_id_header: idOf(s1.id),
        folder: "Sent",
      });
      await insertSentEmails(trx, { orgId: org.orgId }, [
        {
          mailboxId: org.mailboxId,
          dedupKey: `k-${s2.id}`,
          path: "Sent",
          uidValidity: 1,
          uid: 1,
          messageId: idOf(s2.id),
          parentMessageId: null,
          referencesIds: [],
          threadKey: `t-${s2.id}`,
          fromAddress: null,
          toAddresses: [],
          ccAddresses: [],
          subject: null,
          sentAt: T0,
          internalDate: T0,
          origin: "user",
          actionId: null,
          content: "headers_only",
        },
      ]);
      const events = [s1, s2, s3, inbound[0] as Slot].map((slot) => done(slot.id));
      expect(await joinSentCopies(trx, { orgId: org.orgId }, run, events, corpus, org.mailboxId)).toEqual({
        appended: 3,
        seen: 2,
      });
      expect(await joinSentCopies(trx, { orgId: other.orgId }, run, events, corpus, org.mailboxId)).toEqual({
        appended: 3,
        seen: 0,
      });
      // A slot the injector did not append yet is not counted.
      expect(await joinSentCopies(trx, { orgId: org.orgId }, run, events.slice(0, 1), corpus, org.mailboxId)).toEqual({
        appended: 1,
        seen: 1,
      });
    });
  });
});

describe("scoreLabRun", () => {
  let dir = "";
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("scores a run that is not stopped as partial, from the state files and the DB; the files hold no text", async () => {
    dir = mkdtempSync(join(tmpdir(), "f113-s12-score-"));
    await withRollback(db, async (trx) => {
      const org = await createOrgWithMailbox(trx);
      const other = await createOrgWithMailbox(trx);
      const state = createLabState(dir, () => new Date("2026-11-25T10:00:00.000Z"));
      state.writeOrgs({ lab: { orgId: org.orgId, mailboxId: org.mailboxId, address: "x@lab.test", chatId: 1 } });
      const [a, b, c] = inbound as [Slot, Slot, Slot];
      const run = runOf([a.id, b.id, c.id, sentSlot.id]);
      expect(state.startRun(run)).toBe("ok");
      for (const event of [
        done(a.id),
        done(b.id, 500),
        done(sentSlot.id),
        { t: "skip", code: "smtp_failed", ref: c.id } as const,
      ]) {
        state.append(RUN, event);
      }
      await mailOf(trx, org, a.id, a.category, T0);
      await mailOf(trx, org, b.id, "spam", T0);
      const call = (target: { orgId: string; mailboxId: string }, model: string) =>
        recordLlmCall(
          trx,
          { orgId: target.orgId },
          {
            mailboxId: target.mailboxId,
            role: "classifier",
            promptVersion: "test",
            model,
            endpoint: "standard",
            provider: "openai" as const,
            outcome: "ok",
            tokensIn: 1000,
            tokensOut: 200,
            latencyMs: 10,
            at: new Date("2026-11-23T10:00:00Z"),
          }
        );
      await call(org, "gpt-6-luna");
      await call(other, "other-org-model");
      // The window starts at 00:00 Warsaw of the start day (2026-11-22T23:00Z): a call before it is not in the report.
      await recordLlmCall(
        trx,
        { orgId: org.orgId },
        {
          mailboxId: org.mailboxId,
          role: "classifier",
          promptVersion: "test",
          model: "gpt-6-luna",
          endpoint: "standard",
          provider: "openai" as const,
          outcome: "ok",
          tokensIn: 1000,
          tokensOut: 200,
          latencyMs: 10,
          at: new Date("2026-11-22T22:00:00Z"),
        }
      );
      await recordLlmCall(
        trx,
        { orgId: org.orgId },
        {
          mailboxId: org.mailboxId,
          role: "classifier",
          promptVersion: "test",
          model: "gpt-6-luna",
          endpoint: "standard",
          provider: "openai" as const,
          outcome: "ok",
          tokensIn: 1000,
          tokensOut: 200,
          latencyMs: 10,
          at: new Date("2026-11-23T06:00:00Z"),
        }
      );

      const score = await scoreLabRun({ db: trx, state, corpus, now: () => new Date("2026-11-25T10:00:00.000Z") }, RUN);
      expect(score.header).toMatchObject({
        runId: RUN,
        mode: "day",
        partial: true,
        stopReason: "running",
        corpusId: "lab-01",
        corpusVersion: corpus.manifest.version,
        auditStatus: corpus.manifest.audit.status,
        models: ["gpt-6-luna"],
        capUsd: 1,
        offsetDays: 0,
        scoredAt: "2026-11-25T10:00:00.000Z",
      });
      expect(score.header.manifestHash).toMatch(/^[0-9a-f]{64}$/);
      expect(score.header.spendUsd).toBeGreaterThan(0);
      expect(score.triage.scored).toBe(2);
      // The sent slot is no triage row: it is neither not_synced nor scored.
      expect(score.triage.missing).toEqual({ notSynced: 0, notTriaged: 0, skipped: { smtp_failed: 1 } });
      expect(score.sections.coverage).toEqual(coverageOf(run, state.events(RUN)));
      expect(score.sections.sentCopies).toEqual({ appended: 1, seen: 0 });
      // Every section of the score has a renderer, and every renderer has a section (the page rule 22.8 lists the keys).
      expect(Object.keys(score.sections)).toEqual(Object.keys(SECTION_RENDERERS));
      // The second half of the report is scored from the same state and DB.
      expect(Object.keys(score.sections)).toEqual([
        "coverage",
        "sentCopies",
        "metrics",
        "delegates",
        "executive",
        "limits",
        "phishing",
        "mails",
      ]);
      // 2 calls in the window (06:00Z before the first slot, 10:00Z): $0.0002 each; the call at 22:00Z the day before is out.
      const metricsSection = score.sections.metrics as { m7: { calls: number; usd: number } };
      expect(metricsSection.m7.calls).toBe(2);
      expect(metricsSection.m7.usd).toBeCloseTo(0.0004, 10);
      expect(score.sections.limits).toEqual({
        hits: { mailbox_hour: 0, mailbox_day: 0, recipient_day: 0 },
        total: 0,
        heldAtEnd: 0,
      });

      const written = writeLabReport(score, join(dir, "out"));
      expect(written.markdown).toBe(join(dir, "out", `sim-2026-11-25-lab-01-${RUN}.md`));
      expect(existsSync(written.json)).toBe(true);
      const markdown = readFileSync(written.markdown, "utf8");
      const json = readFileSync(written.json, "utf8");
      expect(markdown).toContain("(partial)");
      for (const heading of [
        "## Metrics M2 to M5, M7",
        "## Delegates",
        "## Executive",
        "## Send limits",
        "## Phishing",
      ]) {
        expect(markdown).toContain(heading);
      }
      expect(markdown).toContain("no send limit reached");
      expect((JSON.parse(json) as LabScore).header.runId).toBe(RUN);
      for (const slot of [a, b, c]) {
        const text = corpus.texts.get(slot.id);
        if (text !== undefined) {
          expect(markdown + json).not.toContain(text.subject);
        }
      }

      // Stopped: the header drops `partial`.
      state.stopRun(RUN, "done");
      const stopped = await scoreLabRun(
        { db: trx, state, corpus, now: () => new Date("2026-11-25T10:00:00.000Z") },
        RUN
      );
      expect(stopped.header).toMatchObject({ partial: false, stopReason: "done" });
    });
  });

  test("an org that orgs.json no longer names is refused with org_gone", async () => {
    const dir2 = mkdtempSync(join(tmpdir(), "f113-s12-gone-"));
    try {
      const state = createLabState(dir2, () => T0);
      expect(state.startRun(runOf([]))).toBe("ok");
      await expect(scoreLabRun({ db, state, corpus, now: () => T0 }, RUN)).rejects.toMatchObject({ code: "org_gone" });
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });
});
