// Which list row holds the focus (F102 stage 18, N-focus). The delegations page uses it to know that a reload removed the row that
// had the focus, and then puts the focus on its status line instead of the page body.
//
// A `focusout` with no `relatedTarget` has two causes: the user moved the focus to nothing (a click on the page background), or the
// browser removed the focused element (Chromium sends `focusout` then too, while the element is still in the page). The first
// must forget the row, so that a later reload does not take the focus without a user action. The second must keep it. The two differ one
// microtask later: the removed element is no longer in the document.

export interface FocusTargetLike {
  isConnected: boolean;
  closest(selector: string): { id: string } | null;
}

export interface FocusEventLike {
  target: unknown;
  relatedTarget?: unknown;
}

export interface FocusedRowTracker {
  // The id of the row that holds the focus (the row element id without the prefix), or null.
  readonly current: string | null;
  // The row is gone from the list and the page has handled it.
  clear(): void;
  onFocusIn(event: FocusEventLike): void;
  onFocusOut(event: FocusEventLike): void;
}

const isTarget = (value: unknown): value is FocusTargetLike =>
  typeof value === "object" && value !== null && typeof (value as FocusTargetLike).closest === "function";

export function createFocusedRowTracker(
  idPrefix: string,
  defer: (task: () => void) => void = queueMicrotask
): FocusedRowTracker {
  let current: string | null = null;
  const rowOf = (target: FocusTargetLike): string | null => {
    const row = target.closest(`li[id^='${idPrefix}']`);
    return row === null ? null : row.id.slice(idPrefix.length);
  };
  return {
    get current() {
      return current;
    },
    clear() {
      current = null;
    },
    onFocusIn(event) {
      current = isTarget(event.target) ? rowOf(event.target) : null;
    },
    onFocusOut(event) {
      const target = event.target;
      // A focus move to another element sends a `focusin` next: it sets the row.
      if (event.relatedTarget != null || !isTarget(target)) return;
      const row = rowOf(target);
      defer(() => {
        if (target.isConnected && current === row) current = null;
      });
    },
  };
}
