import { useState } from "react";

import { nextDraft, startDraft, type Draft } from "./draft";

interface DraftState<T> {
  draft: Draft<T>;
  // The last server value that came in through the argument (not through `reset`).
  seen: T;
}

// A form value under polling: a new server value moves in only while the user has not typed (nextDraft).
export function useDraft<T>(server: T) {
  const [state, setState] = useState<DraftState<T>>(() => ({ draft: startDraft(server), seen: server }));
  const changed = JSON.stringify(state.seen) !== JSON.stringify(server);
  const current: DraftState<T> = changed ? { draft: nextDraft(state.draft, server), seen: server } : state;
  if (changed) setState(current);

  const setValue = (value: T) => setState((prev) => ({ ...prev, draft: { ...prev.draft, value } }));
  // After a save: the saved value is the new server value of the form.
  const reset = (saved: T) => setState((prev) => ({ ...prev, draft: startDraft(saved) }));

  return { draft: current.draft, setValue, reset };
}
