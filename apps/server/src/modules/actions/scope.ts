import type { ClaimFilter } from "./repo";

// D8: `off` = no mailbox change; `synthetic` = synthetic mail only; `all` = every mail of one test mailbox.
export type ActionsScope = { kind: "off" } | { kind: "synthetic" } | { kind: "all"; mailboxAddress: string };

// Pure. The committer and the Undo tap use it. `all` gives no mailbox change in any other mailbox.
export function claimFilterFor(scope: ActionsScope, mailboxAddress: string): ClaimFilter {
  if (scope.kind === "off") return { kind: "none" };
  if (scope.kind === "synthetic") return { kind: "synthetic" };
  return scope.mailboxAddress.toLowerCase() === mailboxAddress.toLowerCase() ? { kind: "all" } : { kind: "none" };
}
