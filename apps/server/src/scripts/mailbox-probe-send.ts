import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

import { z } from "zod";

import {
  assertTestAddress,
  configureMailHosts,
  isAllowedRecipient,
  probeSend,
  type ProbeSendReport,
} from "../modules/mail";
import { mailAllowLocalFromEnv } from "../platform/config";
import { createLog } from "../platform/log";

const log = createLog("mailbox-probe-send");

const usage = [
  "usage: printf '%s' \"$PASSWORD\" | TEST_MAILBOX_ADDRESS=<address> SEND_TEST_ADDRESSES=<address,…> bun run mailbox:probe-send --host <imap host> --port <port> --smtp-host <host> --smtp-port <port> --address <address> --to <address>",
  "  It changes the mailbox and sends one real mail: it adds one synthetic draft, sends one mail from --address to --to,",
  "  adds one copy to Sent, waits for the mail in INBOX, and removes all of them by UID at the end.",
  "  It creates the folders Drafts and Sent if they are missing.",
  "  It refuses unless TEST_MAILBOX_ADDRESS equals --address, and --to equals --address or is in SEND_TEST_ADDRESSES.",
  "  The password comes only from stdin.",
].join("\n");

const portSchema = z.coerce.number().int().min(1).max(65_535);

function readOptions() {
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        host: { type: "string" },
        port: { type: "string" },
        "smtp-host": { type: "string" },
        "smtp-port": { type: "string" },
        address: { type: "string" },
        to: { type: "string" },
      },
      strict: true,
    });
    const port = portSchema.safeParse(values.port);
    const smtpPort = portSchema.safeParse(values["smtp-port"]);
    const smtpHost = values["smtp-host"];
    if (
      values.host === undefined ||
      smtpHost === undefined ||
      values.address === undefined ||
      values.to === undefined ||
      !port.success ||
      !smtpPort.success
    ) {
      return undefined;
    }
    return {
      host: values.host,
      port: port.data,
      smtpHost,
      smtpPort: smtpPort.data,
      address: values.address,
      to: values.to,
    };
  } catch {
    return undefined;
  }
}

// A terminal would show the typed password, so stdin must be a pipe.
async function readPassword(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined;
  const text = await Bun.stdin.text();
  const password = text.replace(/\r?\n$/, "");
  return password === "" ? undefined : password;
}

function flatten(prefix: string, value: unknown): string[] {
  if (Array.isArray(value)) return [`${prefix}: ${value.length === 0 ? "-" : value.join(" | ")}`];
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, inner]) => flatten(`${prefix}.${key}`, inner));
  }
  return [`${prefix}: ${String(value)}`];
}

function reportLines(report: ProbeSendReport): string[] {
  return Object.entries(report).flatMap(([key, value]) => flatten(key, value));
}

async function main(): Promise<number> {
  const options = readOptions();
  const password = options && (await readPassword());
  if (!options || password === undefined) {
    log.error(usage);
    return 1;
  }
  configureMailHosts({ allowLocal: mailAllowLocalFromEnv(process.env) });
  // Read here, not through loadConfig: the probe needs no DB and no other key (the config key comes in S4 stage 18).
  assertTestAddress(options.address, process.env.TEST_MAILBOX_ADDRESS);
  if (!isAllowedRecipient(options.to, options.address, process.env.SEND_TEST_ADDRESSES)) {
    log.error("refused: --to is not a test address");
    return 1;
  }
  const report = await probeSend(
    { host: options.host, port: options.port, user: options.address, password },
    { host: options.smtpHost, port: options.smtpPort, user: options.address, password },
    { address: options.address, to: options.to, probeId: randomUUID(), now: new Date(), log: (line) => log.info(line) }
  );
  for (const line of reportLines(report)) log.info(line);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    log.error("failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
