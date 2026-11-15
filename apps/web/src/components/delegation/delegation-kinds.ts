import type { DelegationItem } from "@ea/core/web";

import { DelegationRow, type DelegationRowComponent } from "./DelegationRow";

// One row component per `item.kind` (E5b adds kinds and their tabs to the same page). A record: a new kind in the schema breaks the
// build until it has a component.
export const ROW_BY_KIND: Record<DelegationItem["kind"], DelegationRowComponent> = {
  delegation: DelegationRow,
};
