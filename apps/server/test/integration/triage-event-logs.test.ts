import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import { insertDefaultSettings } from "../../src/modules/config";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import {
  createLlmPause,
  createReturnedJob,
  createTriageJob,
  triageOne,
  noGateEvidence,
} from "../../src/modules/triage";
import type { DB } from "../../src/platform/db";
import type { GenerateFn } from "../../src/platform/llm";
import { createFixedLlmClient } from "../../src/platform/llm/testing";
import { setLogLevel } from "../../src/platform/log";

import { createOrgWithMailbox, insertTestEmail, pauseOtherMailboxes } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// The triage events that the other triage log tests do not pin. Each test reads the unfiltered capture
// of console.log and console.error (text format) and checks the whole text: event name, level, fields, no free text,
// no dropped field.

const db = testDb();
const now = new Date("2026-11-05T12:00:00.000Z");
const DAY = 24 * 3_600_000;
const MARKER = "MARKER-ERR-TEXT";

afterAll(async () => {
  await db.destroy();
});

let out: string[] = [];
let err: string[] = [];
let spies: { mockRestore(): void }[] = [];

beforeEach(() => {
  out = [];
  err = [];
  setLogLevel("debug");
  spies = [
    spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      out.push(args.map(String).join(" "));
    }),
    spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      err.push(args.map(String).join(" "));
    }),
  ];
});

afterEach(() => {
  for (const spy of spies) spy.mockRestore();
  setLogLevel("info");
});

// The `[triage]` lines of one stream: levels debug and info go to console.log, warn and error to console.error.
const triageLines = (stream: string[]): string[] => stream.filter((line) => line.startsWith("[triage] "));

// The whole capture: every triage line is an event name and key=value pairs, nothing is dropped, no marker leaks.
function expectCleanCapture(): void {
  const all = [...out, ...err].join("\n");
  expect(all).not.toContain("dropped_fields");
  expect(all).not.toContain(MARKER);
  for (const line of triageLines([...out, ...err])) {
    expect(line).toMatch(/^\[triage\] [a-z][a-z0-9_]*( [a-z_]+=\S+)*$/);
  }
}

const infoAnswer = {
  category: "info",
  confidence: 0.9,
  reason_code: "newsletter",
  reason: "a newsletter",
  summary: "short summary",
  fields: { due_date: null, language: "pl", delegate_id: null, task: null, clarification: null },
};

const generate: GenerateFn = () =>
  Promise.resolve({ text: JSON.stringify(infoAnswer), tokensIn: 10, tokensOut: 5, blocked: false });

function llm() {
  return createFixedLlmClient(generate, {
    model: "fake-model",
    apiKey: "k",
    timeoutMs: 1000,
    rpm: 1000,
    sleep: async () => undefined,
  });
}

function jobOver(
  trx: Transaction<DB> | object,
  extra: Partial<Parameters<typeof createTriageJob>[0]> = {}
): ReturnType<typeof createTriageJob> {
  return createTriageJob({
    runningKey: noGateEvidence.runningKey,
    db: trx as Transaction<DB>,
    llm: llm(),
    pause: createLlmPause(),
    scope: { kind: "all" },
    batchSize: 5,
    testMail: NO_TEST_SENDERS,
    dailyCap: 1000,
    junkDailyCap: 1000,
    now: () => now,
    ...extra,
  });
}

async function mailboxWithMail(trx: Transaction<DB>, mail: Parameters<typeof insertTestEmail>[3] = {}) {
  await pauseOtherMailboxes(trx);
  const box = await createOrgWithMailbox(trx, { address: `box-${crypto.randomUUID()}@x.test` });
  const ctx = { orgId: box.orgId };
  await insertDefaultSettings(trx, ctx, box.mailboxId);
  const emailId = await insertTestEmail(trx, ctx, box.mailboxId, {
    message_id_header: `<${crypto.randomUUID()}@ea-seed.test>`,
    ...mail,
  });
  return { ...box, ctx, emailId };
}

// A db wrapper that sees each call of `selectFrom` / `updateTable` and may throw or replace the query.
function wrapped(
  trx: Transaction<DB>,
  method: "selectFrom" | "updateTable",
  hook: (table: string, run: () => object) => object
): object {
  return new Proxy(trx, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      if (prop === method) {
        return (table: string) => hook(table, () => (value as (t: string) => object).call(target, table));
      }
      return value.bind(target);
    },
  });
}

describe("triage events: job", () => {
  test("triage_no_organization: one warn line over two runs, with the two ids", async () => {
    await withRollback(db, async (trx) => {
      const box = await mailboxWithMail(trx);
      // Only `getOrganization` (selectAll) sees no row; the suspend check reads the row as before.
      const noOrganization = wrapped(trx, "selectFrom", (table, run) => {
        const query = run();
        if (table !== "organizations") return query;
        return new Proxy(query, {
          get(inner, name) {
            if (name === "selectAll") return () => ({ where: () => ({ executeTakeFirst: async () => undefined }) });
            const member: unknown = Reflect.get(inner, name, inner);
            return typeof member === "function" ? member.bind(inner) : member;
          },
        });
      });
      const job = jobOver(noOrganization);
      await job.run();
      await job.run();

      expect(triageLines(err)).toEqual([
        `[triage] triage_no_organization org_id=${box.orgId} mailbox_id=${box.mailboxId}`,
      ]);
      expectCleanCapture();
    });
  });

  test("triage_delegates: one debug line with the count", async () => {
    await withRollback(db, async (trx) => {
      const box = await mailboxWithMail(trx);
      await jobOver(trx).run();

      expect(triageLines(out).filter((line) => line.includes("triage_delegates"))).toEqual([
        `[triage] triage_delegates org_id=${box.orgId} mailbox_id=${box.mailboxId} count=0`,
      ]);
      expectCleanCapture();
    });
  });

  test("triage_failed: an error before the mailbox loop writes one error line with the error name only", async () => {
    await withRollback(db, async (trx) => {
      await mailboxWithMail(trx);
      const failing = wrapped(trx, "selectFrom", () => {
        throw new Error(MARKER);
      });
      await jobOver(failing).run();

      expect(triageLines(err)).toEqual(["[triage] triage_failed error=Error"]);
      expectCleanCapture();
    });
  });

  test("triage_release_failed: both release sites write the line with the two ids and the error name", async () => {
    await withRollback(db, async (trx) => {
      const box = await mailboxWithMail(trx);
      await insertTestEmail(trx, box.ctx, box.mailboxId, { message_id_header: "<two@ea-seed.test>" });
      await insertTestEmail(trx, box.ctx, box.mailboxId, { message_id_header: "<three@ea-seed.test>" });
      // After the arm every `updateTable` throws: the release of the failed mail (recoverFromError) and the release
      // of the two untried mails (releaseUntried) both fail.
      let armed = false;
      const failingUpdates = wrapped(trx, "updateTable", (_table, run) => {
        if (armed) throw new Error(MARKER);
        return run();
      });
      await jobOver(failingUpdates, {
        triageOne: async () => {
          armed = true;
          throw new Error(MARKER);
        },
      }).run();

      const release = `[triage] triage_release_failed org_id=${box.orgId} mailbox_id=${box.mailboxId} error=Error`;
      expect(triageLines(err)).toEqual([
        release,
        release,
        release,
        `[triage] triage_mailbox_failed org_id=${box.orgId} mailbox_id=${box.mailboxId} error=Error`,
      ]);
      expectCleanCapture();
    });
  });
});

describe("triage events: service", () => {
  // The wrapper changes the row, then runs the real `triageOne`: the save sees a lost claim or changed settings.
  const losingClaim =
    (trx: Transaction<DB>): NonNullable<Parameters<typeof createTriageJob>[0]["triageOne"]> =>
    async (deps, ctx, mailbox, email) => {
      await trx
        .updateTable("emails")
        .set({ locked_at: new Date(now.getTime() + 60_000) })
        .where("id", "=", email.id)
        .execute();
      return triageOne(deps, ctx, mailbox, email);
    };

  test("triage_claim_lost: the save of a triaged mail writes one warn line", async () => {
    await withRollback(db, async (trx) => {
      const box = await mailboxWithMail(trx);
      await jobOver(trx, { triageOne: losingClaim(trx) }).run();
      expect(triageLines(err)).toEqual([
        `[triage] triage_claim_lost org_id=${box.orgId} mailbox_id=${box.mailboxId} email_id=${box.emailId}`,
      ]);
      expectCleanCapture();
    });
  });

  test("triage_claim_lost: the skip of a mail older than 7 days writes one warn line", async () => {
    await withRollback(db, async (trx) => {
      const box = await mailboxWithMail(trx, { received_at: new Date(now.getTime() - 8 * DAY) });
      await jobOver(trx, { triageOne: losingClaim(trx) }).run();
      expect(triageLines(err)).toEqual([
        `[triage] triage_claim_lost org_id=${box.orgId} mailbox_id=${box.mailboxId} email_id=${box.emailId}`,
      ]);
      expectCleanCapture();
    });
  });

  test("triage_released_settings_changed: one debug line with the three ids", async () => {
    await withRollback(db, async (trx) => {
      const box = await mailboxWithMail(trx);
      await jobOver(trx, {
        triageOne: async (deps, ctx, mailbox, email) => {
          await trx
            .updateTable("mailbox_settings")
            .set({ updated_at: new Date(now.getTime() + 60_000) })
            .where("mailbox_id", "=", mailbox.id)
            .execute();
          return triageOne(deps, ctx, mailbox, email);
        },
      }).run();

      expect(triageLines(out).filter((line) => line.includes("triage_released_settings_changed"))).toEqual([
        `[triage] triage_released_settings_changed org_id=${box.orgId} mailbox_id=${box.mailboxId} email_id=${box.emailId}`,
      ]);
      expectCleanCapture();
    });
  });
});

describe("triage events: levels", () => {
  test("triage_delegates and triage_released_settings_changed are debug: no line at level info", async () => {
    await withRollback(db, async (trx) => {
      setLogLevel("info");
      await mailboxWithMail(trx);
      await jobOver(trx, {
        triageOne: async (deps, ctx, mailbox, email) => {
          await trx
            .updateTable("mailbox_settings")
            .set({ updated_at: new Date(now.getTime() + 60_000) })
            .where("mailbox_id", "=", mailbox.id)
            .execute();
          return triageOne(deps, ctx, mailbox, email);
        },
      }).run();

      expect(triageLines([...out, ...err])).toEqual([]);
    });
  });
});

describe("triage events: returned job", () => {
  test("returned_mailbox_failed: a failed read writes one error line with the mailbox id and the error name", async () => {
    await withRollback(db, async (trx) => {
      const box = await mailboxWithMail(trx);
      // The first `selectFrom` is the target list; the second is the read of the returned rows of the mailbox.
      let reads = 0;
      const failingRead = wrapped(trx, "selectFrom", (_table, run) => {
        reads += 1;
        if (reads === 2) throw new Error(MARKER);
        return run();
      });
      await createReturnedJob({ db: failingRead as Transaction<DB>, now: () => now }).run();

      expect(triageLines(err)).toEqual([`[triage] returned_mailbox_failed mailbox_id=${box.mailboxId} error=Error`]);
      expect(triageLines(out).filter((line) => line.includes("returned_done"))).toEqual([]);
      expectCleanCapture();
    });
  });
});
