import { dsrIsEmpty, eraseSubjectData, findSubjectData } from "../modules/privacy";
import { loadConfig } from "../platform/config";
import { assertAppRole, createDb, type Db } from "../platform/db";
import { errorFields } from "../platform/errors";
import { createLog } from "../platform/log";

import { parseOrgDsrArgs, usage, type OrgDsrArgs } from "./org-dsr-args";

const log = createLog("org-dsr");

function line(text: string): void {
  process.stdout.write(`${text}\n`);
}

// Prints counts, table.column names and sizes, never the address (F106 D17). A find that matches nothing prints a
// warning on stderr and still exits 0: the operator checks the spelling. Returns the exit code.
async function find(args: Extract<OrgDsrArgs, { mode: "find" }>, db: Db) {
  const result = await findSubjectData(db, {
    orgId: args.orgId,
    address: args.address,
    credentialsKey: loadConfig().CREDENTIALS_KEY,
    report: args.report,
  });
  if (result.kind !== "found") {
    log.error("org_dsr_refused", { reason: result.kind });
    return 1;
  }
  const { counts } = result;
  line(`mails ${counts.mails}`);
  for (const [key, count] of Object.entries(counts.mentions)) line(`mention ${key} ${count}`);
  line(`listed delegates ${counts.listed.delegates}`);
  line(`listed sender_rules ${counts.listed.sender_rules}`);
  line(`open actions ${counts.open_actions}`);
  // The erase deletes these too, so the operator sees them before it: actions of kept mails that depend on an action of
  // a mail that goes, and the delegations that those deletions remove. The report line stays the last line.
  line(`chain actions ${counts.chain_actions}`);
  line(`chain delegations ${counts.chain_delegations}`);
  if (result.reportBytes !== null) line(`report ${result.reportBytes} bytes`);
  if (dsrIsEmpty(counts)) process.stderr.write("warning: no match, check the spelling of the address\n");
  return 0;
}

// The erase. Stdout: counts, ids of open actions, table.column names; the `record:` line is for the operator's restore
// record (a backup restore brings an erased row back, so the operator repeats this command after it).
async function erase(args: Extract<OrgDsrArgs, { mode: "erase" }>, db: Db) {
  const result = await eraseSubjectData(db, {
    orgId: args.orgId,
    address: args.address,
    confirm: args.confirm,
    credentialsKey: loadConfig().CREDENTIALS_KEY,
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
  if (result.kind !== "erased") {
    log.error("org_dsr_refused", { reason: result.kind });
    return 1;
  }
  line(`erased mails ${result.counts.mails}`);
  line(`tombstones ${result.tombstones}`);
  line(`chain actions ${result.counts.chain_actions}`);
  line(`chain delegations ${result.counts.chain_delegations}`);
  for (const [key, count] of Object.entries(result.scrubbed)) line(`scrubbed ${key} ${count}`);
  line(`blanked outbox ${result.stepCounts.outbox_blanked ?? 0}`);
  line(`dropped outbox ${result.stepCounts.outbox_dropped ?? 0}`);
  line(`kept delegates ${result.counts.listed.delegates}`);
  line(`kept sender_rules ${result.counts.listed.sender_rules}`);
  line(`record: dsr erase ${args.orgId} ${new Date().toISOString().slice(0, 10)}`);
  return 0;
}

async function main(): Promise<number> {
  const args = parseOrgDsrArgs(process.argv.slice(2));
  if (!args) {
    process.stderr.write(`${usage}\n`);
    return 2;
  }

  const db = createDb(loadConfig().DATABASE_URL);
  try {
    await assertAppRole(db);
    return args.mode === "erase" ? await erase(args, db) : await find(args, db);
  } catch (error) {
    log.error("org_dsr_failed", { ...errorFields(error) });
    return 1;
  } finally {
    await db.destroy();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    log.error("org_dsr_failed", { ...errorFields(error) });
    process.exit(1);
  });
