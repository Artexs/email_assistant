/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, jest, setSystemTime, test } from "bun:test";

import { ARM_MS } from "../../lib/approvals-queue";
import { scheduleArm } from "./queue-support";

// The state that `useArmed` keeps, written by the same setter.
function armState() {
  const state = { armedId: null as string | null };
  return { state, set: (id: string | null) => (state.armedId = id) };
}

function passTime(ms: number) {
  setSystemTime(new Date(Date.now() + ms));
  jest.advanceTimersByTime(ms);
}

beforeEach(() => {
  jest.useFakeTimers();
  setSystemTime(new Date("2026-01-01T10:00:00Z"));
});
afterEach(() => {
  jest.useRealTimers();
  setSystemTime();
});

describe("scheduleArm", () => {
  test("a card is armed after ARM_MS and not before", () => {
    const { state, set } = armState();
    scheduleArm("a", set);

    passTime(ARM_MS - 1);
    expect(state.armedId).toBeNull();

    passTime(1);
    expect(state.armedId).toBe("a");
  });

  test("a draft that returns after no card waits the full ARM_MS again", () => {
    const { state, set } = armState();
    const stop = scheduleArm("a", set);
    passTime(ARM_MS);
    expect(state.armedId).toBe("a");

    stop();
    scheduleArm(null, set);
    scheduleArm("a", set);

    expect(state.armedId).toBeNull();
    passTime(ARM_MS - 1);
    expect(state.armedId).toBeNull();
    passTime(1);
    expect(state.armedId).toBe("a");
  });

  test("a draft that returns after another card waits the full ARM_MS again", () => {
    const { state, set } = armState();
    const stopA = scheduleArm("a", set);
    passTime(ARM_MS);
    expect(state.armedId).toBe("a");
    stopA();
    const stopB = scheduleArm("b", set);
    stopB();
    scheduleArm("a", set);

    expect(state.armedId).toBeNull();
    passTime(ARM_MS);
    expect(state.armedId).toBe("a");
  });

  test("the cleanup stops a card that was left before its time", () => {
    const { state, set } = armState();
    scheduleArm("a", set)();

    passTime(ARM_MS * 2);

    expect(state.armedId).toBeNull();
  });
});
