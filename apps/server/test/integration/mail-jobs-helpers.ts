import { randomBytes, randomUUID } from "node:crypto";

import { type Transaction } from "kysely";

import { type ImapConnectOptions, type SeedMessage } from "../../src/modules/mail";
import { type FakeMailProvider } from "../../src/modules/mail/fake";
import { createMailSyncJob, type MailSyncJobDeps } from "../../src/modules/mail/jobs";
import { insertCredentials } from "../../src/modules/mail/repo";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB } from "../../src/platform/db";

import { createOrgWithMailbox } from "./fixtures";

export const NOW = new Date("2026-11-03T12:00:00Z");
export const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);

export interface Box {
  orgId: string;
  mailboxId: string;
  address: string;
}

export async function addBox(trx: Transaction<DB>): Promise<Box> {
  const address = `box-${randomUUID()}@x.test`;
  const { orgId, mailboxId } = await createOrgWithMailbox(trx, { address });
  const secret = secrets.encrypt("pw", `mailbox:${mailboxId}`);
  await insertCredentials(
    trx,
    { orgId },
    { mailboxId, encryptedSecret: secret.ciphertext, secretKind: "password", keyVersion: secret.keyVersion }
  );
  return { orgId, mailboxId, address };
}

export function seed(n: number): SeedMessage {
  return {
    messageId: `<m${n}@x.test>`,
    from: `sender${n}@x.test`,
    to: ["box@x.test"],
    subject: `Mail ${n}`,
    date: new Date(Date.UTC(2026, 10, 3, 8, 0, n)),
    text: `Body ${n}`,
  };
}

export interface Opened {
  fakes: Map<string, FakeMailProvider>;
  opened: FakeMailProvider[];
  failures: Map<string, Error>;
  openProvider(opts: ImapConnectOptions): Promise<FakeMailProvider>;
}

// Fake providers by address. An address without a fake (other rows in the dev DB) fails like a bad login.
export function openers(): Opened {
  const fakes = new Map<string, FakeMailProvider>();
  const opened: FakeMailProvider[] = [];
  const failures = new Map<string, Error>();
  return {
    fakes,
    opened,
    failures,
    async openProvider(opts) {
      const failure = failures.get(opts.user);
      if (failure) throw failure;
      const fake = fakes.get(opts.user);
      if (!fake) throw new Error("no fake for this address");
      opened.push(fake);
      return fake;
    },
  };
}

export function jobFor(
  trx: Transaction<DB>,
  o: Opened,
  sentOriginOf: MailSyncJobDeps["sentOriginOf"] = async () => null
) {
  return createMailSyncJob({
    db: trx,
    secrets,
    openProvider: o.openProvider,
    isOwnActionId: async () => false,
    sentOriginOf,
    now: () => NOW,
  });
}

export async function mailboxRow(trx: Transaction<DB>, id: string) {
  return trx
    .selectFrom("mailboxes")
    .select(["status", "last_synced_at", "status_changed_at"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
}

export async function emailCount(trx: Transaction<DB>, mailboxId: string): Promise<number> {
  const rows = await trx.selectFrom("emails").select("id").where("mailbox_id", "=", mailboxId).execute();
  return rows.length;
}
