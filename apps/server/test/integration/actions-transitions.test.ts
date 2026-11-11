import { actionTypes, type ActionType } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { finishAction, markApplying, releaseAction } from "../../src/modules/actions";
import {
  ACTION_STATUSES,
  WRITER_GUARDS,
  type ActionStatus,
  type ActionWriter,
  type WriterGuard,
} from "../../src/modules/actions/transitions";
import type { DB, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, insertAction, insertTestEmail } from "./fixtures";
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
  lockedAt: Date;
}

type WriterCall = (trx: Transaction<DB>, ctx: TenantContext, row: CallRow, lockedAt: Date) => Promise<boolean>;

interface CheckOptions {
  // The status that the variant writes when it changes a row.
  next: ActionStatus;
  // Rows that the guard of the SQL admits and a CHECK rejects at the write: the call fails with this code.
  failsWith?: (type: ActionType, status: ActionStatus) => string | undefined;
  // Types that the map does not list for the variant, but that the test also drives (they must be rejected).
  extraTypes?: readonly ActionType[];
}

// A row that a CHECK forbids cannot exist: the test skips it and lists it.
function forbiddenRow(type: ActionType, status: ActionStatus): boolean {
  return type === "send" && status === "ready"; // actions_send_never_ready_check
}

const TOKEN = new Date("2026-11-11T10:00:00Z");
const WRONG_TOKEN = new Date("2026-11-11T10:00:01Z");

// For every status and every type of the guard: the real function must change the row exactly when the map says so.
async function checkWriter(guard: WriterGuard, call: WriterCall, options: CheckOptions): Promise<void> {
  const types = [...(Object.keys(guard.from) as ActionType[]), ...(options.extraTypes ?? [])];
  expect(types.length).toBeGreaterThan(0);
  expect(guard.to).toContain(options.next);
  const skipped: string[] = [];
  let admittedCases = 0;

  await withRollback(db, async (trx) => {
    const { orgId, mailboxId } = await createOrgWithMailbox(trx);
    const ctx = { orgId };
    const emailId = await insertTestEmail(trx, ctx, mailboxId);

    for (const type of types) {
      for (const status of ACTION_STATUSES) {
        if (forbiddenRow(type, status)) {
          skipped.push(`${type} x ${status}`);
          continue;
        }
        const id = await insertAction(trx, ctx, emailId, {
          type,
          status,
          lockedAt: TOKEN,
          approvedAt: type === "send" ? TOKEN : null,
        });
        const row = { id, emailId, lockedAt: TOKEN };
        const admitted = guard.from[type]?.includes(status) ?? false;
        const label = `${guard.writer} ${guard.variant} ${type} x ${status}`;
        const failCode = options.failsWith?.(type, status);

        if (failCode) {
          await expectCode(trx, `check_code_${failCode}`, () => call(trx, ctx, row, TOKEN), failCode);
          continue;
        }

        const changed = await call(trx, ctx, row, TOKEN);
        const after = await trx
          .selectFrom("actions")
          .select(["status", "locked_at"])
          .where("id", "=", id)
          .executeTakeFirstOrThrow();
        expect({ label, changed }).toEqual({ label, changed: admitted });
        expect({ label, status: after.status }).toEqual({ label, status: admitted ? options.next : status });
        if (admitted) {
          admittedCases += 1;
        } else {
          // A row that the guard does not admit keeps its lock.
          expect({ label, locked: after.locked_at?.getTime() }).toEqual({ label, locked: TOKEN.getTime() });
        }
      }
    }

    // A wrong token changes nothing, for one row that the guard admits.
    const type = types.find((candidate) => (guard.from[candidate] ?? []).length > 0);
    const status = type ? guard.from[type]?.[0] : undefined;
    if (type && status) {
      const id = await insertAction(trx, ctx, emailId, {
        type,
        status,
        lockedAt: TOKEN,
        approvedAt: type === "send" ? TOKEN : null,
      });
      const changed = await call(trx, ctx, { id, emailId, lockedAt: TOKEN }, WRONG_TOKEN);
      const after = await trx.selectFrom("actions").select("status").where("id", "=", id).executeTakeFirstOrThrow();
      expect(changed).toBe(false);
      expect(after.status).toBe(status);
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
  const NOW = new Date("2026-11-11T12:00:00Z");
  const targets = ["ready", "approved", "applying"] as const;

  for (const toStatus of targets) {
    test(`toStatus "${toStatus}": the guard row equals the behavior`, async () => {
      await checkWriter(
        guardOf("releaseAction", `toStatus "${toStatus}"`),
        (trx, ctx, row, token) =>
          releaseAction(trx, ctx, row.id, token, { toStatus, nextAttemptAt: null, countAttempt: false, now: NOW }),
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
