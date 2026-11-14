import { parseArgs } from "node:util";

import { z } from "zod";

import {
  configureMailHosts,
  inspectMailbox,
  type CheckReport,
  type MailCapabilities,
  type MailboxInspection,
} from "../modules/mail";
import { loadConfig, mailAllowLocal } from "../platform/config";
import { createSecretBox } from "../platform/crypto";
import { assertAppRole, createDb } from "../platform/db";
import { createLog } from "../platform/log";

const log = createLog("mailbox-check");

const usage = [
  "usage: bun run mailbox:check --org-id <uuid> --mailbox-id <uuid> [--probe]",
  "  --probe adds one draft and sends one mail to the mailbox itself: use it only on a test account.",
  "  Exit 2: the host guard refuses a mail server of this mailbox.",
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

// The lines and the exit code of one inspection. No host name and no address: only which side the guard refused.
function inspectionLines(inspection: MailboxInspection): { lines: string[]; code: number } {
  const { status, statusChangedAt, hosts, report } = inspection;
  const lines = [
    `status: ${status} since ${statusChangedAt.toISOString()}`,
    `imap-host: ${hosts.imap}`,
    `smtp-host: ${hosts.smtp}`,
  ];
  if (report !== null) return { lines: [...lines, ...reportLines(report)], code: 0 };
  if (hosts.imap === "refused" || hosts.smtp === "refused") {
    return { lines: [...lines, "the host guard refuses a mail server of this mailbox: no connection"], code: 2 };
  }
  return { lines: [...lines, "mail host lookup failed: no connection"], code: 1 };
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
    const inspection = await inspectMailbox({ db, secrets }, { orgId: options.orgId }, options.mailboxId, {
      probe: options.probe,
    });
    const { lines, code } = inspectionLines(inspection);
    for (const line of lines) log.info(line);
    return code;
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
