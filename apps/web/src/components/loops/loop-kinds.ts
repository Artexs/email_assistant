import type { LoopItem } from "@ea/core/web";

import { DelegatedRow, PromisedRow, WaitingRow, type LoopRowComponent } from "./LoopRow";

// One row component per `item.kind`, as `ROW_BY_KIND` of the delegations (a sibling map: `DelegationItem` and `LoopItem` are two
// lists). A record: a new kind in the schema breaks the build until it has a component.
export const LOOP_ROW_BY_KIND: Record<LoopItem["kind"], LoopRowComponent> = {
  waiting: WaitingRow,
  promised: PromisedRow,
  delegated: DelegatedRow,
};
