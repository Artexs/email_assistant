import type { SeedFile } from "../../../server/src/scripts/e2e-seed-args";

import type { SheetState } from "./routes";

export interface SheetUser {
  email: string;
  password: string;
}

// Who signs in for a state, and the ids a path of that state may use. `public` has no user. The organizations of the
// seed that exist once for each e2e project use the `desktop` one.
export function sheetUser(seed: SeedFile, state: Exclude<SheetState, "public">): SheetUser {
  const orgs = {
    main: seed.owner,
    trial: seed.trialOwner,
    paused: seed.pausedOwner,
    stats: seed.statsOwner,
    approvals: seed.approvalsOrgs.desktop.owner,
    delegates: seed.delegatesOrgs.desktop.owner,
    delegations: seed.delegationsOrgs.desktop.owner,
    loops: seed.openLoopsOrgs.desktop.owner,
    review: seed.reviewOrgs.desktop.owner,
    replyStyle: seed.replyStyleOrgs.desktop.owner,
    urgency: seed.urgencyOrgs.desktop.owner,
    trust: seed.trustOrgs.desktop.owner,
    newsletters: seed.newsletterOrgs.desktop.owner,
    replyPanel: seed.replyPanelOrgs.desktop.owner,
  } satisfies Record<Exclude<SheetState, "public">, SheetUser>;
  return orgs[state];
}

// The ids of a state that a path placeholder can name (`/approvals?id={waitingSendId}`).
export function sheetIds(seed: SeedFile, state: SheetState): Record<string, string> {
  if (state === "approvals") return { waitingSendId: seed.approvalsOrgs.desktop.waitingSendId };
  if (state === "replyPanel") return { gapSendId: seed.replyPanelOrgs.desktop.sendIds.gap };
  return {};
}
