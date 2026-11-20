import { describe, expect, test } from "bun:test";

import { createRunTracker } from "./runs";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("the run tracker", () => {
  test("settled() waits for a tracked run until it resolves", async () => {
    const runs = createRunTracker();
    const run = deferred();
    runs.track("a", () => run.promise)();
    let done = false;
    const settled = runs.settled().then(() => {
      done = true;
    });
    await macrotask();
    expect(done).toBe(false);
    run.resolve();
    await settled;
    expect(done).toBe(true);
  });

  test("only the newest run of a name counts", async () => {
    const runs = createRunTracker();
    const first = deferred();
    const second = deferred();
    const queue = [first, second];
    const callback = runs.track("a", () => (queue.shift() ?? first).promise);
    void callback();
    void callback();
    second.resolve();
    await runs.settled();
  });

  test("a rejected run reaches the caller, and settled() still resolves", async () => {
    const runs = createRunTracker();
    const callback = runs.track("a", () => Promise.reject(new Error("x")));
    await expect(callback()).rejects.toThrow("x");
    await runs.settled();
  });

  test("with no tracked name, settled() resolves at once", async () => {
    await createRunTracker().settled();
  });
});
