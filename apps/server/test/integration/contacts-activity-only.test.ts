import { afterAll, describe, expect, test } from "bun:test";

import { readSenderActivity } from "../../src/modules/contacts";

import { ago, mails, newOrg, NO_TEST, NOW, seed, spamMails, type Org, type Trx } from "./contacts-fixtures";
import { testDb, withRollback } from "./helpers";

// The `only` option of `readSenderActivity`: the re-check of Accept reads one address or one domain, not the mailbox.
const db = testDb();
afterAll(async () => {
  await db.destroy();
});

const ADDRESSES = ["a@acme.pl", "b@mail.acme.pl", "c@evil-acme.pl", "d@acme.pl.evil.test", "e@foo.co.uk"];

async function seeded(trx: Trx): Promise<Org> {
  const org = await newOrg(trx);
  for (const address of ADDRESSES) await seed(trx, org, address, [...mails(6, 5), ...spamMails()]);
  return org;
}

const read = (trx: Trx, org: Org, only?: { address: string } | { domain: string }) =>
  readSenderActivity(trx, org.ctx, org.mailboxId, {
    now: NOW,
    testMail: NO_TEST,
    ...(only === undefined ? {} : { only }),
  });

describe("readSenderActivity with `only`", () => {
  test("1 an address scope returns that address with its counts; the whole mailbox read returns every address", async () => {
    await withRollback(db, async (trx) => {
      const org = await seeded(trx);
      expect((await read(trx, org)).map((item) => item.address).sort()).toEqual([...ADDRESSES].sort());
      const [only, ...rest] = await read(trx, org, { address: "a@acme.pl" });
      expect(rest).toEqual([]);
      expect(only).toMatchObject({ address: "a@acme.pl", received: 8, correctedToSpam90: 2 });
    });
  });

  test("2 a domain scope returns the domain and its subdomains, never a look-alike or a longer host", async () => {
    await withRollback(db, async (trx) => {
      const org = await seeded(trx);
      expect((await read(trx, org, { domain: "acme.pl" })).map((item) => item.address)).toEqual([
        "a@acme.pl",
        "b@mail.acme.pl",
      ]);
    });
  });

  test("3 the registrable domain decides: a public suffix as scope returns nothing, though its hosts end with it", async () => {
    await withRollback(db, async (trx) => {
      const org = await seeded(trx);
      expect(await read(trx, org, { domain: "co.uk" })).toEqual([]);
      expect((await read(trx, org, { domain: "foo.co.uk" })).map((item) => item.address)).toEqual(["e@foo.co.uk"]);
    });
  });

  test("4 a Sent mail to the address counts in the scope; one to a neighbour does not", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await seed(trx, org, "a@acme.pl", [], [{ at: ago(2), to: ["a@acme.pl", "x@other.test"] }]);
      await seed(trx, org, "b@acme.pl", [], [{ at: ago(2), to: ["b@acme.pl"] }]);
      const [item, ...rest] = await read(trx, org, { address: "a@acme.pl" });
      expect(rest).toEqual([]);
      expect(item).toMatchObject({ address: "a@acme.pl", userMailsTo: 1 });
    });
  });
});
