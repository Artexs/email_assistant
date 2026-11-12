import { parseArgs } from "node:util";

import { z } from "zod";

import { checkMailbox, configureMailHosts, type CheckReport, type MailCapabilities } from "../modules/mail";
import { loadConfig, mailAllowLocal } from "../platform/config";
import { createSecretBox } from "../platform/crypto";
import { assertAppRole, createDb } from "../platform/db";
import { createLog } from "../platform/log";

const log = createLog("mailbox-check");

const usage = [
  "usage: bun run mailbox:check --org-id <uuid> --mailbox-id <uuid> [--probe]",
  "  --probe adds one draft and sends one mail to the mailbox itself: use it only on a test account.",
].join("\n");

const CAPABILITY_LABELS: [keyof MailCapabilities, string][] = [
  ["idle", "IDLE"],
  ["move", "MOVE"],
  ["uidplus", "UIDPLUS"],
  ["condstore", "CONDSTORE"],
  ["specialUse", "SPECIAL-USE"],
  ["keywords", "KEYWORDS"],
];

function readOptions() {
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        "org-id": { type: "string" },
        "mailbox-id": { type: "string" },
        probe: { type: "boolean", default: false },
      },
      strict: true,
    });
    const orgId = values["org-id"];
    const mailboxId = values["mailbox-id"];
    if (orgId === undefined || mailboxId === undefined) return undefined;
    if (!z.uuid().safeParse(orgId).success || !z.uuid().safeParse(mailboxId).success) return undefined;
    return { orgId, mailboxId, probe: values.probe };
  } catch {
    return undefined;
  }
}

function reportLines(report: CheckReport): string[] {
  const capabilities = CAPABILITY_LABELS.map(
    ([key, label]) => `${label}=${report.capabilities[key] ? "yes" : "no"}`
  ).join(" ");
  return [
    `capabilities: ${capabilities}`,
    ...report.folders.map((folder) => `folder ${folder.path} ${folder.specialUse ?? "-"}`),
    `search-header: ${report.searchHeader}`,
    `smtp-saves-sent: ${report.sentAutosave}`,
    ...report.notes,
  ];
}

async function main(): Promise<number> {
  const options = readOptions();
  if (!options) {
    log.error(usage);
    return 1;
  }

  const config = loadConfig();

  configureMailHosts({ allowLocal: mailAllowLocal(config) });
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const secrets = createSecretBox(config.CREDENTIALS_KEY, config.CREDENTIALS_KEY_VERSION);
    const report = await checkMailbox({ db, secrets }, { orgId: options.orgId }, options.mailboxId, {
      probe: options.probe,
    });
    for (const line of reportLines(report)) log.info(line);
    return 0;
  } catch (error) {
    log.error("failed:", error instanceof Error ? error.message : error);
    return 1;
  } finally {
    await db.destroy();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    log.error("failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
