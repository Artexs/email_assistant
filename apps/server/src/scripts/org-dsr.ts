import { dsrIsEmpty, eraseSubjectData, findSubjectData, formatRuleCheck } from "../modules/privacy";
import { runCli, type CliRawOutput, type CliSpec } from "../platform/cli";
import { divergentCodePoints, type Db } from "../platform/db";
import { errorFields } from "../platform/errors";
import { createLog } from "../platform/log";

import { withDangerDb } from "./lib/danger-run";
import { cliDescriptions, parseOrgDsrArgs, type OrgDsrArgs } from "./org-dsr-args";

const log = createLog("org-dsr");
const failed = (error: unknown): void => log.error("org_dsr_failed", { ...errorFields(error) });

type Line = (text: string) => void;
const lineOf =
  (out: CliRawOutput): Line =>
  (text) => {
    out.write(`${text}\n`);
  };

// The database lower-cases a letter of the address unlike the program. Stdout gets the count only; `--rule-check` lists
// the code points. Nothing changed.
function ruleMismatch(count: number, line: Line): number {
  line(`rule mismatch ${count}`);
  log.error("org_dsr_refused", { reason: "rule_mismatch" });
  return 1;
}

// `--rule-check`: the code points where the database and the program lower-case differently. No address, so the output
// goes with the request record. Exit 0.
async function ruleCheck(db: Db, line: Line) {
  for (const text of formatRuleCheck(await divergentCodePoints(db))) line(text);
  return 0;
}

// Prints counts, table.column names and sizes, never the address. A find that matches nothing prints a
// warning on stderr and still exits 0: the operator checks the spelling. Returns the exit code.
async function find(args: Extract<OrgDsrArgs, { mode: "find" }>, db: Db, out: CliRawOutput, credentialsKey: string) {
  const line = lineOf(out);
  const result = await findSubjectData(db, {
    orgId: args.orgId,
    address: args.address,
    credentialsKey,
    report: args.report,
  });
  if (result.kind === "rule_mismatch") return ruleMismatch(result.codePoints.length, line);
  if (result.kind !== "found") {
    log.error("org_dsr_refused", { reason: result.kind });
    return 1;
  }
  const { counts } = result;
  line(`mails ${counts.mails}`);
  line(`sent mails ${counts.sent_mails}`);
  for (const [key, count] of Object.entries(counts.mentions)) line(`mention ${key} ${count}`);
  line(`listed delegates ${counts.listed.delegates}`);
  line(`listed sender_rules ${counts.listed.sender_rules}`);
  line(`open actions ${counts.open_actions}`);
  // The erase deletes these too, so the operator sees them before it: actions of kept mails that depend on an action of
  // a mail that goes, and the delegations that those deletions remove. The report line stays the last line.
  line(`chain actions ${counts.chain_actions}`);
  line(`chain delegations ${counts.chain_delegations}`);
  // The profiles are found by the keyed hash of the address in every mailbox of the organization; the suggestions by the hash or the address.
  line(`sender profiles ${counts.sender_profiles}`);
  line(`sender suggestions ${counts.sender_suggestions}`);
  if (result.reportBytes !== null) line(`report ${result.reportBytes} bytes`);
  if (dsrIsEmpty(counts)) out.writeErr("warning: no match, check the spelling of the address\n");
  return 0;
}

// The erase. Stdout: counts, ids of open actions, table.column names; the `record:` line is for the operator's restore
// record (a backup restore brings an erased row back, so the operator repeats this command after it).
async function erase(args: Extract<OrgDsrArgs, { mode: "erase" }>, db: Db, out: CliRawOutput, credentialsKey: string) {
  const line = lineOf(out);
  const result = await eraseSubjectData(db, {
    orgId: args.orgId,
    address: args.address,
    confirm: args.confirm,
    credentialsKey,
  });
  if (result.kind === "open_actions") {
    for (const id of result.actionIds) line(`open action ${id}`);
    log.error("org_dsr_refused", { reason: "open_actions" });
    return 1;
  }
  if (result.kind === "blocked") {
    line(`blocked ${result.constraint}`);
    log.error("org_dsr_refused", { reason: "blocked" });
    return 1;
  }
  if (result.kind === "rule_mismatch") return ruleMismatch(result.codePoints.length, line);
  if (result.kind !== "erased") {
    log.error("org_dsr_refused", { reason: result.kind });
    return 1;
  }
  line(`erased mails ${result.counts.mails}`);
  line(`erased sent mails ${result.counts.sent_mails}`);
  line(`tombstones ${result.tombstones}`);
  line(`chain actions ${result.counts.chain_actions}`);
  line(`chain delegations ${result.counts.chain_delegations}`);
  line(`erased sender profiles ${result.counts.sender_profiles}`);
  line(`erased sender suggestions ${result.counts.sender_suggestions}`);
  for (const [key, count] of Object.entries(result.scrubbed)) line(`scrubbed ${key} ${count}`);
  line(`blanked outbox ${result.stepCounts.outbox_blanked ?? 0}`);
  line(`dropped outbox ${result.stepCounts.outbox_dropped ?? 0}`);
  line(`kept delegates ${result.counts.listed.delegates}`);
  line(`kept sender_rules ${result.counts.listed.sender_rules}`);
  line(`record: dsr erase ${args.orgId} ${new Date().toISOString().slice(0, 10)}`);
  return 0;
}

const main: CliSpec["main"] = async (argv, out) => {
  const args = parseOrgDsrArgs(argv);
  return withDangerDb(failed, out, async (db, config) => {
    if (args.mode === "rule_check") return await ruleCheck(db, lineOf(out));
    return args.mode === "erase"
      ? await erase(args, db, out, config.CREDENTIALS_KEY)
      : await find(args, db, out, config.CREDENTIALS_KEY);
  });
};

if (import.meta.main) {
  await runCli({ prefix: "org-dsr", descriptions: cliDescriptions, main });
}
