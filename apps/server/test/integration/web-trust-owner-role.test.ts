import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";

import { settingsDeps } from "../../src/composition";
import { getSettingsView } from "../../src/modules/config";
import { listMailExamples } from "../../src/modules/mail";
import { configureFeatures } from "../../src/modules/tenancy";
import { activeTripsOf, historyResultFor, latestHistoryCheck, newestDoneCheck } from "../../src/modules/trust";
import { countItems, listMovedExampleIds } from "../../src/modules/trust/history-items";
import { createDb } from "../../src/platform/db";

import { as } from "./web-helpers";
import {
  addDoneCheck,
  addExample,
  addTrip,
  auditOf,
  newId,
  policyOf,
  trustWebBox,
  type TrustWebBox,
} from "./web-trust-kit";

// The `org_id` filters of the trust routes and readers, as the table owner: the owner skips row-level security, so only the code
// keeps a mailbox, a check, an item or a trip of another organization out. Committed rows.
const ownerUrl = process.env.MIGRATOR_DATABASE_URL;
if (!ownerUrl) throw new Error("MIGRATOR_DATABASE_URL is missing: the owner role runs these tests");
const db = createDb(ownerUrl);
let box: TrustWebBox;
let otherCheck: string;
let otherMail: string;

beforeEach(async () => {
  configureFeatures({ off: [] });
  box = await trustWebBox(db);
  // The other organization has a done check, an acted-on item, a trip and a mailbox that is ready for a tap.
  otherCheck = await addDoneCheck(db, box.org.otherOrgId, box.otherMailboxId, {
    info: "pass",
    notification: "pass",
    spam: "pass",
  });
  otherMail = await addExample(db, box.org.otherOrgId, box.otherMailboxId, otherCheck, {
    receivedAt: "2026-11-09T10:00:00Z",
    fromName: "Other Sender",
    subject: "Other subject",
  });
  await addTrip(db, box.org.otherOrgId, box.otherMailboxId, "spam");
});
afterEach(async () => {
  await box.cleanup();
});
afterAll(async () => {
  await db.destroy();
});

const ours = () => ({ orgId: box.org.orgId });

describe("the trust routes as the table owner", () => {
  test("a mailbox of another organization is the same 404 as an unknown id, on all three routes; nothing is written for it", async () => {
    const before = { settings: await policyOf(db, box.otherMailboxId), audit: await auditOf(db, box.org.otherOrgId) };
    const checksBefore = await db
      .selectFrom("history_checks")
      .select("id")
      .where("mailbox_id", "=", box.otherMailboxId)
      .execute();
    const answers = [];
    for (const id of [box.otherMailboxId, newId()]) {
      for (const [method, path] of [
        ["GET", ""],
        ["POST", "/recommended"],
        ["POST", "/history-check"],
      ] as const) {
        const res = await box.app().request(`/api/trust/${id}${path}`, as("owner", { method }));
        answers.push([res.status, await res.json()]);
      }
    }
    expect(answers).toEqual(Array(6).fill([404, { error: "not_found" }]));
    expect({ settings: await policyOf(db, box.otherMailboxId), audit: await auditOf(db, box.org.otherOrgId) }).toEqual(
      before
    );
    expect(
      await db.selectFrom("history_checks").select("id").where("mailbox_id", "=", box.otherMailboxId).execute()
    ).toEqual(checksBefore);
  });

  test("the readers of the view return nothing of another organization", async () => {
    const mine = ours();
    expect(await latestHistoryCheck(db, mine, box.otherMailboxId)).toBeNull();
    expect(await newestDoneCheck(db, mine, box.otherMailboxId)).toBeNull();
    expect(await historyResultFor(db, mine, box.otherMailboxId)).toEqual({
      info: null,
      notification: null,
      spam: null,
    });
    expect((await activeTripsOf(db, mine, box.otherMailboxId)).size).toBe(0);
    expect(await countItems(db, mine, otherCheck)).toBe(0);
    expect(await listMovedExampleIds(db, mine, otherCheck, "info")).toEqual([]);
    expect((await listMailExamples(db, mine, [otherMail])).size).toBe(0);
    // The same readers do see the rows with the right organization: the filters are the only difference.
    const theirs = { orgId: box.org.otherOrgId };
    expect(await countItems(db, theirs, otherCheck)).toBe(1);
    expect(await listMovedExampleIds(db, theirs, otherCheck, "info")).toEqual([otherMail]);
    expect((await listMailExamples(db, theirs, [otherMail])).get(otherMail)?.subject).toBe("Other subject");
    await expect(
      getSettingsView(
        settingsDeps(db, () => new Date()),
        mine,
        box.otherMailboxId
      )
    ).rejects.toThrow();
  });
});
