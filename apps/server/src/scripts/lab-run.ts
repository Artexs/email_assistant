import type { LiveRunPlan } from "@ea/core";

import {
  labEnvIssues,
  LabResetError,
  LabScoreError,
  LabSeedError,
  LAB_TARGETS,
  type LabCorpus,
  type LabEvent,
  type LabModel,
  type LabOrg,
  type LabState,
  previewReset,
  resetDemo,
  resetOrg,
  type ResetDeps,
  type RunSpend,
  type ServeStatus,
  type SeedResult,
  type SeedTarget,
  type StartDeps,
  LabMailError,
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
  // The models the stack is configured to call (roles the lab uses), each with the endpoint kind of its provider.
  models: readonly LabModel[];
  orgHasMail(orgId: string): Promise<boolean>;
  // What the reset needs from the database, the privacy delete and GreenMail; the rest of its deps come from this object.
  reset: Pick<ResetDeps, "lookupOrg" | "mail" | "deleteOrg">;
  // Makes or repairs the lab organization of the target.
  seed(target: SeedTarget): Promise<SeedResult>;
  // Stores the urgency profile of a started run on the org mailbox.
  storeUrgency(org: LabOrg, plan: LiveRunPlan): Promise<unknown>;
  spendOf(runId: string): Promise<RunSpend>;
  // Scores one run and writes the report files into `out`, or into the default folder when `out` is undefined.
  score(runId: string, out: string | undefined): Promise<{ markdown: string; json: string; partial: boolean }>;
  // The heartbeat file of the serve process, if it wrote one.
  serveStatus(): ServeStatus | undefined;
  // The serve loop: runs until a signal; returns the exit code.
  serve(): Promise<number>;
  now(): Date;
  hex4(): string;
  cli: CliOutput;
}

// A later stage fills each of these; until then the command exits 1.
const NOT_BUILT: readonly LabCommand["kind"][] = ["demo-export", "demo-import"];

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
  const serve = deps.serveStatus();
  const counts = Object.entries(serve?.runs[runId] ?? {})
    .map(([part, n]) => `${part} ${n}`)
    .join(" ");
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
    ...(serve === undefined || stopped !== undefined
      ? []
      : [`serve tick ${serve.tickAt}${counts === "" ? "" : ` · fails ${counts}`}`]),
  ].join(" · ");
}

const startDepsOf = (deps: LabDeps): StartDeps => ({
  state: deps.state,
  corpus: deps.corpus,
  models: deps.models,
  orgHasMail: deps.orgHasMail,
  storeUrgency: deps.storeUrgency,
  now: deps.now,
  hex4: deps.hex4,
});

const resetDepsOf = (deps: LabDeps): ResetDeps => ({
  ...deps.reset,
  targets: LAB_TARGETS,
  state: deps.state,
  seed: deps.seed,
  spendOf: deps.spendOf,
  start: (input) => startLabRun(input, startDepsOf(deps)),
  now: deps.now,
});

// `reset` and `demo-reset` delete data: without `--yes` they print what they would delete and exit 1.
async function runReset(
  command: Extract<LabCommand, { kind: "reset" | "demo-reset" }>,
  deps: LabDeps
): Promise<number> {
  const { cli } = deps;
  const key = command.kind === "reset" ? command.org : "demo";
  const resetDeps = resetDepsOf(deps);
  try {
    if (!command.yes) {
      const preview = await previewReset(resetDeps, key);
      cli.print(
        `reset ${key}: would delete org ${preview.orgId ?? "none"} and ${preview.messages} mails of ${preview.mailbox}`
      );
      cli.fail("refused: confirm_needed");
      return 1;
    }
    if (command.kind === "reset") {
      const { orgId, deleted } = await resetOrg(resetDeps, command.org);
      cli.print(`reset: ${command.org} org ${orgId} ${deleted ? "rebuilt" : "created"}`);
    } else {
      const { orgId, runId } = await resetDemo(
        resetDeps,
        command.date === undefined ? {} : { startDate: command.date }
      );
      cli.print(`demo-reset: org ${orgId} run ${runId}`);
    }
    return 0;
  } catch (error) {
    if (error instanceof LabResetError) {
      cli.fail(`refused: ${error.code}${error.detail === undefined ? "" : ` (${error.detail})`}`);
      return 1;
    }
    if (error instanceof LabSeedError || error instanceof LabMailError) {
      cli.fail(`refused: ${error.code}`);
      return 1;
    }
    throw error;
  }
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
        startDepsOf(deps)
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
    case "score": {
      if (!state.listRuns().includes(command.runId)) {
        cli.fail("refused: no_such_run");
        return 1;
      }
      try {
        const written = await deps.score(command.runId, command.out);
        cli.print(
          `score: ${command.runId}${written.partial ? " partial" : ""} report ${written.markdown} json ${written.json}`
        );
        return 0;
      } catch (error) {
        if (error instanceof LabScoreError) {
          cli.fail(`refused: ${error.code}`);
          return 1;
        }
        throw error;
      }
    }
    case "reset":
    case "demo-reset":
      return runReset(command, deps);
    case "serve":
      return deps.serve();
    default:
      return 1;
  }
}
