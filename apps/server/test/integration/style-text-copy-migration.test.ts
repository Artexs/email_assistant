import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { insertMailbox } from "../../src/modules/mail/repo";
import { createDb, type DB } from "../../src/platform/db";

import { createOrgWithMailbox, testCapabilities } from "./fixtures";
import { withRollback } from "./helpers";
import { insertMailboxProfile } from "./reply-fixtures";

// The migration `20261120100001_style_text_copy.sql`: the old organization signature moves into the mailbox profiles and
// the column is emptied. The Up section runs as the owner role inside a transaction that is rolled back.
type Trx = Transaction<DB>;

const migrations = join(import.meta.dir, "../../../../db/migrations");
const file = readFileSync(join(migrations, "20261120100001_style_text_copy.sql"), "utf8");
const [upPart = ""] = file.split("-- migrate:down");
const up = upPart.replace("-- migrate:up", "");

async function withOwner(run: (trx: Trx) => Promise<void>): Promise<void> {
  const url = process.env.MIGRATOR_DATABASE_URL;
  if (!url) throw new Error("MIGRATOR_DATABASE_URL is missing: the owner role runs the Up section");
  const owner = createDb(url);
  try {
    await withRollback(owner, run);
  } finally {
    await owner.destroy();
  }
}

const setStyle = (trx: Trx, orgId: string, styleText: string | null) =>
  trx.updateTable("organizations").set({ style_text: styleText }).where("id", "=", orgId).execute();

const styleOf = async (trx: Trx, orgId: string) =>
  (await trx.selectFrom("organizations").select("style_text").where("id", "=", orgId).executeTakeFirstOrThrow())
    .style_text;

const profileOf = (trx: Trx, mailboxId: string) =>
  trx.selectFrom("mailbox_profiles").selectAll().where("mailbox_id", "=", mailboxId).executeTakeFirst();

async function addMailbox(trx: Trx, orgId: string): Promise<string> {
  const id = randomUUID();
  await insertMailbox(
    trx,
    { orgId },
    {
      id,
      address: `box-${id}@x.test`,
      imapHost: "imap.x.test",
      imapPort: 993,
      smtpHost: "smtp.x.test",
      smtpPort: 465,
      capabilities: testCapabilities,
      folderMap: {},
    }
  );
  return id;
}

const OLD = new Date("2026-01-01T00:00:00Z");
const TEXT = "Pozdrawiam, Zespół";

describe("the copy of the organization signature", () => {
  test("a mailbox with a signature keeps it; a null signature and a missing row take the text", async () => {
    await withOwner(async (trx) => {
      const { orgId, mailboxId: withSignature, userId } = await createOrgWithMailbox(trx);
      const nullSignature = await addMailbox(trx, orgId);
      const noRow = await addMailbox(trx, orgId);
      await setStyle(trx, orgId, TEXT);
      await insertMailboxProfile(trx, { orgId }, withSignature, { signature: "Anna", updated_at: OLD });
      await insertMailboxProfile(trx, { orgId }, nullSignature, {
        display_name: "Biuro",
        writing_style: "Krótko.",
        updated_by: userId,
        updated_at: OLD,
      });

      await sql.raw(up).execute(trx);

      const kept = await profileOf(trx, withSignature);
      expect({ signature: kept?.signature, updatedAt: kept?.updated_at }).toEqual({
        signature: "Anna",
        updatedAt: OLD,
      });
      const filled = await profileOf(trx, nullSignature);
      expect(filled).toMatchObject({
        signature: TEXT,
        display_name: "Biuro",
        writing_style: "Krótko.",
        updated_by: userId,
      });
      expect(filled?.updated_at.getTime()).toBeGreaterThan(OLD.getTime());
      const made = await profileOf(trx, noRow);
      expect(made).toMatchObject({
        org_id: orgId,
        signature: TEXT,
        display_name: null,
        writing_style: null,
        updated_by: null,
      });
    });
  });

  test("a text longer than the profile limit is cut to 1,000 characters", async () => {
    await withOwner(async (trx) => {
      const { orgId, mailboxId } = await createOrgWithMailbox(trx);
      await setStyle(trx, orgId, "x".repeat(1200));

      await sql.raw(up).execute(trx);

      expect((await profileOf(trx, mailboxId))?.signature).toBe("x".repeat(1000));
    });
  });

  test("an organization with a null or blank text makes and changes no row", async () => {
    await withOwner(async (trx) => {
      const nullText = await createOrgWithMailbox(trx);
      const blank = await createOrgWithMailbox(trx);
      await setStyle(trx, blank.orgId, "  \n ");
      await insertMailboxProfile(trx, { orgId: blank.orgId }, blank.mailboxId, { updated_at: OLD });

      await sql.raw(up).execute(trx);

      expect(await profileOf(trx, nullText.mailboxId)).toBeUndefined();
      const untouched = await profileOf(trx, blank.mailboxId);
      expect({ signature: untouched?.signature, updatedAt: untouched?.updated_at }).toEqual({
        signature: null,
        updatedAt: OLD,
      });
    });
  });

  test("a second run changes no row and keeps the updated_at of the first run", async () => {
    await withOwner(async (trx) => {
      const { orgId, mailboxId } = await createOrgWithMailbox(trx);
      const noRow = await addMailbox(trx, orgId);
      await setStyle(trx, orgId, TEXT);
      await insertMailboxProfile(trx, { orgId }, mailboxId, { updated_at: OLD });
      await sql.raw(up).execute(trx);
      // Set the stamps back so that a second write would show.
      const stamp = new Date("2026-02-02T00:00:00Z");
      await trx.updateTable("mailbox_profiles").set({ updated_at: stamp }).where("org_id", "=", orgId).execute();
      const rows = () =>
        trx.selectFrom("mailbox_profiles").selectAll().where("org_id", "=", orgId).orderBy("mailbox_id").execute();
      const first = await rows();

      await sql.raw(up).execute(trx);

      expect(await rows()).toEqual(first);
      expect(first.map((row) => row.signature)).toEqual([TEXT, TEXT]);
      expect(first.map((row) => row.updated_at)).toEqual([stamp, stamp]);
      expect((await profileOf(trx, noRow))?.signature).toBe(TEXT);
    });
  });

  test("every organization has a null text afterwards, also one with text and no mailbox", async () => {
    await withOwner(async (trx) => {
      const withMailbox = await createOrgWithMailbox(trx);
      const empty = await createOrgWithMailbox(trx);
      await trx.deleteFrom("mailboxes").where("org_id", "=", empty.orgId).execute();
      await setStyle(trx, withMailbox.orgId, TEXT);
      await setStyle(trx, empty.orgId, "Text without a mailbox");

      await sql.raw(up).execute(trx);

      expect(await styleOf(trx, withMailbox.orgId)).toBeNull();
      expect(await styleOf(trx, empty.orgId)).toBeNull();
      const left = await trx
        .selectFrom("organizations")
        .select(sql<number>`count(*)::int`.as("n"))
        .where("style_text", "is not", null)
        .executeTakeFirstOrThrow();
      expect(left.n).toBe(0);
      expect((await profileOf(trx, withMailbox.mailboxId))?.signature).toBe(TEXT);
    });
  });
});
