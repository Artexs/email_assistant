// The shape of the gate files that the server reads at start (F110 stage 02). The types live here because the settings
// module (below triage in the layers) carries the index in its deps. The reader is `triage/evidence.ts`.
import type { BarCategory } from "../triage/metrics";

import type { GlobalEvidence } from "./evidence";
import type { EvidenceKey } from "./key";

/** One classifier gate file: the key it proves and its row per category. */
export interface GateIndexFile {
  key: EvidenceKey;
  /** The file name only. */
  file: string;
  /** The `date` field of the gate file. Newer wins (D2). */
  date: string;
  provisional: boolean;
  categories: Record<BarCategory, GlobalEvidence>;
}

/** Built once at start. */
export interface GateIndex {
  files: readonly GateIndexFile[];
}

/** What a caller needs to judge the global evidence of the running classifier. */
export interface GateEvidenceDeps {
  index: GateIndex;
  runningKey: EvidenceKey;
}
