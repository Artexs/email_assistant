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
  type UserLocale,
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

/** Dollars: `$0.62` in English, `0,62 USD` in Polish (the decimal comma of the Polish pages). */
export function formatUsd(value: number, lang: UserLocale = "en"): string {
  return lang === "pl" ? `${value.toFixed(2).replace(".", ",")} USD` : `$${value.toFixed(2)}`;
}

/** The note under the table for a basis. The page never shows the model names of the pilot. */
export function basisNote(
  basis: CostToRun["basis"],
  pilot: Pick<typeof pilotCost, "weeks" | "measuredOn"> = pilotCost,
  lang: UserLocale = "en"
): string {
  const first = pilot.weeks[0];
  const last = pilot.weeks[pilot.weeks.length - 1];
  if (lang === "pl") {
    if (basis === "estimate") return "Szacunek: zmierzonych danych jest za mało.";
    return `Zmierzono w ${pilot.weeks.length} tygodniach (od ${first} do ${last}), dnia ${pilot.measuredOn}.`;
  }
  if (basis === "estimate") return "Estimate: the measured data is too small.";
  return `Measured over ${pilot.weeks.length} weeks (${first} to ${last}), on ${pilot.measuredOn}.`;
}

export const ROUNDING_NOTE = "Each amount is rounded to the cent, so the parts may not add up to the total.";
export const ROUNDING_NOTE_PL =
  "Każda kwota jest zaokrąglona do centa, więc części mogą nie sumować się do łącznej kwoty.";
export const roundingNote = (lang: UserLocale = "en"): string => (lang === "pl" ? ROUNDING_NOTE_PL : ROUNDING_NOTE);

export const hostSizeNote = (lang: UserLocale = "en"): string =>
  lang === "pl"
    ? `Hosting zakłada ${costModel.mailboxesPerHost} skrzynek na jednym serwerze.`
    : `Hosting assumes ${costModel.mailboxesPerHost} mailboxes per host.`;

/** The price for the plan card: whole dollars lose their cents (`$25`, `25 USD`), other prices keep two decimals. */
export const placeholderPrice = (
  lang: UserLocale = "en",
  priceUsd: number = PLACEHOLDER_PRICE_USD_PER_MAILBOX_MONTH
): string => formatUsd(priceUsd, lang).replace(/[.,]00(?= USD$|$)/, "");

export const PLACEHOLDER_PRICE = placeholderPrice("en");
