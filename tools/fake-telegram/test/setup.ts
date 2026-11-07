import { randomBytes, randomUUID } from "node:crypto";

import { isQuietTime, parseToolSwitches } from "@ea/core";
import type { Transaction } from "kysely";

import {
  getMailboxSettings,
  insertDefaultSettings,
  updateMailboxSettings,
} from "../../../apps/server/src/modules/config";
import { renderSeedMessage, type ImapConnectOptions } from "../../../apps/server/src/modules/mail";
import { appendRaw } from "../../../apps/server/src/modules/mail/imap/tools";
import { insertCredentials } from "../../../apps/server/src/modules/mail/repo";
import { createSecretBox, type SecretBox } from "../../../apps/server/src/platform/crypto";
import type { DB } from "../../../apps/server/src/platform/db";
import type { LlmClient } from "../../../apps/server/src/platform/llm";
import {
  createOrgWithMailbox,
  isolateChannels,
  pauseOtherMailboxes,
} from "../../../apps/server/test/integration/fixtures";

export interface E2eMailbox {
  ctx: { orgId: string };
  userId: string;
  mailboxId: string;
  imap: ImapConnectOptions;
  secrets: SecretBox;
}

// Local GreenMail (bun run dev:up). Auth is off: the first login with a new user creates the mailbox.
function greenmailUser(): ImapConnectOptions {
  return {
    host: process.env.TEST_IMAP_HOST ?? "127.0.0.1",
    port: Number(process.env.TEST_IMAP_PORT ?? "3143"),
    user: `u-${randomUUID()}@localhost`,
    password: "greenmail-test",
  };
}

// The channel sender holds notices in quiet hours (22:00-07:00 org time). Etc/UTC and Etc/GMT-12
// are 12 h apart, so one of them is always outside the 9 h quiet window.
export function timeZoneOutsideQuietHours(at: Date): string {
  return isQuietTime(at, "Etc/UTC") ? "Etc/GMT-12" : "Etc/UTC";
}

// An org with an owner and a mailbox on a new GreenMail user, in assist mode with the flag switch on.
export async function createGreenmailMailbox(trx: Transaction<DB>): Promise<E2eMailbox> {
  await pauseOtherMailboxes(trx);
  await isolateChannels(trx);
  const imap = greenmailUser();
  const { orgId, userId, mailboxId } = await createOrgWithMailbox(trx, { address: imap.user });
  const ctx = { orgId };
  // The test sends its notice at the real "now": keep the org out of quiet hours at any run time.
  await trx
    .updateTable("organizations")
    .set({ timezone: timeZoneOutsideQuietHours(new Date()) })
    .where("id", "=", orgId)
    .execute();
  await trx
    .updateTable("mailboxes")
    .set({
      imap_host: imap.host,
      imap_port: imap.port,
      capabilities: JSON.stringify({
        idle: true,
        move: true,
        uidplus: true,
        condstore: false,
        specialUse: false,
        keywords: false,
      }),
    })
    .where("org_id", "=", orgId)
    .where("id", "=", mailboxId)
    .execute();
  const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);
  const secret = secrets.encrypt(imap.password, `mailbox:${mailboxId}`);
  await insertCredentials(trx, ctx, {
    mailboxId,
    encryptedSecret: secret.ciphertext,
    secretKind: "password",
    keyVersion: secret.keyVersion,
  });
  if (!(await getMailboxSettings(trx, ctx, mailboxId))) {
    await insertDefaultSettings(trx, ctx, mailboxId);
  }
  await updateMailboxSettings(trx, ctx, mailboxId, {
    mode: "assist",
    toolSwitches: parseToolSwitches({ flag: true }),
  });
  return { ctx, userId, mailboxId, imap, secrets };
}

// The `@ea-seed.test` Message-ID makes the mail synthetic: the synthetic scopes take it.
export async function appendUrgentSeed(box: E2eMailbox, input: { subject: string }): Promise<{ messageId: string }> {
  const messageId = `<e2e-${randomUUID()}@ea-seed.test>`;
  await appendRaw(
    box.imap,
    "INBOX",
    renderSeedMessage({
      messageId,
      from: "boss@example.test",
      to: [box.imap.user],
      subject: input.subject,
      date: new Date(),
      text: "Please call me today.",
    })
  );
  return { messageId };
}

const urgentAnswer = {
  category: "urgent",
  confidence: 0.95,
  reason_code: "deadline_today",
  reason: "the sender needs a call today",
  summary: "The boss asks for a call today.",
  fields: { due_date: null, language: "en", delegate_id: null, task: null, clarification: null },
};

// A stub classifier that answers category "urgent".
export function urgentLlm(): LlmClient {
  return {
    classifierModel: "fake-model",
    async classify(req) {
      return {
        data: req.schema.parse(urgentAnswer),
        usage: { model: "fake-model", tokensIn: 100, tokensOut: 20, latencyMs: 300 },
      };
    },
  } as LlmClient;
}
