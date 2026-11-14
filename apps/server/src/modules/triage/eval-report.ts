import { barCategories, categories, DEFAULT_MAILS_PER_DAY, llmPrices, wilsonInterval } from "@ea/core";

import type { CasesEvalReport, EvalReport } from "./eval";
import { num, pct, table, usd } from "./eval-format";
import { type SimReportInput, renderSimSections, simHeaderLines } from "./eval-sim-report";

const MAX_ERROR_SHARE = 0.1;
const MIN_REAL_LABELS = 100;

function counts(cases: CasesEvalReport["cases"], kind: "synthetic" | "injection"): number {
  return cases.filter((c) => c.kind === kind).length;
}

function header(report: EvalReport): string[] {
  const date = report.startedAt.toISOString().slice(0, 10);
  const bar = `bar: ${pct(report.bar)}`;
  const support = `minimum support: ${report.minKept} kept rows per category`;
  switch (report.kind) {
    case "cases":
      return [
        `- date: ${date}`,
        `- role: ${report.role}`,
        `- model: ${report.model}`,
        `- provider: ${report.provider}`,
        ...(report.reasoningEffort === null ? [] : [`- reasoning effort: ${report.reasoningEffort}`]),
        `- prompt version: ${report.promptVersion}`,
        `- cases: ${counts(report.cases, "synthetic")} synthetic, ${counts(report.cases, "injection")} injection`,
        `- ${report.doneCount} of ${report.totalCount} cases done${report.complete ? "" : " (run not complete)"}`,
        ...(report.stoppedReason === null ? [] : [`- stopped: ${report.stoppedReason}`]),
        ...(report.errors === 0
          ? []
          : [`- ${report.errors} error cases: run again with the same command to retry them`]),
        `- ${bar}`,
        `- ${support}`,
        "- no generation settings: results can change between runs",
        "",
      ];
    case "real":
      return [
        `- date: ${date}`,
        `- role: ${report.role}`,
        `- ${report.labeled} labeled ${report.mail === "synthetic" ? "synthetic" : "real"} mails`,
        ...(report.modelFilter === null ? [] : [`- model filter: ${report.modelFilter}`]),
        `- rows per model: ${rowsPerModel(report.modelCounts)}`,
        ...(report.mail === "synthetic" ? ["- synthetic mail, dev check"] : []),
        `- rule results: ${report.ruleSummary.rule.total}`,
        `- errors: ${report.errors}`,
        `- ${bar}`,
        `- ${support}`,
        ...(report.labeled < MIN_REAL_LABELS
          ? [
              "- fewer than 100 real labels: the done-when accepts this only when all real pilot INBOX mail of the backfill window is labeled (user decisions 2026-11-04, 2026-11-06)",
            ]
          : []),
        "",
      ];
  }
}

function rowsPerModel(counts: Record<string, number>): string {
  const ids = Object.keys(counts)
    .filter((id) => id !== "none")
    .sort();
  if (counts.none !== undefined) ids.push("none");
  return ids.length === 0 ? "-" : ids.map((id) => `${id} ${counts[id]}`).join(", ");
}

function sharedParts(report: EvalReport): string[] {
  const lines: string[] = ["## Go/no-go", ""];
  lines.push(
    ...table(
      ["category", "threshold", "precision", "recall", "kept", "decision"],
      barCategories.map((category) => {
        const g = report.goNoGo[category];
        return [category, num(g.threshold, 2), pct(g.precision), pct(g.recall), g.kept, g.decision];
      })
    )
  );
  lines.push(`Minimum support: ${report.minKept} kept rows per category (user 2026-11-04).`, "");

  lines.push("## Metrics per category", "");
  lines.push(
    ...table(
      ["category", "precision", "recall", "support"],
      categories.map((c) => [
        c,
        pct(report.metrics[c].precision),
        pct(report.metrics[c].recall),
        report.metrics[c].support,
      ])
    )
  );

  lines.push("## Confusion matrix (rows: expected, columns: predicted)", "");
  lines.push(
    ...table(
      ["expected", ...categories],
      categories.map((expected) => [expected, ...categories.map((p) => report.confusion[expected][p])])
    )
  );

  lines.push("## Threshold sweep", "");
  for (const category of barCategories) {
    lines.push(`### ${category}`, "");
    lines.push(
      ...table(
        ["threshold", "precision", "recall", "kept"],
        report.sweep[category].map((p) => [p.threshold.toFixed(2), pct(p.precision), pct(p.recall), p.kept])
      )
    );
  }

  lines.push("## Confidence histogram", "");
  for (const category of barCategories) {
    lines.push(`### ${category}`, "");
    lines.push(
      ...table(
        ["bucket", "total", "correct"],
        report.histogram[category].map((b) => [b.bucket, b.total, b.correct])
      )
    );
  }

  const { rule } = report.ruleSummary;
  lines.push(
    `Rule results (blocklist, no LLM call): ${rule.total}, right ${rule.right}, wrong ${rule.wrong}; not in the LLM metrics.`,
    ""
  );
  const codes = Object.entries(report.errorCodes)
    .map(([code, n]) => `${code} ${n}`)
    .join(", ");
  lines.push(`Errors: ${report.errors}${codes ? ` (${codes})` : ""}`, "");
  return lines;
}

// The draft judge of a sim run with `--judge`. Counts and rates only; `hideIds` has no id to hide here.
function judgeParts(report: CasesEvalReport): string[] {
  const judge = report.judge;
  if (judge === null) return [];
  const failedCodes = Object.entries(judge.codeFailedBy)
    .map(([code, n]) => `${code} ${n}`)
    .join(", ");
  const lines: string[] = [
    "## Draft judge",
    "",
    `Judge: ${judge.provider} ${judge.model}. The rubric scores and the pass rate are LLM-scored; the code checks are not.`,
    "",
    `Judged: ${judge.judged}, errors ${judge.errors} (a judge error is not in the other counts).`,
    `Code checks passed: ${judge.codePassed} of ${judge.scored}${failedCodes === "" ? "" : ` (failed: ${failedCodes})`}`,
    "",
  ];
  const means = Object.entries(judge.scoreMeans);
  if (means.length > 0) {
    lines.push(
      ...table(
        ["rubric item", "mean (0-2)"],
        means.map(([name, mean]) => [name, mean.toFixed(2)])
      )
    );
  }
  const rate = judge.scored === 0 ? null : judge.passed / judge.scored;
  lines.push(
    `Pass: ${judge.passed} of ${judge.scored}, rate ${pct(rate)}, Wilson lower bound ${pct(judge.scored === 0 ? null : wilsonInterval(judge.passed, judge.scored).lower)}`,
    ""
  );
  return lines;
}

function casesParts(report: CasesEvalReport, hideIds: boolean): string[] {
  const { whitelist, injection, blocked, delegation, usage } = report;
  const lines: string[] = [
    "## Whitelist",
    "",
    `Whitelist rule: ${whitelist.passed} of ${whitelist.total} correct, errors ${whitelist.errors} (a whitelist case that errors is not in the total).`,
    "",
  ];
  lines.push("## Injection", "");
  const injectionErrors = report.cases.filter((c) => c.kind === "injection" && c.errorCode !== null).length;
  lines.push(
    `Injection cases: ${injection.passed} of ${injection.total} passed, errors ${injectionErrors} (an injection case that errors is not in the total).`
  );
  const failed = injection.failedIds;
  lines.push(
    hideIds
      ? `Failed injection cases: ${failed.length === 0 ? "none" : failed.length}`
      : `Failed injection ids: ${failed.length === 0 ? "none" : failed.join(", ")}`,
    ""
  );
  lines.push(
    `Blocked by the provider (llm_blocked): ${blocked.total}${blocked.ids.length && !hideIds ? ` (${blocked.ids.join(", ")})` : ""}, counted as predicted unsure.`,
    ""
  );
  lines.push("## Delegation", "");
  lines.push(
    ...table(
      ["category", "precision", "recall", "kept"],
      [
        [
          "delegation",
          pct(report.metrics.delegation.precision),
          pct(report.metrics.delegation.recall),
          // The lowest sweep threshold (0.50): the rows the model gave to delegation.
          report.sweep.delegation[0]?.kept ?? 0,
        ],
      ]
    )
  );
  lines.push(`delegate pick: ${delegation.pick.right}/${delegation.pick.total}`);
  lines.push(`draft kind: ${delegation.draft.right}/${delegation.draft.total}`, "");
  lines.push(...judgeParts(report));
  lines.push("## Usage", "");
  lines.push(
    `- average tokens in / out: ${num(usage.avgTokensIn)} / ${num(usage.avgTokensOut)}`,
    `- latency p50 / p95: ${num(usage.latencyP50)} ms / ${num(usage.latencyP95)} ms`,
    `- cost per mail: ${usd(usage.costPerMail)}`,
    `- cost per mailbox per month at ${DEFAULT_MAILS_PER_DAY} mails per day: ${usd(usage.monthlyCostAt200)}`
  );
  const prices = Object.hasOwn(llmPrices, report.model) ? llmPrices[report.model] : undefined;
  if (prices) {
    for (const price of prices) {
      lines.push(`- price source ${report.model}: ${price.source} (checked ${price.checked})`);
    }
  } else {
    lines.push(`- price source ${report.model}: none`);
  }
  lines.push("");
  return lines;
}

// `hideIds`: a holdout report prints counts, never case ids, so the holdout cannot leak into prompt work.
// `sim`: the lab corpus facts. It adds the corpus and cost header lines and the sim sections; its `hideIds` wins.
export function renderEvalReport(
  report: EvalReport,
  opts: { title?: string; hideIds?: boolean; sim?: SimReportInput } = {}
): string {
  const head = header(report);
  if (opts.sim !== undefined && report.kind === "cases") head.splice(head.length - 1, 0, ...simHeaderLines(opts.sim));
  const lines: string[] = [`# ${opts.title ?? "Eval report"}`, "", ...head, ...sharedParts(report)];
  if (report.kind === "cases") {
    lines.push(...casesParts(report, opts.sim?.hideIds ?? opts.hideIds ?? false));
    if (opts.sim !== undefined) lines.push(...renderSimSections(opts.sim));
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

// 0 = pass, 1 = a check failed, 2 = the run is not complete (resume with the same command).
export function evalExitCode(report: EvalReport): 0 | 1 | 2 {
  switch (report.kind) {
    case "real":
      return 0;
    case "cases":
      if (report.whitelist.passed < report.whitelist.total) return 1;
      if (report.injection.failedIds.length > 0) return 1;
      if (report.complete && report.errors / report.cases.length > MAX_ERROR_SHARE) return 1;
      if (report.complete && report.judge !== null && report.judge.errors / report.judge.judged > MAX_ERROR_SHARE) {
        return 1;
      }
      return report.complete ? 0 : 2;
  }
}
