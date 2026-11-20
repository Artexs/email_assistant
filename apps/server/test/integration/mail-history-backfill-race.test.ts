import { DAY_MS, HOUR_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import { backfillInbox, CursorMovedError, syncMailbox, type SeedMessage, type SyncDeps } from "../../src/modules/mail";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { insertEmail, type NewEmail } from "../../src/modules/mail/repo";
import { createDb, type Db, type TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox } from "./fixtures";
import { testDb } from "./helpers";

// The "exactly once" rules of the history backfill, with two connections and committed rows: a mail is stored once (one `emails`
// row, one `email_headers` row) however many history runs, syncs and writers meet. The same tests run as the `app` role and as the
// table owner (the owner skips row-level security; the unique key and the folder lock must hold there too).
const appDb = testDb();
const ownerUrl = process.env.MIGRATOR_DATABASE_URL;
if (!ownerUrl) throw new Error("MIGRATOR_DATABASE_URL is missing: the owner role runs the race tests");
const ownerDb = createDb(ownerUrl);

afterAll(async () => {
  await Promise.all([appDb.destroy(), ownerDb.destroy()]);
});

const UID_VALIDITY = 11;
const NOW = new Date("2026-11-03T12:00:00Z");
const MAILS = 12;

const ago = (ms: number): Date => new Date(NOW.getTime() - ms);

function seed(n: number): SeedMessage {
  return {
    messageId: `<r${n}@x.test>`,
    from: `sender${n}@x.test`,
    to: ["box@x.test"],
    subject: `Mail ${n}`,
    date: NOW,
    text: `Body ${n}`,
  };
}

interface Committed extends TenantContext {
  userId: string;
  mailboxId: string;
}

// A committed mailbox whose INBOX was synced once (one mail, so the cursor is set) and holds MAILS older mails on the server.
async function withCommittedMailbox(
  conn: Db,
  run: (box: Committed, newFake: () => ReturnType<typeof createFakeMailProvider>) => Promise<void>
): Promise<void> {
  const box = await appDb.transaction().execute((trx) => createOrgWithMailbox(trx));
  try {
    const messages = Array.from({ length: MAILS }, (_, n) => ({ n: n + 2, at: ago((n + 2) * DAY_MS) }));
    const newFake = () => {
      const fake = createFakeMailProvider({ uidValidity: UID_VALIDITY });
      for (const { n, at } of messages) fake.deliver("INBOX", seed(n), { internalDate: at });
      fake.deliver("INBOX", seed(1), { internalDate: ago(HOUR_MS) });
      return fake;
    };
    // The first sync stores only the mail of the last day (r1) and sets the cursor.
    await syncMailbox(depsOf(conn, newFake()), box, box.mailboxId);
    await run(box, newFake);
  } finally {
    await appDb.deleteFrom("organizations").where("id", "=", box.orgId).execute();
    await appDb.deleteFrom("users").where("id", "=", box.userId).execute();
  }
}

function depsOf(conn: Db, provider: ReturnType<typeof createFakeMailProvider>, chunkSize?: number): SyncDeps {
  return {
    db: conn,
    provider,
    isOwnActionId: async () => false,
    now: () => NOW,
    ...(chunkSize === undefined ? {} : { chunkSize }),
  };
}

async function counts(conn: Db, mailboxId: string) {
  const emails = await conn
    .selectFrom("emails")
    .select(["id", "dedup_key", "status", "skip_reason"])
    .where("mailbox_id", "=", mailboxId)
    .execute();
  const headers = await conn
    .selectFrom("email_headers")
    .innerJoin("emails", "emails.id", "email_headers.email_id")
    .select("email_headers.email_id")
    .where("emails.mailbox_id", "=", mailboxId)
    .execute();
  return { emails, headers: headers.length, distinct: new Set(emails.map((row) => row.dedup_key)).size };
}

const since = ago(30 * DAY_MS);

// Both runs read the content of their first mail, then wait for each other: both planned the same chunk before either applies it.
function gate(parties: number) {
  let waiting = 0;
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    planned: [] as number[],
    async arrive(): Promise<void> {
      waiting += 1;
      if (waiting >= parties) release();
      await opened;
    },
  };
}

function gated(fake: ReturnType<typeof createFakeMailProvider>, barrier: ReturnType<typeof gate>) {
  let first = true;
  return Object.assign(Object.create(fake) as typeof fake, {
    fetchContent: async (folder: string, uid: number) => {
      const content = await fake.fetchContent(folder, uid);
      barrier.planned.push(uid);
      if (first) {
        first = false;
        await barrier.arrive();
      }
      return content;
    },
  });
}

for (const [role, conn] of [
  ["app", appDb],
  ["owner", ownerDb],
] as const) {
  describe(`history backfill, two connections as the ${role} role`, () => {
    test("two history runs at once store each mail once, with one header row each", async () => {
      await withCommittedMailbox(conn, async (box, newFake) => {
        const barrier = gate(2);
        const runs = await Promise.all([
          backfillInbox(depsOf(conn, gated(newFake(), barrier), 1), box, box.mailboxId, { since, purpose: "history" }),
          backfillInbox(depsOf(conn, gated(newFake(), barrier), 1), box, box.mailboxId, { since, purpose: "history" }),
        ]);
        // Both runs planned the first mail (the same UID), so the insert of one met the row of the other.
        expect(barrier.planned.filter((uid) => uid === barrier.planned[0]).length).toBeGreaterThanOrEqual(2);
        for (const run of runs) expect(run.kind).toBe("done");
        const stored = runs.reduce((sum, run) => sum + (run.kind === "done" ? run.result.stored : 0), 0);
        const after = await counts(conn, box.mailboxId);
        // r1 came from the first sync; the MAILS older mails are history rows.
        expect(stored).toBe(MAILS);
        expect(after.emails).toHaveLength(MAILS + 1);
        expect(after.distinct).toBe(MAILS + 1);
        expect(after.headers).toBe(MAILS + 1);
        expect(after.emails.filter((row) => row.skip_reason === "history_check")).toHaveLength(MAILS);
      });
    });

    test("a history run and a regular sync read one shared server: live mail above the cursor ends pending, whatever order they take", async () => {
      await withCommittedMailbox(conn, async (box, newFake) => {
        // One server for both runs: the live mail (UID above the cursor) is visible to the history run too.
        const server = newFake();
        server.deliver("INBOX", seed(100), { internalDate: ago(1_000) });
        const settled = await Promise.allSettled([
          backfillInbox(depsOf(conn, server, 1), box, box.mailboxId, { since, purpose: "history" }),
          syncMailbox(depsOf(conn, server), box, box.mailboxId),
        ]);
        for (const result of settled) {
          // The only error that may come is the soft one: the other run moved the cursor in the window between plan and apply.
          if (result.status === "rejected") expect(result.reason).toBeInstanceOf(CursorMovedError);
        }
        // A run that lost the race is repeated, as the job does; the order of the repeats does not matter either.
        await backfillInbox(depsOf(conn, server, 1), box, box.mailboxId, { since, purpose: "history" });
        await syncMailbox(depsOf(conn, server), box, box.mailboxId);
        const after = await counts(conn, box.mailboxId);
        expect(after.distinct).toBe(after.emails.length);
        expect(after.headers).toBe(after.emails.length);
        expect(after.emails.filter((row) => row.skip_reason === "history_check")).toHaveLength(MAILS);
        const live = after.emails.filter((row) => row.dedup_key.includes("<r100@x.test>"));
        expect(live).toHaveLength(1);
        expect(live[0]).toMatchObject({ status: "pending", skip_reason: null });
      });
    });

    test("a history run after the sync, and a sync after the history run, both leave live mail pending", async () => {
      for (const order of ["history first", "sync first"] as const) {
        await withCommittedMailbox(conn, async (box, newFake) => {
          const server = newFake();
          server.deliver("INBOX", seed(100), { internalDate: ago(1_000) });
          const history = () =>
            backfillInbox(depsOf(conn, server, 1), box, box.mailboxId, { since, purpose: "history" });
          const sync = () => syncMailbox(depsOf(conn, server), box, box.mailboxId);
          if (order === "history first") {
            await history();
            await sync();
          } else {
            await sync();
            await history();
          }
          const after = await counts(conn, box.mailboxId);
          const live = after.emails.filter((row) => row.dedup_key.includes("<r100@x.test>"));
          expect(live).toHaveLength(1);
          expect(live[0]).toMatchObject({ status: "pending", skip_reason: null });
          expect(after.emails.filter((row) => row.skip_reason === "history_check")).toHaveLength(MAILS);
        });
      }
    });

    test("a mail that an operator backfill stores between the plan and the apply of a history run keeps its status", async () => {
      await withCommittedMailbox(conn, async (box, newFake) => {
        const history = newFake();
        let first = true;
        const racing = Object.assign(Object.create(history) as typeof history, {
          fetchContent: async (folder: string, uid: number) => {
            const content = await history.fetchContent(folder, uid);
            if (first) {
              first = false;
              // The operator run stores every mail of the window as `pending` while the history run holds its plan of the first chunk.
              await backfillInbox(depsOf(conn, newFake(), 50), box, box.mailboxId, { since });
            }
            return content;
          },
        });
        const outcome = await backfillInbox(depsOf(conn, racing, 1), box, box.mailboxId, { since, purpose: "history" });
        expect(outcome.kind).toBe("done");
        const after = await counts(conn, box.mailboxId);
        expect(after.emails).toHaveLength(MAILS + 1);
        expect(after.distinct).toBe(MAILS + 1);
        expect(after.emails.filter((row) => row.skip_reason === "history_check")).toHaveLength(0);
        expect(after.emails.filter((row) => row.status === "pending")).toHaveLength(MAILS + 1);
      });
    });

    test("eight writers of one dedup key store one row", async () => {
      await withCommittedMailbox(conn, async (box) => {
        const row: NewEmail & { status: "skipped" } = {
          mailbox_id: box.mailboxId,
          dedup_key: "race:one",
          message_id_header: "<race-one@x.test>",
          content_hash: "h",
          uid: 500,
          folder: "INBOX",
          source_folder: "INBOX",
          thread_key: "race:one",
          in_reply_to: null,
          references_header: null,
          from_address: "a@x.test",
          to_addresses: [],
          cc_addresses: [],
          subject: null,
          received_at: ago(DAY_MS),
          body_text: null,
          status: "skipped",
          skip_reason: "history_check",
        };
        const stored = await Promise.all(Array.from({ length: 8 }, () => insertEmail(conn, box, row)));
        expect(stored.filter(Boolean)).toHaveLength(1);
        const rows = await conn
          .selectFrom("emails")
          .select("id")
          .where("mailbox_id", "=", box.mailboxId)
          .where("dedup_key", "=", "race:one")
          .execute();
        expect(rows).toHaveLength(1);
      });
    });
  });
}
