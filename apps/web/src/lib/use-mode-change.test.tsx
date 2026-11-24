/// <reference types="bun" />
import type { SettingsWebChange } from "@ea/core/web";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ApiError } from "./api";
import { runModeChange, useModeChange, type Mode } from "./use-mode-change";

interface Sent {
  path: string;
  method: string | undefined;
  body: unknown;
}

const realFetch = globalThis.fetch;
let sent: Sent[] = [];

function fakeFetch(status: number, body: unknown) {
  globalThis.fetch = ((path: string, init?: RequestInit) => {
    sent.push({ path, method: init?.method, body: JSON.parse(String(init?.body)) });
    return Promise.resolve(Response.json(body, { status }));
  }) as typeof fetch;
}

beforeEach(() => {
  sent = [];
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const answer: SettingsWebChange = {
  changed: true,
  expired: 0,
  settings: {
    mailboxId: "0190f5a0-0000-7000-8000-000000000003",
    mode: "assist",
    toolSwitches: { move: true, flag: true, mark_read: true, create_draft: false, move_unsure: false },
    movesSupported: true,
    categories: [],
    syncFolders: [],
    urgencyProfile: null,
    sentSync: null,
    sentTracking: "flag_off",
    loopWaitDays: 3,
    bar: 0.98,
    minKept: 30,
  },
};

interface Probe {
  changed: [SettingsWebChange, Mode][];
  failed: unknown[];
}

// Renders the hook once and returns what it handed out.
function renderHook(probe: Probe): ReturnType<typeof useModeChange> {
  const results: ReturnType<typeof useModeChange>[] = [];
  function Component({ capture }: { capture(result: ReturnType<typeof useModeChange>): void }) {
    capture(
      useModeChange("m1", {
        onChanged: (change, mode) => probe.changed.push([change, mode]),
        onFail: (error) => probe.failed.push(error),
      })
    );
    return null;
  }
  renderToStaticMarkup(<Component capture={(result) => results.push(result)} />);
  const [result] = results;
  if (result === undefined) throw new Error("the hook did not run");
  return result;
}

describe("useModeChange", () => {
  test("change sends the mode call and reports the answer with the mode", async () => {
    fakeFetch(200, answer);
    const probe: Probe = { changed: [], failed: [] };
    const hook = renderHook(probe);
    expect(hook.pending).toBe(false);

    await hook.change("assist", true);

    expect(sent).toEqual([
      { path: "/api/settings/m1/mode", method: "PATCH", body: { mode: "assist", keepSwitches: true } },
    ]);
    expect(probe.changed).toEqual([[answer, "assist"]]);
    expect(probe.failed).toEqual([]);
  });

  test("a 404 answer goes to onFail once and not to onChanged", async () => {
    fakeFetch(404, { error: "not_found" });
    const probe: Probe = { changed: [], failed: [] };

    await renderHook(probe).change("shadow", false);

    expect(probe.changed).toEqual([]);
    expect(probe.failed).toHaveLength(1);
    expect(probe.failed[0]).toBeInstanceOf(ApiError);
    expect((probe.failed[0] as ApiError).status).toBe(404);
  });
});

describe("runModeChange", () => {
  test.each([
    ["an answer", 200, answer],
    ["a failure", 404, { error: "not_found" }],
  ])("pending is true until the call ends, also after %s", async (_name, status, body) => {
    fakeFetch(status, body);
    const states: boolean[] = [];

    await runModeChange("m1", "assist", false, (pending) => states.push(pending), {
      onChanged: () => states.push(states[states.length - 1] ?? false),
      onFail: () => states.push(states[states.length - 1] ?? false),
    });

    // true, the handler sees true, then false.
    expect(states).toEqual([true, true, false]);
  });
});
