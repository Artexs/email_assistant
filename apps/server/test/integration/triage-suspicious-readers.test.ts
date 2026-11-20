import { randomUUID } from "node:crypto";

import { MINUTE_MS, HOUR_MS, DAY_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { KyselyPlugin, Transaction } from "kysely";

import { insertMailbox } from "../../src/modules/mail/repo";
import {
  suspiciousReasonsOf,
  suspiciousSendersOf,
  suspiciousThreadKeysOf,
  suspicionOf,
} from "../../src/modules/triage";
import type { DB, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, insertTestEmail, insertTriaged, testCapabilities } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// The readers for other tickets (tests 1, 2, 3, 3a of the stage file).

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const NOW = new Date("2026-11-15T12:00:00Z");
const ago = (ms: number): Date => new Date(NOW.getTime() - ms);

async function setup(trx: Transaction<DB>) {
  const a = await createOrgWithMailbox(trx);
  const b = await createOrgWithMailbox(trx);
  return { a, b, ctxA: { orgId: a.orgId }, ctxB: { orgId: b.orgId } };
}

// A second, newer `triage_results` row of an existing mail.
async function insertRow(trx: Transaction<DB>, ctx: TenantContext, emailId: string, reasons: string[], at: Date) {
  await trx
    .insertInto("triage_results")
    .values({
      org_id: ctx.orgId,
      email_id: emailId,
      category: "info",
      confidence: 0.9,
      reason_code: "direct_request",
      fields: "{}",
      suspicious_reasons: reasons,
      created_at: at,
    })
    .execute();
}

function countingPlugin() {
  const counter = { count: 0 };
  const plugin: KyselyPlugin = {
    transformQuery(args) {
      counter.count += 1;
      return args.node;
    },
    async transformResult(args) {
      return args.result;
    },
  };
  return { counter, plugin };
}

describe("suspiciousReasonsOf", () => {
  test("reads the newest row of each mail; a mail with no reason or no row is absent", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA } = await setup(trx);
      const flagged = await insertTriaged(trx, ctxA, a.mailboxId, {
        category: "info",
        createdAt: ago(3 * HOUR_MS),
        suspiciousReasons: ["auth_fail"],
      });
      await insertRow(trx, ctxA, flagged, ["link_mismatch", "risky_attachment"], ago(2 * HOUR_MS));
      const cleaned = await insertTriaged(trx, ctxA, a.mailboxId, {
        category: "info",
        createdAt: ago(3 * HOUR_MS),
        suspiciousReasons: ["lookalike_domain"],
      });
      await insertRow(trx, ctxA, cleaned, [], ago(2 * HOUR_MS));
      const clean = await insertTriaged(trx, ctxA, a.mailboxId, { category: "info", createdAt: ago(HOUR_MS) });
      const noRow = await insertTestEmail(trx, ctxA, a.mailboxId);

      const found = await suspiciousReasonsOf(trx, ctxA, [flagged, cleaned, clean, noRow]);
      expect([...found]).toEqual([[flagged, ["link_mismatch", "risky_attachment"]]]);
    });
  });

  test("a mail of another organization is absent", async () => {
    await withRollback(db, async (trx) => {
      const { a, b, ctxA, ctxB } = await setup(trx);
      const own = await insertTriaged(trx, ctxA, a.mailboxId, {
        category: "info",
        createdAt: ago(HOUR_MS),
        suspiciousReasons: ["auth_fail"],
      });
      const foreign = await insertTriaged(trx, ctxB, b.mailboxId, {
        category: "info",
        createdAt: ago(HOUR_MS),
        suspiciousReasons: ["link_mismatch"],
      });
      expect([...(await suspiciousReasonsOf(trx, ctxA, [own, foreign]))]).toEqual([[own, ["auth_fail"]]]);
      expect([...(await suspiciousReasonsOf(trx, ctxB, [own, foreign]))]).toEqual([[foreign, ["link_mismatch"]]]);
    });
  });

  test("empty input gives an empty map and no query", async () => {
    await withRollback(db, async (trx) => {
      const { ctxA } = await setup(trx);
      const { counter, plugin } = countingPlugin();
      expect((await suspiciousReasonsOf(trx.withPlugin(plugin), ctxA, [])).size).toBe(0);
      expect(counter.count).toBe(0);
    });
  });
});

describe("suspicionOf", () => {
  test("no row is untriaged, a row with no reason is clean, a row with a reason is flagged", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA } = await setup(trx);
      const noRow = await insertTestEmail(trx, ctxA, a.mailboxId);
      const clean = await insertTriaged(trx, ctxA, a.mailboxId, { category: "info", createdAt: ago(HOUR_MS) });
      const flagged = await insertTriaged(trx, ctxA, a.mailboxId, {
        category: "info",
        createdAt: ago(HOUR_MS),
        suspiciousReasons: ["auth_fail"],
      });
      const found = await suspicionOf(trx, ctxA, [noRow, clean, flagged]);
      expect(found.get(noRow)).toEqual({ state: "untriaged" });
      expect(found.get(clean)).toEqual({ state: "clean" });
      expect(found.get(flagged)).toEqual({ state: "flagged", reasons: ["auth_fail"] });
      expect(found.size).toBe(3);
    });
  });

  test("the newest row decides: an old flagged row under a newer clean row is clean, and the other way round", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA } = await setup(trx);
      const cleaned = await insertTriaged(trx, ctxA, a.mailboxId, {
        category: "info",
        createdAt: ago(3 * HOUR_MS),
        suspiciousReasons: ["auth_fail"],
      });
      await insertRow(trx, ctxA, cleaned, [], ago(HOUR_MS));
      const flaggedLater = await insertTriaged(trx, ctxA, a.mailboxId, {
        category: "info",
        createdAt: ago(3 * HOUR_MS),
      });
      await insertRow(trx, ctxA, flaggedLater, ["link_mismatch"], ago(HOUR_MS));
      const found = await suspicionOf(trx, ctxA, [cleaned, flaggedLater]);
      expect(found.get(cleaned)).toEqual({ state: "clean" });
      expect(found.get(flaggedLater)).toEqual({ state: "flagged", reasons: ["link_mismatch"] });
    });
  });

  test("an id of another organization reads untriaged (no leak)", async () => {
    await withRollback(db, async (trx) => {
      const { b, ctxA } = await setup(trx);
      const foreign = await insertTriaged(trx, { orgId: b.orgId }, b.mailboxId, {
        category: "info",
        createdAt: ago(HOUR_MS),
        suspiciousReasons: ["auth_fail"],
      });
      expect((await suspicionOf(trx, ctxA, [foreign])).get(foreign)).toEqual({ state: "untriaged" });
    });
  });

  test("with the flag suspicious_mail off (the default) it still flags; ids go in chunks of 500; no ids, no query", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA } = await setup(trx);
      const flagged = await insertTriaged(trx, ctxA, a.mailboxId, {
        category: "info",
        createdAt: ago(HOUR_MS),
        suspiciousReasons: ["auth_fail"],
      });
      const ids = [flagged, ...Array.from({ length: 600 }, () => randomUUID())];
      const { counter, plugin } = countingPlugin();
      const found = await suspicionOf(trx.withPlugin(plugin), ctxA, ids);
      expect(found.size).toBe(601);
      expect(found.get(flagged)).toEqual({ state: "flagged", reasons: ["auth_fail"] });
      expect(found.get(ids[600] ?? "")).toEqual({ state: "untriaged" });
      expect(counter.count).toBe(2);
      counter.count = 0;
      expect((await suspicionOf(trx.withPlugin(plugin), ctxA, [])).size).toBe(0);
      expect(counter.count).toBe(0);
    });
  });
});

describe("suspiciousThreadKeysOf", () => {
  test("a thread with one flagged mail is in the set; an older flagged row under a clean newest row is not", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA } = await setup(trx);
      const mail = (threadKey: string, reasons: string[]) =>
        insertTriaged(trx, ctxA, a.mailboxId, {
          category: "info",
          createdAt: ago(3 * HOUR_MS),
          threadKey,
          suspiciousReasons: reasons,
        });
      await mail("t-flagged", []);
      await mail("t-flagged", ["link_mismatch"]);
      await mail("t-flagged", []);
      const reclassified = await mail("t-cleaned", ["auth_fail"]);
      await insertRow(trx, ctxA, reclassified, [], ago(HOUR_MS));
      await mail("t-clean", []);

      const keys = await suspiciousThreadKeysOf(trx, ctxA, a.mailboxId, [
        "t-flagged",
        "t-cleaned",
        "t-clean",
        "t-none",
      ]);
      expect([...keys]).toEqual(["t-flagged"]);
    });
  });

  test("a thread key of another mailbox of the same organization does not count", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA } = await setup(trx);
      const secondId = randomUUID();
      await insertMailbox(trx, ctxA, {
        id: secondId,
        address: `box2-${secondId}@x.test`,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: { drafts: "Drafts" },
      });
      await insertTriaged(trx, ctxA, secondId, {
        category: "info",
        createdAt: ago(HOUR_MS),
        threadKey: "same-key",
        suspiciousReasons: ["auth_fail"],
      });
      expect((await suspiciousThreadKeysOf(trx, ctxA, a.mailboxId, ["same-key"])).size).toBe(0);
      expect([...(await suspiciousThreadKeysOf(trx, ctxA, secondId, ["same-key"]))]).toEqual(["same-key"]);
    });
  });

  test("scopes by organization and mailbox; empty input runs no query", async () => {
    await withRollback(db, async (trx) => {
      const { a, b, ctxA, ctxB } = await setup(trx);
      await insertTriaged(trx, ctxB, b.mailboxId, {
        category: "info",
        createdAt: ago(HOUR_MS),
        threadKey: "shared-key",
        suspiciousReasons: ["auth_fail"],
      });
      expect((await suspiciousThreadKeysOf(trx, ctxA, a.mailboxId, ["shared-key"])).size).toBe(0);
      expect((await suspiciousThreadKeysOf(trx, ctxA, b.mailboxId, ["shared-key"])).size).toBe(0);
      expect([...(await suspiciousThreadKeysOf(trx, ctxB, b.mailboxId, ["shared-key"]))]).toEqual(["shared-key"]);

      const { counter, plugin } = countingPlugin();
      expect((await suspiciousThreadKeysOf(trx.withPlugin(plugin), ctxA, a.mailboxId, [])).size).toBe(0);
      expect(counter.count).toBe(0);
    });
  });
});

// The per-sender reader of bulk unsubscribe (tests 4 and 5 of the stage file).
describe("suspiciousSendersOf", () => {
  const SINCE = new Date(NOW.getTime() - 30 * DAY_MS);

  test("4: a sender with one flagged mail among clean ones is in the set; a clean sender and an unknown one are not", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA } = await setup(trx);
      const mail = (from: string, reasons: string[], at: Date) =>
        insertTriaged(trx, ctxA, a.mailboxId, { category: "info", createdAt: at, from, suspiciousReasons: reasons });
      await mail("A@News.test", ["lookalike_domain"], ago(2 * HOUR_MS));
      await mail("a@news.test", [], ago(1 * HOUR_MS));
      await mail("b@news.test", [], ago(1 * HOUR_MS));
      // A flagged mail older than the window does not count.
      await mail("old@news.test", ["auth_fail"], new Date(SINCE.getTime() - HOUR_MS));

      const set = await suspiciousSendersOf(
        trx,
        ctxA,
        a.mailboxId,
        ["a@news.test", "b@news.test", "old@news.test", "none@news.test"],
        SINCE
      );
      expect([...set]).toEqual(["a@news.test"]);
    });
  });

  test("4b: only the newest result of a mail counts: a flagged row under a clean newest row does not flag the sender", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA } = await setup(trx);
      const id = await insertTriaged(trx, ctxA, a.mailboxId, {
        category: "info",
        createdAt: ago(3 * HOUR_MS),
        from: "c@news.test",
        suspiciousReasons: ["auth_fail"],
      });
      await insertRow(trx, ctxA, id, [], ago(1 * HOUR_MS));
      expect((await suspiciousSendersOf(trx, ctxA, a.mailboxId, ["c@news.test"], SINCE)).size).toBe(0);
      await insertRow(trx, ctxA, id, ["auth_fail"], ago(30 * MINUTE_MS));
      expect([...(await suspiciousSendersOf(trx, ctxA, a.mailboxId, ["c@news.test"], SINCE))]).toEqual(["c@news.test"]);
    });
  });

  test("4c: the window edge: a flagged mail exactly at `since` counts, one millisecond older does not", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA } = await setup(trx);
      const flagged = (from: string, at: Date) =>
        insertTriaged(trx, ctxA, a.mailboxId, {
          category: "info",
          createdAt: at,
          from,
          suspiciousReasons: ["auth_fail"],
        });
      await flagged("edge@news.test", SINCE);
      await flagged("outside@news.test", new Date(SINCE.getTime() - 1));
      const set = await suspiciousSendersOf(trx, ctxA, a.mailboxId, ["edge@news.test", "outside@news.test"], SINCE);
      expect([...set]).toEqual(["edge@news.test"]);
    });
  });

  test("5: another organization's mail never counts, and another mailbox of the same organization does not either; empty input gives the empty set", async () => {
    await withRollback(db, async (trx) => {
      const { a, b, ctxA, ctxB } = await setup(trx);
      const secondId = randomUUID();
      await insertMailbox(trx, ctxA, {
        id: secondId,
        address: `second-${secondId}@x.test`,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: {},
      });
      await insertTriaged(trx, ctxB, b.mailboxId, {
        category: "info",
        createdAt: ago(HOUR_MS),
        from: "x@news.test",
        suspiciousReasons: ["auth_fail"],
      });
      await insertTriaged(trx, ctxA, secondId, {
        category: "info",
        createdAt: ago(HOUR_MS),
        from: "y@news.test",
        suspiciousReasons: ["auth_fail"],
      });
      const asked = ["x@news.test", "y@news.test"];
      expect((await suspiciousSendersOf(trx, ctxA, a.mailboxId, asked, SINCE)).size).toBe(0);
      expect([...(await suspiciousSendersOf(trx, ctxB, b.mailboxId, asked, SINCE))]).toEqual(["x@news.test"]);
      expect((await suspiciousSendersOf(trx, ctxA, a.mailboxId, [], SINCE)).size).toBe(0);
      // The mailbox of organization A asked in the scope of organization B: A's flagged sender stays hidden.
      await insertTriaged(trx, ctxA, a.mailboxId, {
        category: "info",
        createdAt: ago(HOUR_MS),
        from: "z@news.test",
        suspiciousReasons: ["auth_fail"],
      });
      expect((await suspiciousSendersOf(trx, ctxB, a.mailboxId, ["z@news.test"], SINCE)).size).toBe(0);
      expect([...(await suspiciousSendersOf(trx, ctxA, a.mailboxId, ["z@news.test"], SINCE))]).toEqual(["z@news.test"]);
    });
  });
});
