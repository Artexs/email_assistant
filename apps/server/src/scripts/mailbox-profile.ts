import type { ProfileInput, ProfileView } from "@ea/core";

import { getProfileView, updateMailboxProfile } from "../modules/replies";
import { runCli, type CliRawOutput, type CliSpec } from "../platform/cli";
import { loadConfig } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";

import { reportFailure } from "./lib/mailbox-failure";
import { cliDescriptions, parseProfileArgs, type ProfileCommand } from "./mailbox-profile-args";

// An operator CLI on the server: it shows the stored texts to the operator, never to a log.
function printView(out: CliRawOutput, view: ProfileView): void {
  out.print(`display name: ${view.displayName ?? "(not set)"}`);
  out.print(`signature: ${view.signature === null ? "(not set)" : `${Array.from(view.signature).length} characters`}`);
  out.print(
    `writing style: ${view.writingStyle === null ? "(not set)" : `${Array.from(view.writingStyle).length} characters`}`
  );
  out.print(`fallback name: ${view.fallbackName}`);
  out.print(`fallback signature: ${Array.from(view.fallbackSignature).length} characters`);
}

// The text of a file, or undefined when it cannot be read. The message never names the content.
async function readText(path: string): Promise<string | undefined> {
  try {
    return await Bun.file(path).text();
  } catch {
    return undefined;
  }
}

async function run(
  out: CliRawOutput,
  command: ProfileCommand,
  db: Parameters<typeof updateMailboxProfile>[0]
): Promise<number> {
  const ctx = { orgId: command.orgId };
  const input: ProfileInput = {};
  if (command.displayName !== undefined) input.displayName = command.displayName;
  for (const [field, path] of [
    ["signature", command.signatureFile],
    ["writingStyle", command.styleFile],
  ] as const) {
    if (path === undefined) continue;
    const text = await readText(path);
    if (text === undefined) {
      out.fail(`cannot read the ${field === "signature" ? "signature" : "style"} file`);
      return 1;
    }
    input[field] = text;
  }

  if (Object.keys(input).length === 0) {
    const view = await getProfileView(db, ctx, command.mailboxId);
    if (view === undefined) {
      out.fail("no such mailbox in this organization");
      return 1;
    }
    printView(out, view);
    return 0;
  }
  const result = await updateMailboxProfile(db, ctx, command.mailboxId, input, { via: "cli" });
  if (result.kind === "not_found") {
    out.fail("no such mailbox in this organization");
    return 1;
  }
  if (result.kind === "invalid") {
    out.fail(`refused: ${result.field} (${result.code}); nothing stored`);
    return 1;
  }
  printView(out, result.view);
  out.print(result.changed.length === 0 ? "no change" : `changed: ${result.changed.join(", ")}`);
  return 0;
}

async function runCommand(command: ProfileCommand, out: CliRawOutput): Promise<number> {
  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    return await run(out, command, db);
  } finally {
    await db.destroy();
  }
}

// Parse first: a bad argument is a usage error (exit 2) before any config or DB. Any later error gets one line and its code.
const main: CliSpec["main"] = async (argv, out) => {
  const command = parseProfileArgs(argv);
  try {
    return await runCommand(command, out);
  } catch (error) {
    return reportFailure(out, error, "label");
  }
};

if (import.meta.main) {
  await runCli({ prefix: "mailbox-profile", descriptions: cliDescriptions, main });
}
