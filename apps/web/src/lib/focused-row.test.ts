/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import { createFocusedRowTracker, type FocusTargetLike } from "./focused-row";

const PREFIX = "delegation-row-";

// A control inside the row `rowId` (null: a control outside every row). `connected` is false after the browser removed it.
function control(rowId: string | null): FocusTargetLike & { connected: boolean; isConnected: boolean } {
  const el = {
    connected: true,
    get isConnected() {
      return el.connected;
    },
    closest: () => (rowId === null ? null : { id: `${PREFIX}${rowId}` }),
  };
  return el;
}

function setup() {
  const queue: (() => void)[] = [];
  const tracker = createFocusedRowTracker(PREFIX, (task) => queue.push(task));
  const flush = () => queue.splice(0).forEach((task) => task());
  return { tracker, flush };
}

describe("createFocusedRowTracker", () => {
  test("focusin on a control of a row sets the row; a control outside a row clears it", () => {
    const { tracker } = setup();
    tracker.onFocusIn({ target: control("a") });
    expect(tracker.current).toBe("a");
    tracker.onFocusIn({ target: control(null) });
    expect(tracker.current).toBeNull();
  });

  test("the user moves the focus to nothing: the row is forgotten, so a later reload takes no focus", () => {
    const { tracker, flush } = setup();
    const button = control("a");
    tracker.onFocusIn({ target: button });
    tracker.onFocusOut({ target: button, relatedTarget: null });
    flush();
    expect(tracker.current).toBeNull();
  });

  test("the browser removes the focused control: the row stays, so the page can move the focus to its status line", () => {
    const { tracker, flush } = setup();
    const button = control("a");
    tracker.onFocusIn({ target: button });
    tracker.onFocusOut({ target: button, relatedTarget: null });
    button.connected = false; // the removal ends before the microtask runs
    flush();
    expect(tracker.current).toBe("a");
  });

  test("a move to another control keeps the focus tracking: the focusin of the new control decides", () => {
    const { tracker, flush } = setup();
    const first = control("a");
    const second = control("b");
    tracker.onFocusIn({ target: first });
    tracker.onFocusOut({ target: first, relatedTarget: second });
    tracker.onFocusIn({ target: second });
    flush();
    expect(tracker.current).toBe("b");
  });

  test("a focusin that comes before the deferred check is not undone", () => {
    const { tracker, flush } = setup();
    const first = control("a");
    const second = control("b");
    tracker.onFocusIn({ target: first });
    tracker.onFocusOut({ target: first, relatedTarget: null });
    tracker.onFocusIn({ target: second });
    flush();
    expect(tracker.current).toBe("b");
  });

  test("clear() forgets the row", () => {
    const { tracker } = setup();
    tracker.onFocusIn({ target: control("a") });
    tracker.clear();
    expect(tracker.current).toBeNull();
  });
});
