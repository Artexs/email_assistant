// Reference numbers of the cost per mailbox (M7), with source and date, like llmPrices in triage/cost.ts.
export const costModel = {
  hostingUsdPerMonth: 7.1, // Hetzner CX23 €5.99 per month, the discovery notes §4 (checked 2026-11-10)
  mailboxesPerHost: 20, // assumption until the load test
  backupUsdPerMailboxMonth: 0.05, // assumption: B2 and domain, shared; the discovery notes §4 "< 0.1"
  targetUsdPerMailboxMonth: 5, // a product decision
  source: "docs/product/stage-2/epics/E03-discovery-notes.md §4",
  checked: "2026-11-13",
} as const;

/** Month = 30 days, like `monthlyCost` in triage/cost.ts. */
const DAYS_PER_MONTH = 30;

/** Hosting and backup share of one mailbox per month. `unitCost` (M7) and `costToRun` both call it. */
export function hostingAndBackupUsdPerMailboxMonth(mailboxesPerHost: number = costModel.mailboxesPerHost): {
  hostingUsd: number;
  backupUsd: number;
} {
  return {
    hostingUsd: costModel.hostingUsdPerMonth / mailboxesPerHost,
    backupUsd: costModel.backupUsdPerMailboxMonth,
  };
}

/**
 * The LLM cost of the pilot: the sums of the four finished `stats:week` runs of one organization (one window, one scope).
 * Source: `pilot-cost.md` in the folder of the papers-and-cost ticket (a read-only measurement on the VPS).
 */
export interface PilotCost {
  measuredOn: string;
  weeks: readonly string[]; // Monday of each week
  triagedMails: number; // `m4_handled` "of", summed
  llmUsd: number; // all priced LLM calls (plan, draft, test mail), summed
  llmCalls: number;
  unpricedCalls: number;
  models: readonly string[];
}

export const pilotCost: PilotCost = {
  measuredOn: "2026-11-19",
  weeks: ["2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09"],
  triagedMails: 87, // 6 + 5 + 26 + 50
  llmUsd: 0.0914, // 0 + 0 + 0.0658 + 0.0256
  llmCalls: 276, // 0 + 0 + 195 + 81
  unpricedCalls: 0,
  models: ["gemini-3.5-flash-lite", "gpt-6-luna"],
};

/** Classifier only, per mail: the E3 notes §4 (`docs/product/stage-2/epics/E03-discovery-notes.md`). */
export const E3_ESTIMATE_USD_PER_MAIL = 0.000143;

const MEASURED_MIN_MAILS = 100;
const MEASURED_MAX_UNPRICED_SHARE = 0.05;

export interface CostToRun {
  llmUsd: number;
  hostingUsd: number;
  backupUsd: number;
  totalUsd: number;
  basis: "measured" | "estimate";
}

/**
 * Cost per mailbox per month at a mail volume.
 * `measured`: `pilot.llmUsd / pilot.triagedMails` per mail (all LLM calls over the real triaged mails: an upper bound).
 * `estimate`: the E3 figure, when the pilot has under 100 triaged mails or over 5% unpriced calls.
 */
export function costToRun(mailsPerDay: number, opts: { mailboxesPerHost?: number; pilot?: PilotCost } = {}): CostToRun {
  const mailboxesPerHost = opts.mailboxesPerHost ?? costModel.mailboxesPerHost;
  const pilot = opts.pilot ?? pilotCost;
  if (!(mailsPerDay > 0)) throw new RangeError(`mailsPerDay must be above 0, got ${mailsPerDay}`);
  if (!(mailboxesPerHost > 0)) throw new RangeError(`mailboxesPerHost must be above 0, got ${mailboxesPerHost}`);
  const measured =
    pilot.triagedMails >= MEASURED_MIN_MAILS && pilot.unpricedCalls <= MEASURED_MAX_UNPRICED_SHARE * pilot.llmCalls;
  const usdPerMail = measured ? pilot.llmUsd / pilot.triagedMails : E3_ESTIMATE_USD_PER_MAIL;
  const llmUsd = usdPerMail * mailsPerDay * DAYS_PER_MONTH;
  const { hostingUsd, backupUsd } = hostingAndBackupUsdPerMailboxMonth(mailboxesPerHost);
  return {
    llmUsd,
    hostingUsd,
    backupUsd,
    totalUsd: llmUsd + hostingUsd + backupUsd,
    basis: measured ? "measured" : "estimate",
  };
}

export interface RoundedCostRow {
  llmUsd: number;
  hostingUsd: number;
  backupUsd: number;
  totalUsd: number;
  marginUsd: number;
}

/** Half up at the cent. The small shift keeps a value like 0.355 (stored a hair low) on the side the doc shows. */
function roundToCent(value: number): number {
  return Math.round((value + 1e-9) * 100) / 100;
}

/**
 * One rounding and margin rule for the pricing page and `docs/cost-model.md`: each value rounds half up to the cent;
 * the margin is the price minus the rounded total, so total + margin = price.
 */
export function roundedCostRow(cost: CostToRun, priceUsd: number): RoundedCostRow {
  const totalUsd = roundToCent(cost.totalUsd);
  return {
    llmUsd: roundToCent(cost.llmUsd),
    hostingUsd: roundToCent(cost.hostingUsd),
    backupUsd: roundToCent(cost.backupUsd),
    totalUsd,
    marginUsd: roundToCent(priceUsd - totalUsd),
  };
}
