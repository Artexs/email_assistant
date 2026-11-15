import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";

import { sentSwitchHooks } from "../../src/composition";
import { setSentSync } from "../../src/modules/mail";
import { captureLogs, logProblems } from "../log-capture";

import { testDb, withRollback } from "./helpers";
import { chase, DUE_YESTERDAY, NOW, setAutoFollowUp } from "./loops-chaser-fixtures";
import { commandLoop, commandOrg } from "./loops-commands-fixtures";
import { tablesHolding } from "./loops-scan-fixtures";

// F116 stage 15 (the stage 14 N1 owner decision): "Track my sent mail" off removes every copy of the Sent mail. The chaser makes
// new copies: the follow-up pair that it plans (quote, To, Cc, subject in `actions.payload`) and, later, its cards. This test
// runs the real planner, scans every table and every log line for planted values, then switches off and scans again. A new
// place that the chaser copies a value to (an audit row, a log line, a column) fails the first scan or the second.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("the Sent switch off reaches every copy that the chaser makes", () => {
  test("a follow-up planned by the chaser: the payload copies go; no audit row or log line holds a Sent value", async () => {
    await withRollback(db, async (trx) => {
      const id = randomUUID().slice(0, 8);
      const m = {
        body: `BODY-${id}`,
        to: `to-${id}@sent.example.test`,
        cc: `cc-${id}@sent.example.test`,
        subject: `SUBJECT-${id}`,
      };
      const org = await commandOrg(trx);
      await setAutoFollowUp(trx, org, true);
      const loop = await commandLoop(trx, org, {
        due_at: DUE_YESTERDAY,
        subject: m.subject,
        to_addresses: [m.to],
        cc_addresses: [m.cc],
        counterpart: m.to,
        text: `ASK-${id}`,
      });
      await trx
        .updateTable("sent_emails")
        .set({ body_text: m.body, subject: m.subject })
        .where("id", "=", loop.sentId)
        .execute();
      const planted = [...Object.values(m), `ASK-${id}`];

      const logs = captureLogs({ level: "debug" });
      try {
        expect((await chase(trx, org, NOW)).followUps).toBe(1);
        // Before the switch: the planted values are in the places that we know.
        expect(await tablesHolding(trx, [m.body, m.to, m.cc, m.subject])).toEqual([
          "actions",
          "open_loops",
          "sent_emails",
        ]);
        await setSentSync(trx, org.ctx, org.mailboxId, { enabled: false, actor: "test", at: NOW }, sentSwitchHooks);
      } finally {
        logs.stop();
      }
      expect(logProblems(logs.lines, planted)).toEqual([]);
      // After the switch: no table holds a Sent value, the audit rows of the run and of the close included.
      expect(await tablesHolding(trx, planted)).toEqual([]);
      const send = await trx
        .selectFrom("actions")
        .select(["status", "status_reason"])
        .where("loop_id", "=", loop.id)
        .where("type", "=", "send")
        .executeTakeFirstOrThrow();
      expect(send).toEqual({ status: "expired", status_reason: "loop_closed" });
    });
  });
});
