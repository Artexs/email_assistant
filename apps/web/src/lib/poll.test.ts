import { describe, expect, test } from "bun:test";

import { startPolling, type PollDoc, type PollTimers } from "./poll";

class FakeDoc implements PollDoc {
  visibilityState: string;
  listeners = new Set<() => void>();
  constructor(visibilityState: string) {
    this.visibilityState = visibilityState;
  }
  addEventListener(_type: "visibilitychange", listener: () => void) {
    this.listeners.add(listener);
  }
  removeEventListener(_type: "visibilitychange", listener: () => void) {
    this.listeners.delete(listener);
  }
  change(state: string) {
    this.visibilityState = state;
    for (const listener of [...this.listeners]) listener();
  }
}

class FakeTimers implements PollTimers {
  created: { id: number; ms: number }[] = [];
  cleared: number[] = [];
  setInterval(_handler: () => void, ms: number) {
    const id = this.created.length + 1;
    this.created.push({ id, ms });
    return id;
  }
  clearInterval(id: unknown) {
    this.cleared.push(id as number);
  }
  live(): number[] {
    return this.created.map((c) => c.id).filter((id) => !this.cleared.includes(id));
  }
}

function setup(state: string) {
  const doc = new FakeDoc(state);
  const timers = new FakeTimers();
  let runs = 0;
  const stop = startPolling(() => (runs += 1), { pollMs: 30_000, doc, timers });
  return { doc, timers, stop, runs: () => runs };
}

describe("startPolling", () => {
  test("a pollMs of 0 runs once and starts no interval and no listener", () => {
    const doc = new FakeDoc("visible");
    const timers = new FakeTimers();
    let runs = 0;
    const stop = startPolling(() => (runs += 1), { pollMs: 0, doc, timers });
    expect(runs).toBe(1);
    expect(timers.created).toEqual([]);
    expect(doc.listeners.size).toBe(0);
    stop();
  });

  test("visible at the start: runs once and starts one interval", () => {
    const { timers, runs } = setup("visible");
    expect(runs()).toBe(1);
    expect(timers.created).toEqual([{ id: 1, ms: 30_000 }]);
  });

  test("hidden at the start: runs once and starts no interval", () => {
    const { timers, runs } = setup("hidden");
    expect(runs()).toBe(1);
    expect(timers.created).toEqual([]);
  });

  test("visible to hidden clears the interval", () => {
    const { doc, timers } = setup("visible");
    doc.change("hidden");
    expect(timers.cleared).toEqual([1]);
    expect(timers.created.length).toBe(1);
    expect(timers.live()).toEqual([]);
  });

  test("hidden to visible runs at once and starts a new interval", () => {
    const { doc, timers, runs } = setup("visible");
    doc.change("hidden");
    doc.change("visible");
    expect(runs()).toBe(2);
    expect(timers.created.length).toBe(2);
    expect(timers.live()).toEqual([2]);
  });

  test("stop clears the interval and removes the listener", () => {
    const { doc, timers, stop, runs } = setup("visible");
    stop();
    expect(timers.live()).toEqual([]);
    expect(doc.listeners.size).toBe(0);
    doc.change("visible");
    expect(runs()).toBe(1);
    expect(timers.created.length).toBe(1);
  });

  test("two visible events in a row leave one live interval", () => {
    const { doc, timers } = setup("visible");
    doc.change("visible");
    doc.change("visible");
    expect(timers.live().length).toBe(1);
  });
});
