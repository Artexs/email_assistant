import type { Provider } from "./oauth";
import type { Row } from "./rows-core";
import { GOOGLE_ROWS } from "./rows-google";
import { MICROSOFT_ROWS, PERSONAL_ROWS } from "./rows-microsoft";

export { combine, newCtx, type Ctx, type Deps, type Outcome, type Row, type SpikeEnv, type Verdict } from "./rows-core";

/** The rows of one provider, in run order. Each row needs the rows before it; a missing step gives SKIP, not a crash. */
export function rowsFor(provider: Provider): Row[] {
  switch (provider) {
    case "microsoft":
      return MICROSOFT_ROWS;
    case "microsoft-personal":
      return PERSONAL_ROWS;
    case "google":
      return GOOGLE_ROWS;
  }
}
