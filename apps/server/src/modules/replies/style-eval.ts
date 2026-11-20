import { DAY_MS, STYLE_MAX_SOURCES, type StyleSource } from "@ea/core";

// The pure parts of the stylist eval: which sent mails of a part are sources, and the report. The eval reads made-up
// mail of the sim corpus, so the style text may stand in the report. A real style text never does.

/** The sent mails of the last 14 days are sources, as in production. */
export const STYLE_EVAL_WINDOW_DAYS = 14;

/** One mail of the sent bank, as the blind files hold it. */
export interface SentBankMail {
  sentAt: string;
  body: string;
  to: readonly string[];
  cc: readonly string[];
}

/**
 * The sources of a part. The sim has no "now": the window ends at the newest `sentAt` of the part and takes the mails
 * back to exactly 14 days before it. Newest first, at most `STYLE_MAX_SOURCES`. The sim mails have no origin, list id or
 * auto-submitted header, and every one is a user mail, so no other production filter applies.
 */
export function styleSourcesOf(mails: readonly SentBankMail[]): StyleSource[] {
  const times = mails.map((mail) => Date.parse(mail.sentAt));
  const newest = Math.max(...times);
  const since = newest - STYLE_EVAL_WINDOW_DAYS * DAY_MS;
  return mails
    .map((mail, index) => ({ mail, at: times[index] as number }))
    .filter(({ at }) => at >= since)
    .sort((a, b) => b.at - a.at)
    .slice(0, STYLE_MAX_SOURCES)
    .map(({ mail }) => ({ bodyText: mail.body, toAddresses: [...mail.to], ccAddresses: [...mail.cc] }));
}

export interface StyleReportInput {
  title: string;
  date: string;
  scenario: string;
  part: string;
  provider: string;
  endpoint: string;
  host: string | null;
  model: string;
  reasoningEffort: string | null;
  promptVersion: string;
  // The mails of the part inside the window, and the samples that the cut left.
  sourceCount: number;
  sampleCount: number;
  // The call outcome: the text and the check result, or the reason that no text came.
  checks: { ok: boolean; failures: readonly string[] };
  text: string;
  calls: number;
  spentUsd: number;
  capUsd: number | null;
}

const usd = (value: number): string => `$${value.toFixed(4)}`;

/** The report of one stylist run. The style text stands in a quote block of its own. */
export function renderStyleReport(report: StyleReportInput): string {
  return [
    `# ${report.title}`,
    "",
    `- date: ${report.date}`,
    "- role: stylist",
    `- scenario: ${report.scenario}`,
    `- part: ${report.part}`,
    `- model: ${report.model}`,
    `- provider: ${report.provider}`,
    `- endpoint: ${report.endpoint}${report.host === null ? "" : ` (${report.host})`}`,
    `- reasoning effort: ${report.reasoningEffort ?? "default"}`,
    `- prompt version: ${report.promptVersion}`,
    `- sources in the window: ${report.sourceCount}`,
    `- samples: ${report.sampleCount}`,
    `- calls: ${report.calls}`,
    `- checks: ${report.checks.ok ? "ok" : `failed (${report.checks.failures.join(", ")})`}`,
    `- cost: ${usd(report.spentUsd)} of cap ${report.capUsd === null ? "none (own endpoint)" : usd(report.capUsd)}`,
    "",
    "## Style text",
    "",
    report.text === ""
      ? "(no text)"
      : report.text
          .split("\n")
          .map((line) => `> ${line}`.trimEnd())
          .join("\n"),
    "",
  ].join("\n");
}
