import type { FeatureKey } from "../features";

// GET /api/operator/flags (F087, D18): ids, keys and booleans only.
export interface OperatorFlagRow {
  orgId: string;
  flag: FeatureKey;
  enabled: boolean;
}

export interface OperatorFlags {
  rows: OperatorFlagRow[];
}
