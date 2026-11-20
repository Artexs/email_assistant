import type { SentPart } from "@ea/core";

// The options of a stylist run: `--sim <scenario> --part sent-dev|sent-holdout --stylist` or
// `--set style-injection --stylist`. The stylist makes one call (with one retry of its own), so no run option of the
// case pools (`--limit`, `--retries`, `--concurrency`, `--rpm`, `--fresh`, `--state`) and no judge applies.
export const STYLE_INJECTION_SET = "style-injection";

const stylistAllowed = new Set<string>([
  "stylist",
  "stylist-prompt",
  "sim",
  "part",
  "set",
  "provider",
  "model",
  "reasoning-effort",
  "budget-usd",
  "spend-ledger",
  "out",
]);

/** True when the options are a valid stylist run. `values` holds the flags that the user passed. */
export function stylistArgsValid(
  data: { sim?: string; sentPart?: SentPart; set: string },
  values: Record<string, unknown>
): boolean {
  if (Object.keys(values).some((key) => !stylistAllowed.has(key))) return false;
  const corpus = data.sim !== undefined;
  const set = values.set !== undefined;
  // Exactly one source: a part of the sent bank, or the injection set.
  if (corpus === set) return false;
  if (corpus) return data.sentPart !== undefined;
  return data.set === STYLE_INJECTION_SET && values.part === undefined;
}
