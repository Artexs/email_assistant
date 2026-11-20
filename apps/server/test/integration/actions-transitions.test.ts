import { actionTypes, type ActionType, MINUTE_MS, HOUR_MS } from "@ea/core";
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
  insertEditedPair,
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
  // The call narrows the statuses of the row (`finishAction` with `opts.from`): admitted = row.from ∩ narrow.
  narrow?: readonly ActionStatus[];
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
const FRESH_LOCK = new Date(NOW.getTime() - MINUTE_MS);
const STALE_LOCK = new Date(STALE_BEFORE.getTime() - MINUTE_MS);

// For every status and every type of the guard: the real function must change the row exactly when the map says so.
// A guard with `held: "blocks"` is also driven with a fresh lock (not changed) and a stale lock (changed);
// every other guard in "free" mode must ignore a fresh lock.
async function checkWriter(guard: WriterGuard, call: WriterCall, options: CheckOptions): Promise<void> {
  const types = [...new Set([...(Object.keys(guard.from) as ActionType[]), ...(options.extraTypes ?? [])])];
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
        const admitted =
          (guard.from[type]?.includes(status) ?? false) && (options.narrow ? options.narrow.includes(status) : true);
        const label = `${guard.writer} ${guard.variant} ${type} x ${status}`;
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
        extraTypes: actionTypes,
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
  // The row of the target, narrowed by `opts.from` (none = the default `ready`, `applying`).
  const narrowings: { name: string; from?: readonly ("ready" | "approved" | "applying")[] }[] = [
    { name: "no from" },
    { name: `from ["applying"]`, from: ["applying"] },
    { name: `from ["approved"]`, from: ["approved"] },
  ];

  for (const { next, finish } of nexts) {
    for (const { name, from } of narrowings) {
      // `to "applied"` with `from ["approved"]` admits nothing (a send applies from `applying`): the closed-edge test covers it.
      if (next === "applied" && from?.length === 1 && from[0] === "approved") continue;
      test(`to "${next}", ${name}: the admitted set is the row narrowed by opts.from`, async () => {
        await checkWriter(
          guardOf("finishAction", `to "${next}"`),
          (trx, ctx, row, token) => finishAction(trx, ctx, row.id, token, finish, from ? { from } : undefined),
          { next, narrow: from ?? ["ready", "applying"], extraTypes: actionTypes }
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
          // Every type is driven. A send is never `ready`: the guard refuses it (no `23514` from the CHECK).
          extraTypes: actionTypes,
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

  test("a row in any other status, with no lock or a stale lock, is refused (the `approved` branch admits only `approved`)", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, mailboxId } = await createOrgWithMailbox(trx);
      const ctx = { orgId };
      const emailId = await insertTestEmail(trx, ctx, mailboxId);
      const rows = [guardOf("setRejected", `from "awaiting_approval"`), guardOf("setRejected", `from "approved"`)];
      const admitted = new Set(rows.flatMap((row) => (row.from.send ?? []).map((status) => `send x ${status}`)));
      for (const type of actionTypes) {
        for (const status of ACTION_STATUSES) {
          for (const lockedAt of [null, STALE_LOCK]) {
            if (forbiddenRow(type, status) || admitted.has(`${type} x ${status}`)) continue;
            const id = await insertAction(trx, ctx, emailId, {
              type,
              status,
              lockedAt,
              approvedAt: type === "send" ? TOKEN : null,
            });
            const label = `${type} x ${status}, lock ${lockedAt === null ? "none" : "stale"}`;
            const changed = await setRejected(trx, ctx, id, { at: WRITE_AT, staleBefore: STALE_BEFORE });
            expect({ label, changed }).toEqual({ label, changed: false });
            const after = await trx
              .selectFrom("actions")
              .select("status")
              .where("id", "=", id)
              .executeTakeFirstOrThrow();
            expect({ label, status: after.status }).toEqual({ label, status });
          }
        }
      }
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

const OLD = new Date(NOW.getTime() - CLAIM_MAX_AGE_MS - HOUR_MS);

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
      { next: "undone", lock: "free", extraTypes: actionTypes }
    );
  });
});

// --- Closed latent edges ----------------------------------------------------------------------------------------
// Moves that a guard once admitted and no caller uses. Each one must now return `false` and leave the row unchanged.

type ClosedWriter = "markApplying" | "finishAction" | "releaseAction" | "markUndone";

interface ClosedRow {
  writer: ClosedWriter;
  from: ActionStatus;
  to: ActionStatus;
  types: readonly ActionType[];
}

const MAILBOX_TYPES: readonly ActionType[] = ["move", "mark_read", "flag"];
const MAILBOX_SUMMARY: readonly ActionType[] = [...MAILBOX_TYPES, "save_summary"];

const CLOSED: readonly ClosedRow[] = [
  { writer: "markApplying", from: "ready", to: "applying", types: MAILBOX_SUMMARY },
  { writer: "markApplying", from: "approved", to: "applying", types: NON_SEND_TYPES },
  { writer: "finishAction", from: "ready", to: "expired", types: MAILBOX_SUMMARY },
  { writer: "finishAction", from: "ready", to: "failed", types: ["save_summary"] },
  { writer: "finishAction", from: "applying", to: "applied", types: MAILBOX_SUMMARY },
  { writer: "finishAction", from: "applying", to: "failed", types: MAILBOX_SUMMARY },
  { writer: "finishAction", from: "applying", to: "expired", types: [...MAILBOX_SUMMARY, "send"] },
  { writer: "finishAction", from: "approved", to: "applied", types: ["send"] },
  { writer: "releaseAction", from: "ready", to: "ready", types: ["save_summary"] },
  { writer: "releaseAction", from: "applying", to: "ready", types: MAILBOX_SUMMARY },
  { writer: "releaseAction", from: "approved", to: "ready", types: NON_SEND_TYPES },
  { writer: "releaseAction", from: "ready", to: "approved", types: NON_SEND_TYPES },
  { writer: "releaseAction", from: "approved", to: "approved", types: NON_SEND_TYPES },
  { writer: "releaseAction", from: "applying", to: "approved", types: NON_SEND_TYPES },
  { writer: "releaseAction", from: "ready", to: "applying", types: NON_SEND_TYPES },
  { writer: "releaseAction", from: "approved", to: "applying", types: actionTypes },
  { writer: "releaseAction", from: "applying", to: "applying", types: MAILBOX_SUMMARY },
  { writer: "markUndone", from: "applied", to: "undone", types: ["send", "save_summary"] },
];

const CLOSED_KEYS = CLOSED.flatMap((row) => row.types.map((type) => ({ ...row, type })));

const FINISH_AT = new Date("2026-11-11T11:00:00Z");
const finishFor = (to: ActionStatus): Parameters<typeof finishAction>[4] => {
  if (to === "applied") return { status: "applied", at: FINISH_AT };
  if (to === "failed") return { status: "failed", at: FINISH_AT, reason: "hard_error" };
  if (to === "expired") return { status: "expired", at: FINISH_AT, reason: "send_closed" };
  throw new Error(`finishAction does not write ${to}`);
};
const releaseTo = (toStatus: "ready" | "approved" | "applying") => ({
  toStatus,
  nextAttemptAt: null,
  countAttempt: false,
  now: NOW,
});

// The real writer, with every other condition true, so that only the guard can refuse the row.
function callWriter(
  writer: ClosedWriter,
  to: ActionStatus,
  from: ActionStatus,
  trx: Transaction<DB>,
  ctx: TenantContext,
  id: string
): Promise<boolean> {
  switch (writer) {
    case "markApplying":
      return markApplying(trx, ctx, id, TOKEN);
    case "finishAction":
      // The explicit `from` makes the row the only filter.
      return finishAction(trx, ctx, id, TOKEN, finishFor(to), { from: [from as "ready" | "approved" | "applying"] });
    case "releaseAction":
      return releaseAction(trx, ctx, id, TOKEN, releaseTo(to as "ready" | "approved" | "applying"));
    case "markUndone":
      return markUndone(trx, ctx, id, { at: WRITE_AT, reason: "undo" });
  }
}

describe("transitions map: closed latent edges", () => {
  test("the table holds 70 keys", () => {
    expect(CLOSED.length).toBe(18);
    expect(CLOSED_KEYS.length).toBe(70);
    expect(new Set(CLOSED_KEYS.map((k) => `${k.writer} ${k.type} ${k.from} ${k.to}`)).size).toBe(70);
  });

  test("each closed move returns false and leaves the row unchanged (cases 1-8 are rows of the table)", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, mailboxId } = await createOrgWithMailbox(trx);
      const ctx = { orgId };
      const emailId = await insertTestEmail(trx, ctx, mailboxId);
      for (const { writer, from, to, type } of CLOSED_KEYS) {
        const label = `${writer} ${type}: ${from} -> ${to}`;
        const id = await insertAction(trx, ctx, emailId, {
          type,
          status: from,
          lockedAt: TOKEN,
          approvedAt: type === "send" ? TOKEN : null,
        });
        const changed = await callWriter(writer, to, from, trx, ctx, id);
        const after = await trx
          .selectFrom("actions")
          .select(["status", "locked_at"])
          .where("id", "=", id)
          .executeTakeFirstOrThrow();
        expect({ label, changed }).toEqual({ label, changed: false });
        expect({ label, status: after.status, locked: after.locked_at?.getTime() }).toEqual({
          label,
          status: from,
          locked: TOKEN.getTime(),
        });
      }
    });
  });

  // Controls: the guard still admits these (the first three are used moves, the last two are the known blind spot).
  test("controls: used moves still change the row; the original/reverse blind spot stays open", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, mailboxId } = await createOrgWithMailbox(trx);
      const ctx = { orgId };
      const emailId = await insertTestEmail(trx, ctx, mailboxId);
      const row = (type: ActionType, status: ActionStatus, reversesActionId: string | null = null) =>
        insertAction(trx, ctx, emailId, {
          type,
          status,
          lockedAt: TOKEN,
          approvedAt: type === "send" ? TOKEN : null,
          reversesActionId,
        });
      const statusOf = async (id: string) =>
        (await trx.selectFrom("actions").select("status").where("id", "=", id).executeTakeFirstOrThrow()).status;

      // 9. A send that fails from `approved` (a held send that cannot start).
      const nine = await row("send", "approved");
      expect(await finishAction(trx, ctx, nine, TOKEN, finishFor("failed"), { from: ["approved"] })).toBe(true);
      expect(await statusOf(nine)).toBe("failed");
      // 10. A send that expires from `approved`.
      const ten = await row("send", "approved");
      expect(await finishAction(trx, ctx, ten, TOKEN, finishFor("expired"), { from: ["approved"] })).toBe(true);
      expect(await statusOf(ten)).toBe("expired");
      // 11. A draft that is released from `applying` back to `ready` (before the APPEND).
      const eleven = await row("create_draft", "applying");
      expect(await releaseAction(trx, ctx, eleven, TOKEN, releaseTo("ready"))).toBe(true);
      expect(await statusOf(eleven)).toBe("ready");
      // 12. Blind spot: an original draft `ready` -> `applied` through `finishAction` (no caller).
      const twelve = await row("create_draft", "ready");
      expect(await finishAction(trx, ctx, twelve, TOKEN, finishFor("applied"))).toBe(true);
      expect(await statusOf(twelve)).toBe("applied");
      // 13. Blind spot: a reverse draft `ready` -> `applying` through `markApplying` (no caller).
      const original = await row("create_draft", "applied");
      const thirteen = await row("create_draft", "ready", original);
      expect(await markApplying(trx, ctx, thirteen, TOKEN)).toBe(true);
      expect(await statusOf(thirteen)).toBe("applying");
    });
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

  test("insertEditedPair writes the entry statuses; each new row names the row it replaces", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, mailboxId } = await createOrgWithMailbox(trx);
      const ctx = { orgId };
      const old = await insertDraftAndSend(trx, ctx, mailboxId, {});
      const created = await insertEditedPair(trx, ctx, {
        anchor: { kind: "email", emailId: old.emailId },
        oldDraftId: old.draftId,
        oldSendId: old.sendId,
        draftPayload: {},
        sendPayload: {},
      });
      expect(created).not.toBeNull();
      const entries = entriesOf("insertEditedPair");
      expect(sorted(entries.flatMap((entry) => entry.types))).toEqual(["create_draft", "send"]);
      for (const entry of entries) {
        const id = entry.types[0] === "send" ? created?.sendId : created?.draftId;
        const row = await trx
          .selectFrom("actions")
          .select(["type", "status", "supersedes_action_id"])
          .where("id", "=", id as string)
          .executeTakeFirstOrThrow();
        expect(row).toEqual({
          type: entry.types[0] as string,
          status: entry.status,
          supersedes_action_id: entry.types[0] === "send" ? old.sendId : old.draftId,
        });
      }
      // The keys make a second pair for the same rows a no-op.
      expect(
        await insertEditedPair(trx, ctx, {
          anchor: { kind: "email", emailId: old.emailId },
          oldDraftId: old.draftId,
          oldSendId: old.sendId,
          draftPayload: {},
          sendPayload: {},
        })
      ).toBeNull();
    });
  });
});
