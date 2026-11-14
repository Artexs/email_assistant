import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { latestLlmPause, recordLlmCall } from "../../src/modules/audit";
import type { DB } from "../../src/platform/db";
import { configCodes, softCodes } from "../../src/platform/llm";

import { createOrgWithMailbox } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const at = (hhmm: string) => new Date(`2026-11-20T${hhmm}:00Z`);
const codes = { softCodes, configCodes };

async function call(trx: Transaction<DB>, a: { orgId: string; mailboxId: string }, outcome: string, hhmm: string) {
  await recordLlmCall(
    trx,
    { orgId: a.orgId },
    {
      mailboxId: a.mailboxId,
      role: "classifier",
      promptVersion: "test",
      model: "test-model",
      outcome,
      tokensIn: null,
      tokensOut: null,
      latencyMs: 5,
      at: at(hhmm),
    }
  );
}

describe("latestLlmPause", () => {
  test("a quota run gives its first row; an ok row after it ends the pause", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      await call(trx, a, "ok", "09:00");
      await call(trx, a, "http_429_quota", "09:05");
      await call(trx, a, "http_429_quota", "09:10");
      expect(await latestLlmPause(trx, { orgId: a.orgId }, { now: at("09:15"), ...codes })).toEqual({
        code: "http_429_quota",
        since: at("09:05"),
      });
      await call(trx, a, "ok", "09:12");
      expect(await latestLlmPause(trx, { orgId: a.orgId }, { now: at("09:15"), ...codes })).toBeNull();
    });
  });

  test("a config code older than 2 h is no pause", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      await call(trx, a, "http_429_quota", "09:05");
      await call(trx, a, "http_429_quota", "09:10");
      expect(await latestLlmPause(trx, { orgId: a.orgId }, { now: at("11:10"), ...codes })).toEqual({
        code: "http_429_quota",
        since: at("09:10"),
      });
      expect(await latestLlmPause(trx, { orgId: a.orgId }, { now: at("11:20"), ...codes })).toBeNull();
    });
  });

  test("a soft code counts for 10 min", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      await call(trx, a, "timeout", "09:00");
      expect(await latestLlmPause(trx, { orgId: a.orgId }, { now: at("09:05"), ...codes })).toEqual({
        code: "timeout",
        since: at("09:00"),
      });
      expect(await latestLlmPause(trx, { orgId: a.orgId }, { now: at("09:20"), ...codes })).toBeNull();
    });
  });

  test("a code outside both lists, and no row, give null", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      expect(await latestLlmPause(trx, { orgId: a.orgId }, { now: at("09:05"), ...codes })).toBeNull();
      await call(trx, a, "llm_blocked", "09:00");
      expect(await latestLlmPause(trx, { orgId: a.orgId }, { now: at("09:05"), ...codes })).toBeNull();
    });
  });

  test("the run goes back over mixed pause codes and stops at a row of another kind", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      await call(trx, a, "llm_blocked", "09:00");
      await call(trx, a, "http_429", "09:02");
      await call(trx, a, "http_429_quota", "09:04");
      expect(await latestLlmPause(trx, { orgId: a.orgId }, { now: at("09:05"), ...codes })).toEqual({
        code: "http_429_quota",
        since: at("09:02"),
      });
    });
  });

  test("organization B sees null for the rows of organization A", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      await call(trx, a, "http_429_quota", "09:05");
      expect(await latestLlmPause(trx, { orgId: b.orgId }, { now: at("09:15"), ...codes })).toBeNull();
      expect((await latestLlmPause(trx, { orgId: a.orgId }, { now: at("09:15"), ...codes }))?.code).toBe(
        "http_429_quota"
      );
    });
  });
});
