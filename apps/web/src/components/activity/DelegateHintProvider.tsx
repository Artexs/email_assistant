import { MINUTE_MS, type MailboxView } from "@ea/core/web";
import { createContext, useContext, useEffect, type ReactNode } from "react";

import { delegateHintWanted, loadDelegateHint, type DelegateHint } from "../../lib/delegate-action";
import { useResource } from "../../lib/use-resource";
import { useMe } from "../shell/MeProvider";

// Exported so a render test can supply a hint without the two requests.
export const DelegateHintContext = createContext<DelegateHint | null>(null);

// The hint of the Delegate action, or null: the rows show no Delegate action. Read by `DelegateAction`.
export function useDelegateHint(): DelegateHint | null {
  return useContext(DelegateHintContext);
}

export interface DelegateHintProviderProps {
  // null while the list loads.
  mailboxes: readonly MailboxView[] | null;
  children: ReactNode;
}

// Loads the active delegates and the draft switch of each assist mailbox, once for the page, only for an owner while the flag
// `delegate_button` is on. A failed read leaves the hint null: the page shows no action, never an error.
export function DelegateHintProvider({ mailboxes, children }: DelegateHintProviderProps) {
  const { me } = useMe();
  const wanted = delegateHintWanted(me);
  const assistKey = mailboxes === null ? null : mailboxes.map((mailbox) => `${mailbox.id}:${mailbox.mode}`).join(",");
  const { data, reload } = useResource(
    async () => (wanted && mailboxes !== null ? loadDelegateHint(mailboxes) : null),
    { pollMs: MINUTE_MS }
  );
  // The list arrived or a mode changed: read the hint again (the first load ran before the list).
  useEffect(() => {
    if (assistKey !== null) reload();
  }, [assistKey, wanted, reload]);
  return <DelegateHintContext.Provider value={wanted ? data : null}>{children}</DelegateHintContext.Provider>;
}
