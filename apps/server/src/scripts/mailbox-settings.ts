import {
  describeSettings,
  type GateEvidenceDeps,
  MAILBOX_ACTION_TYPES,
  type SettingsSnapshot,
  type UrgencyProfile,
} from "@ea/core";

import { autoSetter, gateEvidenceOf, sentSwitchHooks, settingsDeps } from "../composition";
import { countReadyOriginals, expireReady } from "../modules/actions";
import {
  getSettingsView,
  OauthMailboxError,
  setMode,
  setToolSwitch,
  setUrgencyProfile,
  type SettingsChange,
} from "../modules/config";
import {
  configureMailHosts,
  getSentSyncView,
  listSyncFolders,
  setSentSync,
  setSyncFolderEnabled,
  type TestMailRule,
} from "../modules/mail";
import { runCli, type CliRawOutput, type CliSpec } from "../platform/cli";
import { loadConfig, mailAllowLocal, testMailRule } from "../platform/config";
import { assertAppRole, createDb, type Db } from "../platform/db";

import { reportFailure } from "./lib/mailbox-failure";
import {
  cliDescriptions,
  describeSentSync,
  describeSyncFolder,
  describeUrgency,
  parseSettingsArgs,
  parseUrgencyFile,
  usage,
  type SettingsCommand,
} from "./mailbox-settings-args";

const ACTOR = "cli";

function printTable(out: CliRawOutput, before: SettingsSnapshot, after: SettingsSnapshot): void {
  const beforeLines = describeSettings(before);
  describeSettings(after).forEach((line, index) => {
    const old = beforeLines[index];
    if (old === line) {
      out.print(line);
      return;
    }
    out.print(`${old} -> ${line.slice(line.indexOf(":") + 2)}`);
  });
}

function printChange(out: CliRawOutput, result: SettingsChange): void {
  printTable(out, result.before, result.after);
  for (const warning of result.warnings) {
    out.print(`warning: ${warning}`);
  }
  if (!result.changed) {
    out.print("no change");
  }
  if (result.expired > 0 || result.closedGate) {
    out.print(`expired ${result.expired} ready actions and sends`);
  }
}

async function run(
  out: CliRawOutput,
  command: SettingsCommand,
  db: Db,
  now: Date,
  testMail: TestMailRule,
  gate: GateEvidenceDeps
): Promise<number> {
  // The same gate files and running key as the server, so the CLI is not stricter than the API (ADR 0028).
  const deps = settingsDeps(db, () => now, gate);
  const ctx = { orgId: command.orgId };
  const { mailboxId } = command;
  switch (command.kind) {
    case "show": {
      const view = await getSettingsView(deps, ctx, mailboxId);
      describeSettings(view).forEach((line) => out.print(line));
      out.print(describeUrgency(view.urgencyProfile));
      for (const row of await listSyncFolders(db, ctx, mailboxId, { enabledOnly: false })) {
        out.print(describeSyncFolder(row));
      }
      out.print(describeSentSync(await getSentSyncView(db, ctx, mailboxId, now)));
      return 0;
    }
    case "sent-sync": {
      const { result, deleted } = await setSentSync(
        db,
        ctx,
        mailboxId,
        { enabled: command.value, actor: ACTOR, at: now },
        sentSwitchHooks
      );
      if (result === "flag_off") {
        out.fail("sent sync: the organization flag sent_sync is off (turn it on with: bun run org:flag)");
        return 1;
      }
      if (result === "not_found") {
        out.fail("sent sync: no such mailbox in this organization");
        return 1;
      }
      if (result === "same") {
        out.print("no change");
        return 0;
      }
      out.print(`sent sync ${command.value ? "on" : "off"}`);
      if (!command.value) out.print(`deleted ${deleted} sent mails`);
      return 0;
    }
    case "urgency": {
      let profile: UrgencyProfile | null = null;
      if ("file" in command.source) {
        let text: string;
        try {
          text = await Bun.file(command.source.file).text();
        } catch {
          out.fail("cannot read the urgency file");
          return 1;
        }
        const parsed = parseUrgencyFile(text);
        if (!parsed.ok) {
          out.fail(`usage: ${usage}`);
          out.fail(
            parsed.reason === "not_json"
              ? "urgency file: not JSON"
              : `urgency file: schema errors at ${parsed.paths.join(", ")}`
          );
          return 1;
        }
        profile = parsed.profile;
      }
      const { changed, stored } = await setUrgencyProfile(db, ctx, mailboxId, profile, { via: "cli" });
      out.print(`${describeUrgency(stored)}${changed ? "" : " (no change)"}`);
      return 0;
    }
    case "sync-folder": {
      const result = await setSyncFolderEnabled(db, ctx, mailboxId, command.key, command.value, ACTOR, now);
      if (result === "not_found") {
        out.fail(`sync folder ${command.key}: no such folder row (the sync adds it when the server lists the folder)`);
        return 1;
      }
      out.print(
        `sync folder ${command.key}: ${command.value ? "on" : "off"} (${result === "changed" ? "changed" : "no change"})`
      );
      return 0;
    }
    case "mode": {
      const result = await setMode(deps, ctx, mailboxId, {
        mode: command.mode,
        keepSwitches: command.keepSwitches,
        actor: ACTOR,
      });
      printChange(out, result);
      return 0;
    }
    case "switch": {
      try {
        const result = await setToolSwitch(deps, ctx, mailboxId, {
          name: command.name,
          value: command.value,
          actor: ACTOR,
        });
        printChange(out, result);
        return 0;
      } catch (error) {
        // Reply drafts are for password IMAP mailboxes until Graph and Gmail get them.
        if (!(error instanceof OauthMailboxError)) throw error;
        out.fail("refused: oauth_mailbox (reply drafts are not available for an OAuth mailbox); nothing stored");
        return 1;
      }
    }
    case "auto": {
      const result = await autoSetter(deps, testMail)(ctx, mailboxId, {
        category: command.category,
        auto: command.value,
        force: command.force,
        ...(command.threshold === undefined ? {} : { threshold: command.threshold }),
        actor: ACTOR,
      });
      if (result.gate) {
        const { gate } = result;
        out.print(
          `go/no-go ${command.category}: ${gate.decision}, precision ${gate.precision ?? "n/a"}, kept ${gate.kept}, threshold ${gate.threshold ?? "n/a"}${command.force ? " FORCED" : ""}`
        );
      }
      if (result.kind === "refused") {
        const blocks = result.evidence?.blocks ?? [];
        out.fail(
          `refused: ${command.category} did not pass go/no-go${blocks.length > 0 ? ` (${blocks.join(", ")})` : ""} (use --force to set auto on anyway)`
        );
        return 1;
      }
      printChange(out, result.change);
      return 0;
    }
    case "expire-ready": {
      const expired = await db
        .transaction()
        .execute((trx) =>
          expireReady(trx, ctx, { mailboxId, types: MAILBOX_ACTION_TYPES }, { now, reason: "manual", actor: ACTOR })
        );
      out.print(`expired ${expired.length} ready actions`);
      out.print(`ready mailbox actions left: ${await countReadyOriginals(db, ctx, mailboxId)}`);
      return 0;
    }
  }
}

async function runCommand(command: SettingsCommand, out: CliRawOutput): Promise<number> {
  const config = loadConfig();

  configureMailHosts({ allowLocal: mailAllowLocal(config) });
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    return await run(out, command, db, new Date(), testMailRule(config), gateEvidenceOf(config, { quiet: true }));
  } finally {
    await db.destroy();
  }
}

// Parse first: a bad argument is a usage error (exit 2) before any config or DB. Any later error gets one line and its code.
const main: CliSpec["main"] = async (argv, out) => {
  const command = parseSettingsArgs(argv);
  try {
    return await runCommand(command, out);
  } catch (error) {
    return reportFailure(out, error, "label");
  }
};

if (import.meta.main) {
  await runCli({ prefix: "mailbox-settings", descriptions: cliDescriptions, main });
}
