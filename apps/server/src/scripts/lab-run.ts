import type { LiveRunPlan } from "@ea/core";

import {
  labEnvIssues,
  LabSeedError,
  LAB_TARGETS,
  type LabCorpus,
  type LabEvent,
  type LabOrg,
  type LabState,
  type RunSpend,
  type SeedResult,
  type SeedTarget,
  startLabRun,
  stopLabRun,
} from "../modules/lab";
import type { CliOutput } from "../platform/cli";

import type { LabCommand } from "./lab-args";

// Everything the commands need from the outside, so a test fills it with fakes: no DB, no clock, no LLM.
export interface LabDeps {
  env: Record<string, string | undefined>;
  state: LabState;
  corpus: LabCorpus;
  // The models the stack is configured to call (roles the lab uses).
  models: readonly string[];
  orgHasMail(orgId: string): Promise<boolean>;
  // Makes or repairs the lab organization of the target.
  seed(target: SeedTarget): Promise<SeedResult>;
  // Stores the urgency profile of a started run on the org mailbox.
  storeUrgency(org: LabOrg, plan: LiveRunPlan): Promise<unknown>;
  spendOf(runId: string): Promise<RunSpend>;
  now(): Date;
  hex4(): string;
  cli: CliOutput;
}

// A later stage fills each of these; until then the command exits 1.
const NOT_BUILT: readonly LabCommand["kind"][] = [
  "reset",
  "serve",
  "score",
  "demo-reset",
  "demo-export",
  "demo-import",
];

const usdText = (spend: RunSpend): string =>
  spend.kind === "unpriced"
    ? `unpriced (${spend.unpricedCalls} calls, priced part $${spend.usd.toFixed(4)})`
    : `$${spend.usd.toFixed(4)}`;

function count(events: readonly (LabEvent & { loggedAt: string })[], pick: (event: LabEvent) => boolean): number {
  return events.filter(pick).length;
}

async function statusLine(deps: LabDeps, runId: string): Promise<string> {
  const run = deps.state.readRun(runId);
  const events = deps.state.events(runId);
  const stopped = events.find((event) => event.t === "stopped");
  const spend = await deps.spendOf(runId);
  return [
    `run ${runId} org ${run.org} cap $${run.capUsd.toFixed(2)}`,
    `planned ${run.plan.items.length}`,
    `injected ${count(events, (e) => e.t === "inject_done")}`,
    `late ${count(events, (e) => e.t === "inject_done" && (e.lateBySec ?? 0) > 0)}`,
    `replies ${count(events, (e) => e.t === "bot_done")}`,
    `taps ${count(events, (e) => e.t === "tap_done")}`,
    `skips ${count(events, (e) => e.t === "skip")}`,
    `spend ${usdText(spend)}`,
    `stopped ${stopped?.t === "stopped" ? stopped.reason : "no"}`,
  ].join(" · ");
}

// Returns the exit code: 0 ok, 1 refusal or failure. It prints ids, codes and counts only.
export async function runLabCommand(command: LabCommand, deps: LabDeps): Promise<number> {
  const { cli, state } = deps;
  // `demo-import` has its own guard (it runs on a dev machine); every other command refuses on a bad env.
  if (command.kind !== "demo-import") {
    const issues = labEnvIssues(deps.env, deps.corpus);
    if (issues.length > 0) {
      cli.fail(`refused: env is not the sim stack: ${issues.join(", ")}`);
      return 1;
    }
  }
  if (NOT_BUILT.includes(command.kind)) {
    cli.fail(`${command.kind}: not built`);
    return 1;
  }

  switch (command.kind) {
    case "seed": {
      try {
        const { org, created, added } = await deps.seed(LAB_TARGETS[command.org]);
        const link = added.linked ? "linked" : added.relinked ? "relinked" : "ok";
        cli.print(
          [
            `seed: ${created ? "created" : "exists"} ${command.org} org ${org.orgId} mailbox ${org.mailboxId} chat ${org.chatId}`,
            `added mailbox ${added.mailbox} delegates ${added.delegates} rules ${added.rules} flags ${added.flags}`,
            `link ${link}`,
          ].join(" · ")
        );
        return 0;
      } catch (error) {
        if (error instanceof LabSeedError) {
          cli.fail(`refused: ${error.code}`);
          return 1;
        }
        throw error;
      }
    }
    case "start": {
      const result = await startLabRun(
        {
          mode: command.mode,
          org: command.org,
          reuse: command.reuse,
          ...(command.date === undefined ? {} : { date: command.date }),
          ...(command.capUsd === undefined ? {} : { capUsd: command.capUsd }),
        },
        {
          state,
          corpus: deps.corpus,
          models: deps.models,
          orgHasMail: deps.orgHasMail,
          storeUrgency: deps.storeUrgency,
          now: deps.now,
          hex4: deps.hex4,
        }
      );
      if (result.kind === "refused") {
        cli.fail(`refused: ${result.code}${result.detail === undefined ? "" : ` (${result.detail})`}`);
        return 1;
      }
      const { plan, org, capUsd } = result.run;
      cli.print(`started ${plan.runId} org ${org} cap $${capUsd.toFixed(2)} slots ${plan.items.length}`);
      return 0;
    }
    case "status": {
      const ids = command.runId === undefined ? state.listRuns() : [command.runId];
      if (command.runId !== undefined && !state.listRuns().includes(command.runId)) {
        cli.fail("refused: no_such_run");
        return 1;
      }
      if (ids.length === 0) cli.print("no runs");
      for (const runId of ids) cli.print(await statusLine(deps, runId));
      return 0;
    }
    case "stop": {
      if (!state.listRuns().includes(command.runId)) {
        cli.fail("refused: no_such_run");
        return 1;
      }
      const spend = await deps.spendOf(command.runId);
      const { ledgerWritten } = stopLabRun(state, command.runId, spend.usd, deps.now());
      cli.print(
        `stopped: operator ${command.runId} spend ${usdText(spend)} ledger ${ledgerWritten ? "line written" : "line already there"}`
      );
      return 0;
    }
    default:
      return 1;
  }
}
