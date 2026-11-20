import { randomUUID } from "node:crypto";
import { format } from "node:util";

import {
  assertTestAddress,
  configureMailHosts,
  isAllowedRecipient,
  probeMove,
  probeSend,
  type ProbeMoveReport,
  type ProbeSendReport,
} from "../modules/mail";
import { createCliOutput } from "../platform/cli";
import { mailAllowLocalFromEnv } from "../platform/config";

import {
  parseMailboxProbeArgs,
  probeSubOf,
  probeUsage,
  type MailboxProbeMoveArgs,
  type MailboxProbeSendArgs,
} from "./mailbox-probe-args";

// One prefix per subcommand, as the two old entry files had; a bad subcommand has only the entry name.
const outputName = (sub: string | undefined) => (sub === undefined ? "mailbox-probe" : `mailbox-probe-${sub}`);

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

function reportLines(report: ProbeMoveReport | ProbeSendReport): string[] {
  return Object.entries(report).flatMap(([key, value]) => flatten(key, value));
}

type Print = (line: string) => void;

async function runMove(args: MailboxProbeMoveArgs, password: string, print: Print): Promise<number> {
  const report = await probeMove(
    { host: args.host, port: args.port, user: args.address, auth: { kind: "password", password } },
    { probeId: randomUUID(), now: new Date(), log: print }
  );
  for (const line of reportLines(report)) print(line);
  return 0;
}

async function runSend(
  args: MailboxProbeSendArgs,
  password: string,
  print: Print,
  fail: (line: string) => void
): Promise<number> {
  if (!isAllowedRecipient(args.to, args.address, process.env.SEND_TEST_ADDRESSES)) {
    fail("refused: --to is not a test address");
    return 1;
  }
  const report = await probeSend(
    { host: args.host, port: args.port, user: args.address, auth: { kind: "password", password } },
    { host: args.smtpHost, port: args.smtpPort, user: args.address, auth: { kind: "password", password } },
    { address: args.address, to: args.to, probeId: randomUUID(), now: new Date(), log: print }
  );
  for (const line of reportLines(report)) print(line);
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const out = createCliOutput(outputName(probeSubOf(argv)));
  const args = parseMailboxProbeArgs(argv);
  const password = args && (await readPassword());
  if (!args || password === undefined) {
    out.fail(probeUsage(probeSubOf(argv)));
    return 1;
  }
  configureMailHosts({ allowLocal: mailAllowLocalFromEnv(process.env) });
  // Read here, not through loadConfig: the probe needs no DB and no other key (the config key is read by the server only).
  assertTestAddress(args.address, process.env.TEST_MAILBOX_ADDRESS);
  const print: Print = (line) => out.print(line);
  return args.sub === "move"
    ? runMove(args, password, print)
    : runSend(args, password, print, (line) => out.fail(line));
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error) => {
    createCliOutput(outputName(probeSubOf(process.argv.slice(2)))).fail(
      `failed: ${error instanceof Error ? error.message : format(error)}`
    );
    process.exit(1);
  });
