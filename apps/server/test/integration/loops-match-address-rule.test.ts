import { afterAll, describe, expect, test } from "bun:test";

import { matchReplies } from "../../src/modules/loops";

import { testDb, withRollback } from "./helpers";
import { sentMail } from "./loops-analyze-fixtures";
import { loopRow, loopsOrg, reply, RUN_AT, waiting } from "./loops-match-fixtures";

// The close rules compare addresses with the one address rule (`normalizeAddress`): recipients, own addresses and aliases.
// Greek names show the final sigma (`ς` typed, `σ` after the database lowers a capital); the Turkish dotted capital I shows
// the combining dot.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const NIKOS_FINAL = "νίκος@example.gr";
const NIKOS_CAPITAL = "ΝΊΚΟΣ@example.gr";
const run = (trx: Parameters<Parameters<typeof withRollback>[1]>[0], org: Awaited<ReturnType<typeof loopsOrg>>) =>
  matchReplies({ db: trx }, org.ctx, org.mailboxId, { now: RUN_AT });

describe("a reply closes a loop by the one address rule", () => {
  test("03-T2: a recipient in capitals finds a mail whose stored lower form keeps the final sigma", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const loop = await waiting(trx, org, {
        to_addresses: [NIKOS_CAPITAL],
        cc_addresses: [],
        counterpart: NIKOS_FINAL,
      });
      await reply(trx, org, { from: NIKOS_FINAL });
      expect((await run(trx, org)).repliedSubject).toBe(1);
      expect((await loopRow(trx, loop.id)).status).toBe("closed");
    });
  });

  test("03-T3: a reply from the capital form (the database lowers it to a plain sigma) closes a loop to the final-sigma form", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const loop = await waiting(trx, org, { to_addresses: [NIKOS_FINAL], cc_addresses: [], counterpart: NIKOS_FINAL });
      await reply(trx, org, { from: NIKOS_CAPITAL });
      expect((await run(trx, org)).repliedSubject).toBe(1);
      expect((await loopRow(trx, loop.id)).status).toBe("closed");
    });
  });

  test("03-T4: a mailbox address and an alias are own by the same rule", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      await trx
        .updateTable("mailboxes")
        .set({ address: "İlker@Example.com" })
        .where("id", "=", org.mailboxId)
        .execute();
      await sentMail(trx, org, { fromAddress: NIKOS_CAPITAL });
      const byMailbox = await waiting(trx, org);
      const byAlias = await waiting(trx, org);
      await reply(trx, org, { from: "ilker@example.com", threadKey: byMailbox.threadKey, subject: "Anything" });
      await reply(trx, org, { from: NIKOS_FINAL, threadKey: byAlias.threadKey, subject: "Anything" });
      const out = await run(trx, org);
      expect(out.replied + out.repliedSubject).toBe(0);
      expect((await loopRow(trx, byMailbox.id)).status).toBe("open");
      expect((await loopRow(trx, byAlias.id)).status).toBe("open");
    });
  });

  test("03-T5: a loop person who is also an alias (another spelling) is a stranger: their reply closes the loop", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      await sentMail(trx, org, { fromAddress: NIKOS_CAPITAL });
      const loop = await waiting(trx, org, { to_addresses: [NIKOS_FINAL], cc_addresses: [], counterpart: NIKOS_FINAL });
      await reply(trx, org, { from: NIKOS_FINAL });
      expect((await run(trx, org)).repliedSubject).toBe(1);
      expect((await loopRow(trx, loop.id)).status).toBe("closed");
    });
  });

  test("03-T5b: the same, when the Sent row holds the typed final-sigma form (the alias read must give the rule form)", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      await sentMail(trx, org, { fromAddress: NIKOS_FINAL });
      const loop = await waiting(trx, org, { to_addresses: [NIKOS_FINAL], cc_addresses: [], counterpart: NIKOS_FINAL });
      await reply(trx, org, { from: NIKOS_FINAL });
      expect((await run(trx, org)).repliedSubject).toBe(1);
      expect((await loopRow(trx, loop.id)).status).toBe("closed");
    });
  });

  test("03-T6: a mail of another organization from the same address leaves the loop open", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const other = await loopsOrg(trx);
      const loop = await waiting(trx, org, { to_addresses: [NIKOS_FINAL], cc_addresses: [], counterpart: NIKOS_FINAL });
      await reply(trx, other, { from: NIKOS_FINAL });
      const out = await run(trx, org);
      expect(out.replied + out.repliedSubject).toBe(0);
      expect((await loopRow(trx, loop.id)).status).toBe("open");
    });
  });
});
