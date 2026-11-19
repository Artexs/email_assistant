import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";

import { senderProfileReader } from "../../src/composition";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { setOrgFeature } from "../../src/modules/tenancy";
import { loadClassifierExtras } from "../../src/modules/triage";
import { classifierVersions } from "../../src/modules/triage/prompts";
import type { Db, TenantContext } from "../../src/platform/db";

import { ago, KEY, newOrg, NOW, refresh, type Org, type Trx } from "./contacts-fixtures";
import { seedSenderActivity } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// The profile reader of `classifier-v4` (part `profile`) in `loadClassifierExtras`. Each test fails when its guard is removed.
const db = testDb();
afterAll(async () => {
  await db.destroy();
});

const ANNA = "anna@acme.pl";
type Reader = NonNullable<Parameters<typeof loadClassifierExtras>[2]["readProfile"]>;

// Eight mails of Anna, six answered, three Sent mails to her; the pass has run.
async function seeded(trx: Trx, opts: { flag?: boolean } = {}): Promise<Org> {
  const org = await newOrg(trx);
  await seedSenderActivity(trx, org.ctx, org.mailboxId, {
    address: ANNA,
    mails: Array.from({ length: 8 }, (_, index) => ({
      at: ago(2 + index),
      category: "info" as const,
      answered: index < 6,
    })),
    sent: [1, 2, 3].map((day) => ({ at: ago(20 + day), to: [ANNA] })),
  });
  await refresh(trx, org);
  if (opts.flag === false) {
    await setOrgFeature(trx, org.ctx, { flag: "sender_context", enabled: false, actor: "cli", now: NOW });
  }
  return org;
}

const email = (from: string | null) => ({
  id: randomUUID(),
  from_address: from,
  received_at: NOW,
  message_id_header: `<${randomUUID()}@x.test>`,
});

function load(
  trx: Trx,
  ctx: TenantContext,
  mailboxId: string,
  input: { parts: ("profile" | "history" | "list")[]; from?: string | null; suspicious?: string[]; reader: Reader }
) {
  return loadClassifierExtras(trx, ctx, {
    mailbox: { id: mailboxId, urgencyProfile: null },
    email: email(input.from === undefined ? ANNA : input.from),
    parts: input.parts,
    timezone: "Europe/Warsaw",
    testMail: NO_TEST_SENDERS,
    suspicious: input.suspicious ?? [],
    readProfile: input.reader,
  });
}

const readerOf = (trx: Trx) => senderProfileReader({ db: trx as unknown as Db, credentialsKey: KEY, now: () => NOW });
const spy = (reader: Reader): { reader: Reader; calls: () => number } => {
  let count = 0;
  return {
    reader: (...args) => {
      count += 1;
      return reader(...args);
    },
    calls: () => count,
  };
};

describe("loadClassifierExtras reads the profile for the part profile", () => {
  test("6a. a stored profile gives senderProfile; the v4 prompt shows it and no address", async () => {
    await withRollback(db, async (trx) => {
      const org = await seeded(trx);
      const extras = await load(trx, org.ctx, org.mailboxId, { parts: ["profile"], reader: readerOf(trx) });
      expect(extras.senderProfile).toMatchObject({
        relation: "known",
        received: 8,
        answered: 6,
        userMailsTo: 3,
        days: 90,
      });
      const prompt = classifierVersions["classifier-v4"].buildUser(
        {
          from: ANNA,
          to: [],
          cc: [],
          subject: "S",
          receivedAt: NOW,
          bodyText: "B",
          thread: [],
        },
        { whitelisted: false, vip: false, noreply: false },
        [],
        "NONCE",
        extras,
        ["profile"]
      );
      const section = prompt.slice(prompt.indexOf("Sender profile"), prompt.indexOf("The email to classify:"));
      expect(section).toContain("relation: known");
      expect(section).toContain("answered 6 of 8");
      expect(section).not.toContain("@");
    });
  });

  test("6b. a sender with no stored row gives null; so does an upper-case address with the row", async () => {
    await withRollback(db, async (trx) => {
      const org = await seeded(trx);
      const none = await load(trx, org.ctx, org.mailboxId, {
        parts: ["profile"],
        from: "nobody@acme.pl",
        reader: readerOf(trx),
      });
      expect(none.senderProfile).toBeNull();
      const upper = await load(trx, org.ctx, org.mailboxId, {
        parts: ["profile"],
        from: " ANNA@Acme.PL ",
        reader: readerOf(trx),
      });
      expect(upper.senderProfile?.relation).toBe("known");
    });
  });

  test("7. a flagged mail reads no profile: the reader is not called", async () => {
    await withRollback(db, async (trx) => {
      const org = await seeded(trx);
      const probe = spy(readerOf(trx));
      const extras = await load(trx, org.ctx, org.mailboxId, {
        parts: ["profile"],
        suspicious: ["lookalike_domain"],
        reader: probe.reader,
      });
      expect(extras.senderProfile).toBeNull();
      expect(probe.calls()).toBe(0);
    });
  });

  test("8. without the part profile no profile query runs; a mail with no sender address runs none", async () => {
    await withRollback(db, async (trx) => {
      const org = await seeded(trx);
      const probe = spy(readerOf(trx));
      for (const parts of [[], ["history"], ["list"]] as const) {
        const extras = await load(trx, org.ctx, org.mailboxId, { parts: [...parts], reader: probe.reader });
        expect(extras.senderProfile).toBeNull();
      }
      const noSender = await load(trx, org.ctx, org.mailboxId, {
        parts: ["profile"],
        from: null,
        reader: probe.reader,
      });
      expect(noSender.senderProfile).toBeNull();
      expect(probe.calls()).toBe(0);
    });
  });

  test("9. flag sender_context off: the reader of the composition root gives null; another org's row is not read", async () => {
    await withRollback(db, async (trx) => {
      const off = await seeded(trx, { flag: false });
      const extras = await load(trx, off.ctx, off.mailboxId, { parts: ["profile"], reader: readerOf(trx) });
      expect(extras.senderProfile).toBeNull();

      const on = await seeded(trx);
      const other = await newOrg(trx);
      const crossOrg = await load(trx, other.ctx, on.mailboxId, { parts: ["profile"], reader: readerOf(trx) });
      expect(crossOrg.senderProfile).toBeNull();
    });
  });
});
