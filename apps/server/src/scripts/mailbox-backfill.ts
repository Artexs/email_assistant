import { parseArgs } from "node:util";

import { z } from "zod";

import { backfillMailbox, CursorMovedError } from "../modules/mail";
import { requeueBackfillWindow } from "../modules/triage";
import { loadConfig } from "../platform/config";
import { createSecretBox } from "../platform/crypto";
import { assertAppRole, createDb } from "../platform/db";
import { describeError } from "../platform/errors";
import { createLog } from "../platform/log";

const log = createLog("mailbox-backfill");

const usage = [
  "usage: bun run mailbox:backfill --org-id <uuid> --mailbox-id <uuid> [--days 30]",
  "  One-off, read-only on the mailbox. Stores INBOX mail of the last 1-180 days that the sync missed.",
  "  Then re-queues stored real mail of that window that the worker skipped as too old.",
  "  Exit 0: done. Exit 1: usage error or failure.",
].join("\n");

function readOptions() {
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        "org-id": { type: "string" },
        "mailbox-id": { type: "string" },
        days: { type: "string" },
      },
      strict: true,
    });
    const orgId = values["org-id"];
    const mailboxId = values["mailbox-id"];
    if (orgId === undefined || mailboxId === undefined) return undefined;
    if (!z.uuid().safeParse(orgId).success || !z.uuid().safeParse(mailboxId).success) return undefined;
    const days = z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .pipe(z.number().int().min(1).max(180))
      .safeParse(values.days ?? "30");
    if (!days.success) return undefined;
    return { orgId, mailboxId, days: days.data };
  } catch {
    return undefined;
  }
}

async function main(): Promise<number> {
  const options = readOptions();
  if (!options) {
    log.error(usage);
    return 1;
  }

  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const secrets = createSecretBox(config.CREDENTIALS_KEY, config.CREDENTIALS_KEY_VERSION);
    const now = new Date();
    const result = await backfillMailbox({ db, secrets }, { orgId: options.orgId }, options.mailboxId, {
      days: options.days,
      now,
    });
    log.info(
      `backfill ${options.mailboxId}: fetched ${result.fetched}, stored ${result.stored}, uid updated ${result.uidUpdated}, returned ${result.returned}`
    );
    const since = new Date(now.getTime() - options.days * 24 * 60 * 60 * 1000);
    const requeued = await requeueBackfillWindow(db, { orgId: options.orgId }, options.mailboxId, { since, now });
    log.info(`re-queued ${requeued}`);
    return 0;
  } catch (error) {
    if (error instanceof CursorMovedError) {
      log.error(
        "the regular sync moved the cursor during the backfill; run the same command again (the dedup key stops duplicates)"
      );
    } else {
      log.error("failed:", describeError(error));
    }
    return 1;
  } finally {
    await db.destroy();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    log.error("failed:", describeError(error));
    process.exit(1);
  });
