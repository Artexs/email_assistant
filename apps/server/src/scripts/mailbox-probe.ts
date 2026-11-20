import { randomUUID } from "node:crypto";

import {
  assertTestAddress,
  configureMailHosts,
  isAllowedRecipient,
  probeMove,
  probeSend,
  type ProbeMoveReport,
  type ProbeSendReport,
} from "../modules/mail";
import { runCli, type CliSpec } from "../platform/cli";
import { mailAllowLocalFromEnv } from "../platform/config";

import { reportFailure } from "./lib/mailbox-failure";
import { readStdinSecret } from "./lib/stdin-secret";
import {
  cliDescriptions,
  parseMailboxProbeArgs,
  probeSubOf,
  type MailboxProbeMoveArgs,
  type MailboxProbeSendArgs,
} from "./mailbox-probe-args";

// One prefix per subcommand, as the two old entry files had; a bad subcommand has only the entry name.
const outputName = (sub: string | undefined) => (sub === undefined ? "mailbox-probe" : `mailbox-probe-${sub}`);

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

// Parse first: a bad argument is a usage error (exit 2) before stdin or any connection. The password comes only from a pipe.
const main: CliSpec["main"] = async (argv, out) => {
  const args = parseMailboxProbeArgs(argv);
  const secret = await readStdinSecret();
  if (!secret.ok) {
    out.fail(secret.refusal);
    return 1;
  }
  try {
    configureMailHosts({ allowLocal: mailAllowLocalFromEnv(process.env) });
    // Read here, not through loadConfig: the probe needs no DB and no other key (the config key is read by the server only).
    assertTestAddress(args.address, process.env.TEST_MAILBOX_ADDRESS);
    const print: Print = (line) => out.print(line);
    return await (args.sub === "move"
      ? runMove(args, secret.secret, print)
      : runSend(args, secret.secret, print, (line) => out.fail(line)));
  } catch (error) {
    return reportFailure(out, error, "message");
  }
};

if (import.meta.main) {
  await runCli({
    prefix: outputName(probeSubOf(process.argv.slice(2))),
    descriptions: cliDescriptions,
    main,
  });
}
