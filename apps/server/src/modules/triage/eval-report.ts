import { barCategories, categories, DEFAULT_MAILS_PER_DAY, llmPrices } from "@ea/core";

import type { CasesEvalReport, EvalReport } from "./eval";

const MAX_ERROR_SHARE = 0.1;
const MIN_REAL_LABELS = 100;

const pct = (value: number | null): string => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);
const num = (value: number | null, digits = 0): string => (value === null ? "n/a" : value.toFixed(digits));
const usd = (value: number | null): string => (value === null ? "n/a" : `$${value.toFixed(6)}`);
const row = (cells: (string | number)[]): string => `| ${cells.join(" | ")} |`;

function table(head: string[], rows: (string | number)[][]): string[] {
  return [row(head), row(head.map(() => "---")), ...rows.map(row), ""];
}

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

function casesParts(report: CasesEvalReport): string[] {
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
  lines.push(`Failed injection ids: ${injection.failedIds.length === 0 ? "none" : injection.failedIds.join(", ")}`, "");
  lines.push(
    `Blocked by the provider (llm_blocked): ${blocked.total}${blocked.ids.length ? ` (${blocked.ids.join(", ")})` : ""}, counted as predicted unsure.`,
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

export function renderEvalReport(report: EvalReport, opts: { title?: string } = {}): string {
  const lines: string[] = [`# ${opts.title ?? "Eval report"}`, "", ...header(report), ...sharedParts(report)];
  if (report.kind === "cases") lines.push(...casesParts(report));
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
      return report.complete ? 0 : 2;
  }
}
