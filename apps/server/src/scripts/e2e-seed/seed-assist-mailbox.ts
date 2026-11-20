import { randomUUID } from "node:crypto";

import { insertDefaultSettings, updateMailboxSettings } from "../../modules/config";
import { insertCredentials, insertInboxFolder, insertMailbox } from "../../modules/mail/repo";
import { createSecretBox } from "../../platform/crypto";
import { type Db } from "../../platform/db";
import { assertTaggedMailbox, mailTagFromEnv } from "../e2e-seed-args";

// The GreenMail of the dev stack (the same host that the Playwright config uses).
const GREENMAIL_HOST = process.env.TEST_IMAP_HOST ?? "127.0.0.1";
export const ASSIST_SWITCHES = { move: true, mark_read: true, flag: true, create_draft: true, move_unsure: false };

// A mailbox on the GreenMail of the dev stack, in assist mode with the draft switch on, as the approvals and the reminders need it (an
// approval of a draft-less mailbox is a shadow plan). The password is a test value; the mailbox is never polled by a spec.
export async function seedAssistMailbox(
  db: Db,
  secretBox: ReturnType<typeof createSecretBox>,
  ctx: { orgId: string },
  address: string,
  mode: "assist" | "shadow" = "assist",
  opts: { oauthProvider?: "microsoft" | "google" } = {}
): Promise<string> {
  assertTaggedMailbox(address, mailTagFromEnv(process.env));
  const mailboxId = randomUUID();
  await insertMailbox(db, ctx, {
    id: mailboxId,
    address,
    imapHost: GREENMAIL_HOST,
    imapPort: 3143,
    smtpHost: GREENMAIL_HOST,
    smtpPort: 3025,
    capabilities: { move: true, uidplus: true, idle: false, condstore: false, specialUse: false, keywords: false },
    folderMap: { drafts: "Drafts" },
    ...(opts.oauthProvider === undefined ? {} : { oauthProvider: opts.oauthProvider }),
  });
  await insertInboxFolder(db, ctx, mailboxId);
  const mailboxSecret = secretBox.encrypt("e2e-assist-box-password", `mailbox:${mailboxId}`);
  await insertCredentials(db, ctx, {
    mailboxId,
    encryptedSecret: mailboxSecret.ciphertext,
    secretKind: "password",
    keyVersion: mailboxSecret.keyVersion,
  });
  await insertDefaultSettings(db, ctx, mailboxId);
  // `shadow` is the mode of a new mailbox: nothing to change.
  if (mode === "assist") {
    await db
      .transaction()
      .execute((trx) => updateMailboxSettings(trx, ctx, mailboxId, { mode: "assist", toolSwitches: ASSIST_SWITCHES }));
  }
  return mailboxId;
}
