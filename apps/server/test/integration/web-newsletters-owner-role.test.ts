import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";

import { configureFeatures } from "../../src/modules/tenancy";
import { createDb } from "../../src/platform/db";

import { as } from "./web-helpers";
import { addRequest, addSenderMail, LINK, newsletterBox, type NewsletterBox } from "./web-newsletters-kit";

// The `org_id` filters of the newsletters route, as the table owner: the owner skips row-level security, so only the code keeps a
// mailbox, a mail or a request of another organization out (F110 stage 23). Committed rows.
const ownerUrl = process.env.MIGRATOR_DATABASE_URL;
if (!ownerUrl) throw new Error("MIGRATOR_DATABASE_URL is missing: the owner role runs these tests");
const db = createDb(ownerUrl);
let box: NewsletterBox;

beforeEach(async () => {
  configureFeatures({ off: [] });
  box = await newsletterBox(db);
  await addSenderMail(db, box.org.otherOrgId, box.otherMailboxId, { from: "o@c.example", link: LINK });
  await addRequest(db, box.org.otherOrgId, box.otherMailboxId, "o@c.example", { status: "done" });
});
afterEach(async () => {
  await box.cleanup();
});
afterAll(async () => {
  await db.destroy();
});

describe("the newsletters route as the table owner", () => {
  test("a mailbox of another organization is the same 404 as an unknown id, never a 200 with the rows of the other organization", async () => {
    const answers = [];
    for (const id of [box.otherMailboxId, "00000000-0000-4000-8000-000000000000"]) {
      for (const cookie of ["owner", "member"]) {
        const res = await box.app().request(`/api/newsletters/${id}`, as(cookie));
        answers.push([res.status, await res.json()]);
      }
    }
    expect(answers).toEqual(Array(4).fill([404, { error: "not_found" }]));
  });

  test("the own list holds the own senders only", async () => {
    await addSenderMail(db, box.org.orgId, box.mailboxId, { from: "n@c.example", link: LINK });
    const res = await box.app().request(`/api/newsletters/${box.mailboxId}`, as("owner"));
    const body = (await res.json()) as { senders: { senderLower: string }[] };
    expect(res.status).toBe(200);
    expect(body.senders.map((s) => s.senderLower)).toEqual(["n@c.example"]);
  });
});
