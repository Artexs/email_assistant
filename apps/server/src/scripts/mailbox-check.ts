import {
  configureMailHosts,
  inspectMailbox,
  type CheckReport,
  type MailCapabilities,
  type MailboxInspection,
} from "../modules/mail";
import { runCli, type CliRawOutput, type CliSpec } from "../platform/cli";
import { loadConfig, mailAllowLocal } from "../platform/config";
import { createSecretBox } from "../platform/crypto";
import { assertAppRole, createDb } from "../platform/db";

import { reportFailure } from "./lib/mailbox-failure";
import { cliDescriptions, parseMailboxCheckArgs, type MailboxCheckArgs } from "./mailbox-check-args";

const CAPABILITY_LABELS: [keyof MailCapabilities, string][] = [
  ["idle", "IDLE"],
  ["move", "MOVE"],
  ["uidplus", "UIDPLUS"],
  ["condstore", "CONDSTORE"],
  ["specialUse", "SPECIAL-USE"],
  ["keywords", "KEYWORDS"],
];

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
    return { lines: [...lines, "the host guard refuses a mail server of this mailbox: no connection"], code: 1 };
  }
  return { lines: [...lines, "mail host lookup failed: no connection"], code: 1 };
}

async function run(options: MailboxCheckArgs, out: CliRawOutput): Promise<number> {
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
    for (const line of lines) out.print(line);
    return code;
  } finally {
    await db.destroy();
  }
}

// Parse first: a bad argument is a usage error (exit 2) before any config or DB. Any later error gets one line and its code.
const main: CliSpec["main"] = async (argv, out) => {
  const options = parseMailboxCheckArgs(argv);
  try {
    return await run(options, out);
  } catch (error) {
    return reportFailure(out, error, "message");
  }
};

if (import.meta.main) {
  await runCli({ prefix: "mailbox-check", descriptions: cliDescriptions, main });
}
