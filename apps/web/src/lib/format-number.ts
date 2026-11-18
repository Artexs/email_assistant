import { getLocale, t } from "../i18n";

// The one place that turns a number into display text. The digits are the same in every language (`toFixed`);
// only the decimal mark follows the language: a comma in Polish, a point in English.
const withMark = (text: string): string => (getLocale() === "pl" ? text.replace(".", ",") : text);

/** `value` with exactly `digits` decimals: 0.41 with 2 is "0.41" (Polish "0,41"). */
export function formatFixed(value: number, digits: number): string {
  return withMark(value.toFixed(digits));
}

/** `value` rounded to at most `digits` decimals, no trailing zero: 99.0 is "99", 99.1 is "99.1" (Polish "99,1"). */
export function formatTrimmed(value: number, digits: number): string {
  return withMark(Number(value.toFixed(digits)).toString());
}

/** A number the code already rounded (a `Math.floor` or a count) as text. */
export function formatNumber(value: number): string {
  return withMark(String(value));
}

/** US dollars, as the language writes them: "$0.41" in English, "0,41 USD" in Polish. */
export function formatUsd(value: number, digits: number): string {
  return t("money_usd", { amount: formatFixed(value, digits) });
}

/** A share of a whole as a whole percent: 1 of 3 is 33. The caller shows a dash for a total of 0. */
export function percentOf(count: number, total: number): number {
  return Math.round((count / total) * 100);
}

/** A ratio (0 to 1) as a whole percent. */
export function wholePercent(ratio: number): number {
  return Math.round(ratio * 100);
}
