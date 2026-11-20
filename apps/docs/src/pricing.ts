// The data of the pricing page. The cost table is `costToRun` at three volumes, rounded by `roundedCostRow`,
// the one rounding and margin rule that `docs/cost-model.md` and its test share. The price is one constant in `@ea/core`.
import {
  costModel,
  costToRun,
  PLACEHOLDER_PRICE_USD_PER_MAILBOX_MONTH,
  pilotCost,
  roundedCostRow,
  type CostToRun,
  type RoundedCostRow,
} from "@ea/core";

export const PRICING_MAILS_PER_DAY = [50, 100, 200] as const;

export interface CostRow extends RoundedCostRow {
  mailsPerDay: (typeof PRICING_MAILS_PER_DAY)[number];
}

export type CostCompute = (mailsPerDay: number) => CostToRun;

/** The three rows of the table, at the default host size. */
export function costRows(compute: CostCompute = costToRun): CostRow[] {
  return PRICING_MAILS_PER_DAY.map((mailsPerDay) => ({
    mailsPerDay,
    ...roundedCostRow(compute(mailsPerDay), PLACEHOLDER_PRICE_USD_PER_MAILBOX_MONTH),
  }));
}

/** The basis of the table: all rows share the pilot block, so one value. */
export function costBasis(compute: CostCompute = costToRun): CostToRun["basis"] {
  return compute(PRICING_MAILS_PER_DAY[0]).basis;
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** The note under the table for a basis. The page never shows the model names of the pilot. */
export function basisNote(
  basis: CostToRun["basis"],
  pilot: Pick<typeof pilotCost, "weeks" | "measuredOn"> = pilotCost
): string {
  if (basis === "estimate") return "Estimate: the measured data is too small.";
  return `Measured over ${pilot.weeks.length} weeks (${pilot.weeks[0]} to ${pilot.weeks[pilot.weeks.length - 1]}), on ${pilot.measuredOn}.`;
}

export const ROUNDING_NOTE = "Each amount is rounded to the cent, so the parts may not add up to the total.";

export const hostSizeNote = (): string => `Hosting assumes ${costModel.mailboxesPerHost} mailboxes per host.`;

export const PLACEHOLDER_PRICE = formatUsd(PLACEHOLDER_PRICE_USD_PER_MAILBOX_MONTH).replace(/\.00$/, "");
