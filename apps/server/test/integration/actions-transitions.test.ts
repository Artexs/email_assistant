import { actionTypes, type ActionType } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import {
  CLAIM_MAX_AGE_MS,
  createPlanned,
  expireReadyOriginals,
  expireStaleReady,
  finishAction,
  getSend,
  insertReverse,
  MAILBOX_ACTION_TYPES,
  markApplying,
  markUndone,
  releaseAction,
  STALE_AFTER_MS,
} from "../../src/modules/actions";
import {
  expireReadyDraft,
  insertSendAgain,
  type PlannedActionInput,
  setApproved,
  setExpired,
  setRejected,
} from "../../src/modules/actions/repo";
import {
  ACTION_ENTRIES,
  ACTION_STATUSES,
  WRITER_GUARDS,
  type ActionStatus,
  type ActionWriter,
  type WriterGuard,
} from "../../src/modules/actions/transitions";
import type { DB, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, insertAction, insertDraftAndSend, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

// A statement that must fail aborts the transaction: run it in a savepoint and roll back to it.
async function expectCode(trx: Transaction<DB>, name: string, run: () => Promise<unknown>, code: string) {
  await sql`savepoint ${sql.id(name)}`.execute(trx);
  await expect(run()).rejects.toMatchObject({ code });
  await sql`rollback to savepoint ${sql.id(name)}`.execute(trx);
}

const sorted = (values: readonly string[]): string[] => [...values].sort();

// --- Test C: the lists of the map equal the CHECK lists in Postgres --------------------------------------------

describe("transitions map: schema", () => {
  async function checkDefinitions(trx: Transaction<DB>): Promise<{ name: string; def: string }[]> {
    const result = await sql<{ conname: string; def: string }>`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'actions'::regclass AND contype = 'c'`.execute(trx);
    return result.rows.map((row) => ({ name: row.conname, def: row.def }));
  }

  const quoted = (def: string): string[] => [...def.matchAll(/'([a-z_]+)'::text/g)].map((match) => match[1] ?? "");

  test("the status list equals the status CHECK, the type list equals the type CHECK", async () => {
    await withRollback(db, async (trx) => {
      const checks = await checkDefinitions(trx);
      const statusCheck = checks.find((check) => check.name === "actions_status_check");
      const typeCheck = checks.find((check) => check.name === "actions_type_check");
      expect(statusCheck).toBeDefined();
      expect(typeCheck).toBeDefined();
      expect(statusCheck?.def.startsWith("CHECK ((status = ANY (ARRAY[")).toBe(true);
      expect(sorted(quoted(statusCheck?.def ?? ""))).toEqual(sorted(ACTION_STATUSES));
      expect(sorted(quoted(typeCheck?.def ?? ""))).toEqual(sorted(actionTypes));
    });
  });

  test("an unknown status fails the CHECK", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, mailboxId } = await createOrgWithMailbox(trx);
      const ctx = { orgId };
      const emailId = await insertTestEmail(trx, ctx, mailboxId);
      await expectCode(
        trx,
        "unknown_status",
        () => insertAction(trx, ctx, emailId, { type: "move", status: "bogus" }),
        "23514"
      );
      await insertAction(trx, ctx, emailId, { type: "move", status: "ready" });
    });
  });
});

// --- Test B part 1: markApplying, finishAction, releaseAction --------------------------------------------------

function guardOf(writer: ActionWriter, variant: string): WriterGuard {
  const guard = WRITER_GUARDS.find((candidate) => candidate.writer === writer && candidate.variant === variant);
  if (!guard) {
    throw new Error(`WRITER_GUARDS has no row for ${writer} / ${variant}`);
  }
  return guard;
}

interface CallRow {
  id: string;
  emailId: string;
  mailboxId: string;
  userId: string;
  lockedAt: Date | null;
}

type WriterCall = (trx: Transaction<DB>, ctx: TenantContext, row: CallRow, lockedAt: Date) => Promise<boolean>;

interface CheckOptions {
  // The status that the variant writes when it changes a row.
  next: ActionStatus;
  // Rows that the guard of the SQL admits and a CHECK rejects at the write: the call fails with this code.
  failsWith?: (type: ActionType, status: ActionStatus) => string | undefined;
  // Types that the map does not list for the variant, but that the test also drives (they must be rejected).
  extraTypes?: readonly ActionType[];
  // The lock of the rows in the main pass. "token": the claim token (default; the call passes it).
  // "free": no lock; the test then adds the held passes. "fresh": a held row (the variant is for rows that a run holds).
  lock?: "token" | "free" | "fresh";
  // Only these statuses are driven (a variant that covers one status of a function with a wider SQL guard).
  statuses?: readonly ActionStatus[];
  // `created_at` of the rows (the batch writers want old rows).
  createdAt?: Date;
}

// A row that a CHECK forbids cannot exist: the test skips it and lists it.
function forbiddenRow(type: ActionType, status: ActionStatus): boolean {
  return type === "send" && status === "ready"; // actions_send_never_ready_check
}

const TOKEN = new Date("2026-11-11T10:00:00Z");
const WRONG_TOKEN = new Date("2026-11-11T10:00:01Z");
// The held rule: a row is held when `locked_at` is at or after `staleBefore`.
const NOW = new Date("2026-11-11T12:00:00Z");
const STALE_BEFORE = new Date(NOW.getTime() - STALE_AFTER_MS);
const FRESH_LOCK = new Date(NOW.getTime() - 60_000);
const STALE_LOCK = new Date(STALE_BEFORE.getTime() - 60_000);

// For every status and every type of the guard: the real function must change the row exactly when the map says so.
// A guard with `held: "blocks"` is also driven with a fresh lock (not changed) and a stale lock (changed);
// every other guard in "free" mode must ignore a fresh lock.
async function checkWriter(guard: WriterGuard, call: WriterCall, options: CheckOptions): Promise<void> {
  const types = [...(Object.keys(guard.from) as ActionType[]), ...(options.extraTypes ?? [])];
  const lockMode = options.lock ?? "token";
  const mainLock = lockMode === "token" ? TOKEN : lockMode === "fresh" ? FRESH_LOCK : null;
  expect(types.length).toBeGreaterThan(0);
  expect(guard.to).toContain(options.next);
  if (guard.held) {
    expect(lockMode).toBe("free");
  }
  const skipped: string[] = [];
  let admittedCases = 0;

  await withRollback(db, async (trx) => {
    const { orgId, userId, mailboxId } = await createOrgWithMailbox(trx);
    const ctx = { orgId };
    const emailId = await insertTestEmail(trx, ctx, mailboxId);

    const insertRow = async (type: ActionType, status: ActionStatus, lockedAt: Date | null): Promise<CallRow> => {
      const id = await insertAction(trx, ctx, emailId, {
        type,
        status,
        lockedAt,
        approvedAt: type === "send" ? TOKEN : null,
        ...(options.createdAt ? { createdAt: options.createdAt } : {}),
      });
      return { id, emailId, mailboxId, userId, lockedAt };
    };
    const statusOf = async (id: string) =>
      trx.selectFrom("actions").select(["status", "locked_at"]).where("id", "=", id).executeTakeFirstOrThrow();

    for (const type of types) {
      for (const status of options.statuses ?? ACTION_STATUSES) {
        if (forbiddenRow(type, status)) {
          skipped.push(`${type} x ${status}`);
          continue;
        }
        const row = await insertRow(type, status, mainLock);
        const admitted = guard.from[type]?.includes(status) ?? false;
        const label = `${guard.writer} ${guard.variant} ${type} x ${status}`;
        const failCode = options.failsWith?.(type, status);

        if (failCode) {
          await expectCode(trx, `check_code_${failCode}`, () => call(trx, ctx, row, TOKEN), failCode);
          continue;
        }

        const changed = await call(trx, ctx, row, TOKEN);
        const after = await statusOf(row.id);
        expect({ label, changed }).toEqual({ label, changed: admitted });
        expect({ label, status: after.status }).toEqual({ label, status: admitted ? options.next : status });
        if (admitted) {
          admittedCases += 1;
        } else {
          // A row that the guard does not admit keeps its lock.
          expect({ label, locked: after.locked_at?.getTime() ?? null }).toEqual({
            label,
            locked: mainLock?.getTime() ?? null,
          });
        }
      }
    }

    if (lockMode === "free") {
      // The held passes, for every row that the guard admits.
      const blocks = guard.held === "blocks";
      for (const type of types) {
        for (const status of guard.from[type] ?? []) {
          for (const [name, lock, changes] of [
            ["fresh lock", FRESH_LOCK, !blocks],
            ["stale lock", STALE_LOCK, true],
          ] as const) {
            const label = `${guard.writer} ${guard.variant} ${type} x ${status}, ${name}`;
            const row = await insertRow(type, status, lock);
            const changed = await call(trx, ctx, row, TOKEN);
            const after = await statusOf(row.id);
            expect({ label, changed }).toEqual({ label, changed: changes });
            expect({ label, status: after.status }).toEqual({ label, status: changes ? options.next : status });
          }
        }
      }
    }

    if (lockMode === "token") {
      // A wrong token changes nothing, for one row that the guard admits.
      const type = types.find((candidate) => (guard.from[candidate] ?? []).length > 0);
      const status = type ? guard.from[type]?.[0] : undefined;
      if (type && status) {
        const row = await insertRow(type, status, TOKEN);
        const changed = await call(trx, ctx, row, WRONG_TOKEN);
        const after = await statusOf(row.id);
        expect(changed).toBe(false);
        expect(after.status).toBe(status);
      }
    }
  });

  expect(admittedCases).toBeGreaterThan(0);
  // Only the CHECK-forbidden rows are skipped.
  expect(skipped.every((entry) => entry === "send x ready")).toBe(true);
}

describe("transitions map: markApplying", () => {
  test("default: the guard row equals the behavior", async () => {
    await checkWriter(
      guardOf("markApplying", "default"),
      (trx, ctx, row, token) => markApplying(trx, ctx, row.id, token),
      {
        next: "applying",
      }
    );
  });
});

describe("transitions map: finishAction", () => {
  const AT = new Date("2026-11-11T11:00:00Z");
  const nexts: { next: ActionStatus; finish: Parameters<typeof finishAction>[4] }[] = [
    { next: "applied", finish: { status: "applied", at: AT } },
    { next: "failed", finish: { status: "failed", at: AT, reason: "hard_error" } },
    { next: "expired", finish: { status: "expired", at: AT, reason: "send_closed" } },
  ];
  const variants: { variant: string; from?: readonly ("ready" | "approved" | "applying")[] }[] = [
    { variant: "default" },
    { variant: `from ["applying"]`, from: ["applying"] },
    { variant: `from ["approved"]`, from: ["approved"] },
  ];

  for (const { variant, from } of variants) {
    for (const { next, finish } of nexts) {
      test(`${variant} -> ${next}: the guard row equals the behavior`, async () => {
        await checkWriter(
          guardOf("finishAction", variant),
          (trx, ctx, row, token) => finishAction(trx, ctx, row.id, token, finish, from ? { from } : undefined),
          { next }
        );
      });
    }
  }
});

describe("transitions map: releaseAction", () => {
  const RELEASE_NOW = new Date("2026-11-11T12:00:00Z");
  const targets = ["ready", "approved", "applying"] as const;

  for (const toStatus of targets) {
    test(`toStatus "${toStatus}": the guard row equals the behavior`, async () => {
      await checkWriter(
        guardOf("releaseAction", `toStatus "${toStatus}"`),
        (trx, ctx, row, token) =>
          releaseAction(trx, ctx, row.id, token, {
            toStatus,
            nextAttemptAt: null,
            countAttempt: false,
            now: RELEASE_NOW,
          }),
        {
          next: toStatus,
          // A send is never `ready`: the guard admits the row, the CHECK rejects the write.
          ...(toStatus === "ready"
            ? {
                extraTypes: ["send"] as const,
                failsWith: (type: ActionType, status: ActionStatus) =>
                  type === "send" && (status === "approved" || status === "applying") ? "23514" : undefined,
              }
            : {}),
        }
      );
    });
  }
});

// --- Test B part 2: close, approval, undo and entry writers ----------------------------------------------------

const NON_SEND_TYPES: readonly ActionType[] = ["move", "mark_read", "flag", "save_summary", "create_draft"];
const WRITE_AT = new Date("2026-11-11T12:30:00Z");

describe("transitions map: setExpired", () => {
  for (const from of ["awaiting_approval", "approved"] as const) {
    test(`from "${from}": the guard row equals the behavior`, async () => {
      await checkWriter(
        guardOf("setExpired", `from "${from}"`),
        (trx, ctx, row) =>
          setExpired(trx, ctx, row.id, { reason: "timeout", at: WRITE_AT, from, staleBefore: STALE_BEFORE }),
        { next: "expired", lock: "free", extraTypes: NON_SEND_TYPES }
      );
    });
  }
});

describe("transitions map: setApproved", () => {
  test("default: the guard row equals the behavior", async () => {
    await checkWriter(
      guardOf("setApproved", "default"),
      (trx, ctx, row) => setApproved(trx, ctx, row.id, { userId: row.userId, via: "telegram", at: WRITE_AT }),
      { next: "approved", lock: "free", extraTypes: NON_SEND_TYPES }
    );
  });
});

describe("transitions map: setRejected", () => {
  const reject = (trx: Transaction<DB>, ctx: TenantContext, row: CallRow) =>
    setRejected(trx, ctx, row.id, { at: WRITE_AT, staleBefore: STALE_BEFORE });

  test(`from "awaiting_approval": the guard row equals the behavior (a held row: only awaiting_approval)`, async () => {
    await checkWriter(guardOf("setRejected", `from "awaiting_approval"`), reject, {
      next: "rejected",
      lock: "fresh",
      extraTypes: NON_SEND_TYPES,
    });
  });

  test(`from "approved": the guard row equals the behavior, held or not`, async () => {
    await checkWriter(guardOf("setRejected", `from "approved"`), reject, {
      next: "rejected",
      lock: "free",
      statuses: ["approved"],
    });
  });
});

describe("transitions map: expireReadyDraft", () => {
  test("default: the guard row equals the behavior", async () => {
    await checkWriter(
      guardOf("expireReadyDraft", "default"),
      (trx, ctx, row) => expireReadyDraft(trx, ctx, row.id, WRITE_AT),
      {
        next: "expired",
        lock: "free",
        extraTypes: ["move", "send"],
      }
    );
  });
});

const OLD = new Date(NOW.getTime() - CLAIM_MAX_AGE_MS - 3_600_000);

describe("transitions map: expireStaleReady", () => {
  test("default: the guard row equals the behavior (held or not)", async () => {
    await checkWriter(
      guardOf("expireStaleReady", "default"),
      async (trx, ctx, row) =>
        (await expireStaleReady(trx, ctx, row.mailboxId, { now: NOW, staleBefore: STALE_BEFORE })).some(
          (expired) => expired.id === row.id
        ),
      { next: "expired", lock: "free", createdAt: OLD, extraTypes: ["save_summary", "create_draft"] }
    );
  });
});

describe("transitions map: expireReadyOriginals", () => {
  for (const reason of ["policy_changed", "undo", "manual"] as const) {
    test(`reason "${reason}": the guard row equals the behavior (held or not)`, async () => {
      await checkWriter(
        guardOf("expireReadyOriginals", "default"),
        async (trx, ctx, row) =>
          (
            await expireReadyOriginals(
              trx,
              ctx,
              { mailboxId: row.mailboxId, types: MAILBOX_ACTION_TYPES },
              { now: NOW, staleBefore: STALE_BEFORE, reason }
            )
          ).some((expired) => expired.id === row.id),
        { next: "expired", lock: "free", extraTypes: ["save_summary", "create_draft"] }
      );
    });
  }
});

describe("transitions map: markUndone", () => {
  test("default: the guard row equals the behavior", async () => {
    await checkWriter(
      guardOf("markUndone", "default"),
      (trx, ctx, row) => markUndone(trx, ctx, row.id, { at: WRITE_AT, reason: "undo" }),
      { next: "undone", lock: "free" }
    );
  });
});

// --- Entry writers: the new row gets only a status of ACTION_ENTRIES -------------------------------------------

function entriesOf(writer: ActionWriter) {
  const entries = ACTION_ENTRIES.filter((entry) => entry.writer === writer);
  expect(entries.length).toBeGreaterThan(0);
  return entries;
}

// The entry statuses of `createPlanned` are the statuses that its input type allows.
function plannedStatus(status: ActionStatus): PlannedActionInput["status"] {
  if (status !== "ready" && status !== "awaiting_approval" && status !== "logged") {
    throw new Error(`createPlanned cannot write ${status}`);
  }
  return status;
}

describe("transitions map: entry writers", () => {
  test("createPlanned writes each entry status for each type of the map", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, mailboxId } = await createOrgWithMailbox(trx);
      const ctx = { orgId };
      for (const entry of entriesOf("createPlanned")) {
        const status = plannedStatus(entry.status);
        for (const type of entry.types) {
          const emailId = await insertTestEmail(trx, ctx, mailboxId);
          const item: PlannedActionInput = {
            type,
            payload: {},
            status,
            idempotencyKey: type === "send" ? `${emailId}:send` : `${emailId}:${type}`,
            ...(type === "send" ? { dependsOn: "create_draft" as const } : {}),
          };
          // A send needs its draft in the same call (the draft is `ready` when the send waits for approval).
          const draft: PlannedActionInput = {
            type: "create_draft",
            payload: {},
            status: status === "awaiting_approval" ? "ready" : status,
            idempotencyKey: `${emailId}:create_draft`,
          };
          const created = await createPlanned(trx, ctx, emailId, type === "send" ? [draft, item] : [item]);
          const label = `createPlanned ${type} x ${entry.status}`;
          const written = created.filter((row) => row.type === type);
          expect(written.length, label).toBe(1);
          expect({ label, status: written[0]?.status }).toEqual({ label, status: entry.status });
        }
      }
    });
  });

  test("insertReverse writes each entry status for each type of the map", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, mailboxId } = await createOrgWithMailbox(trx);
      const ctx = { orgId };
      for (const entry of entriesOf("insertReverse")) {
        for (const type of entry.types) {
          const emailId = await insertTestEmail(trx, ctx, mailboxId);
          const originalId = await insertAction(trx, ctx, emailId, { type, status: "applied" });
          const reverseId = await insertReverse(trx, ctx, { id: originalId, emailId, type, payload: {} });
          expect(reverseId).not.toBeNull();
          const row = await trx
            .selectFrom("actions")
            .select(["status", "reverses_action_id"])
            .where("id", "=", reverseId as string)
            .executeTakeFirstOrThrow();
          const label = `insertReverse ${type}`;
          expect({ label, status: row.status }).toEqual({ label, status: entry.status });
          expect(row.reverses_action_id).toBe(originalId);
        }
      }
    });
  });

  test("insertSendAgain writes the entry status; the failed row stays failed", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, userId, mailboxId } = await createOrgWithMailbox(trx);
      const ctx = { orgId };
      for (const entry of entriesOf("insertSendAgain")) {
        expect(entry.types).toEqual(["send"]);
        const { sendId } = await insertDraftAndSend(trx, ctx, mailboxId, {
          sendStatus: "failed",
          approved: { userId, at: TOKEN },
        });
        const previous = await getSend(trx, ctx, sendId);
        expect(previous).toBeDefined();
        const againId = await insertSendAgain(trx, ctx, previous as NonNullable<typeof previous>, {
          userId,
          via: "telegram",
          at: WRITE_AT,
        });
        expect(againId).not.toBeNull();
        const again = await trx
          .selectFrom("actions")
          .select("status")
          .where("id", "=", againId as string)
          .executeTakeFirstOrThrow();
        const old = await trx.selectFrom("actions").select("status").where("id", "=", sendId).executeTakeFirstOrThrow();
        expect(again.status).toBe(entry.status);
        expect(old.status).toBe("failed");
      }
    });
  });
});
