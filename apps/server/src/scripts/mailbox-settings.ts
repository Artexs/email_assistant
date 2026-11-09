import { describeSettings, MAILBOX_ACTION_TYPES, type SettingsSnapshot } from "@ea/core";

import { countReadyOriginals, expireReady } from "../modules/actions";
import {
  getSettingsView,
  setCategoryAuto,
  setMode,
  setToolSwitch,
  type SettingsChange,
  type SettingsDeps,
} from "../modules/config";
import { delegationHooks } from "../modules/delegation";
import { listSyncFolders, mailboxHasUidplus, setSyncFolderEnabled } from "../modules/mail";
import { buildRealReport, listLabeledResults } from "../modules/triage";
import { loadConfig } from "../platform/config";
import { assertAppRole, createDb, type Db } from "../platform/db";
import { describeError } from "../platform/errors";
import { createLog } from "../platform/log";

import { describeSyncFolder, parseSettingsArgs, usage, type SettingsCommand } from "./mailbox-settings-args";

const log = createLog("mailbox-settings");

const ACTOR = "cli";
const BAR = 0.98;
const MIN_KEPT = 30;

// Exit code 2: the go/no-go gate refused the change.
class GateRefusal extends Error {}

function printTable(before: SettingsSnapshot, after: SettingsSnapshot): void {
  const beforeLines = describeSettings(before);
  describeSettings(after).forEach((line, index) => {
    const old = beforeLines[index];
    if (old === line) {
      log.info(line);
      return;
    }
    log.info(`${old} -> ${line.slice(line.indexOf(":") + 2)}`);
  });
}

function printChange(result: SettingsChange): void {
  printTable(result.before, result.after);
  for (const warning of result.warnings) {
    log.info(`warning: ${warning}`);
  }
  if (!result.changed) {
    log.info("no change");
  }
  if (result.expired > 0 || result.closedGate) {
    log.info(`expired ${result.expired} ready actions and sends`);
  }
}

async function run(command: SettingsCommand, db: Db, now: Date): Promise<number> {
  const hooks = delegationHooks({ db });
  const deps: SettingsDeps = {
    db,
    now: () => now,
    expireReady: async (trx, trxCtx, filter, opts) =>
      expireReady(trx, trxCtx, filter, {
        ...opts,
        sendClose: { hooks, uidplus: await mailboxHasUidplus(trx, trxCtx, filter.mailboxId) },
      }),
  };
  const ctx = { orgId: command.orgId };
  const { mailboxId } = command;
  switch (command.kind) {
    case "show": {
      const view = await getSettingsView(deps, ctx, mailboxId);
      describeSettings(view).forEach((line) => log.info(line));
      for (const row of await listSyncFolders(db, ctx, mailboxId, { enabledOnly: false })) {
        log.info(describeSyncFolder(row));
      }
      return 0;
    }
    case "sync-folder": {
      const result = await setSyncFolderEnabled(db, ctx, mailboxId, command.key, command.value, ACTOR, now);
      if (result === "not_found") {
        log.error(`sync folder ${command.key}: no such folder row (the sync adds it when the server lists the folder)`);
        return 1;
      }
      log.info(
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
      printChange(result);
      return 0;
    }
    case "switch": {
      const result = await setToolSwitch(deps, ctx, mailboxId, {
        name: command.name,
        value: command.value,
        actor: ACTOR,
      });
      printChange(result);
      return 0;
    }
    case "auto": {
      let gate: Parameters<typeof setCategoryAuto>[3]["gate"] = {
        decision: "skipped",
        precision: null,
        kept: 0,
        forced: false,
      };
      let threshold = command.threshold;
      if (command.value) {
        const rows = await listLabeledResults(db, ctx, mailboxId, { mail: "real" });
        const report = buildRealReport(rows, { bar: BAR, minKept: MIN_KEPT, mail: "real", now });
        const row = report.goNoGo[command.category];
        log.info(
          `go/no-go ${command.category}: ${row.decision}, precision ${row.precision ?? "n/a"}, kept ${row.kept}, threshold ${row.threshold ?? "n/a"}${command.force ? " FORCED" : ""}`
        );
        if (row.decision !== "go" && !command.force) {
          log.error(`refused: ${command.category} did not pass go/no-go (use --force to set auto on anyway)`);
          throw new GateRefusal();
        }
        gate = { decision: row.decision, precision: row.precision, kept: row.kept, forced: command.force };
        threshold ??= row.decision === "go" ? (row.threshold ?? undefined) : undefined;
      }
      const result = await setCategoryAuto(deps, ctx, mailboxId, {
        category: command.category,
        auto: command.value,
        ...(threshold === undefined ? {} : { threshold }),
        gate,
        actor: ACTOR,
      });
      printChange(result);
      return 0;
    }
    case "expire-ready": {
      const expired = await db
        .transaction()
        .execute((trx) =>
          expireReady(trx, ctx, { mailboxId, types: MAILBOX_ACTION_TYPES }, { now, reason: "manual", actor: ACTOR })
        );
      log.info(`expired ${expired.length} ready actions`);
      log.info(`ready mailbox actions left: ${await countReadyOriginals(db, ctx, mailboxId)}`);
      return 0;
    }
  }
}

async function main(): Promise<number> {
  const command = parseSettingsArgs(process.argv.slice(2));
  if (!command) {
    log.error(usage);
    return 1;
  }

  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    return await run(command, db, new Date());
  } catch (error) {
    if (error instanceof GateRefusal) {
      return 2;
    }
    log.error("failed:", describeError(error));
    return 1;
  } finally {
    await db.destroy();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    log.error("failed:", describeError(error));
    process.exit(1);
  });
