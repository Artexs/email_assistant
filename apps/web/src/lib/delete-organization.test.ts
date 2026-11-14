/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { orgDeleteResponseSchema } from "@ea/core/web";

import { ApiError, createApi } from "./api";
import {
  DELETED_MAILBOXES_KEY,
  DELETING_KEY,
  DELETING_MAX_AGE_MS,
  canDeleteOrganization,
  createDeleteRunner,
  deleteFormReducer,
  deleteSubmitEnabled,
  emptyDeleteForm,
  takeDeletedNotice,
  type DeleteDeps,
  type DeleteFormAction,
} from "./delete-organization";

const NOW = 1_800_000_000_000;

function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

// The real `api` over a fake fetch: the server answers are the ones of DELETE /api/organization.
function setup(response: () => Response) {
  const store = memoryStore();
  const sent: { path: string; method: string | undefined; body: string }[] = [];
  const goneTo: string[] = [];
  const api = createApi({
    fetchImpl: (path, init) => {
      sent.push({ path, method: init?.method, body: String(init?.body) });
      return Promise.resolve(response());
    },
    onUnauthorized: () => undefined,
  });
  const deps: DeleteDeps = {
    request: (body) => api("/api/organization", orgDeleteResponseSchema, { method: "DELETE", body }),
    storage: () => store,
    goTo: (url) => void goneTo.push(url),
    now: () => NOW,
  };
  return { run: createDeleteRunner(deps), store, sent, goneTo };
}

describe("canDeleteOrganization (test 1: no delete button for an assistant, or with the flag off)", () => {
  test("only an owner with org_delete", () => {
    expect(canDeleteOrganization({ role: "owner", features: ["org_delete"] })).toBe(true);
    expect(canDeleteOrganization({ role: "owner", features: ["security_log"] })).toBe(false);
    expect(canDeleteOrganization({ role: "owner", features: [] })).toBe(false);
    expect(canDeleteOrganization({ role: "assistant", features: ["org_delete"] })).toBe(false);
  });
});

describe("deleteSubmitEnabled (test 2)", () => {
  test("off for a wrong name, on after trim and case folding", () => {
    expect(deleteSubmitEnabled("Acme Test", "Acme", "secret", false)).toBe(false);
    expect(deleteSubmitEnabled("Acme Test", " acme test ", "secret", false)).toBe(true);
  });

  test("off without a password and while a request runs", () => {
    expect(deleteSubmitEnabled("Acme Test", "Acme Test", "", false)).toBe(false);
    expect(deleteSubmitEnabled("Acme Test", "Acme Test", "secret", true)).toBe(false);
  });
});

describe("createDeleteRunner", () => {
  const input = { password: "pw-1", confirmName: "Acme Test" };

  test("test 4: a 200 stores the addresses and goes to /login?deleted=1", async () => {
    const { run, store, sent, goneTo } = setup(() => Response.json({ mailboxAddresses: ["a@x.test", "b@x.test"] }));
    expect(await run(input)).toEqual({ kind: "deleted" });
    expect(store.data.get(DELETED_MAILBOXES_KEY)).toBe('["a@x.test","b@x.test"]');
    expect(goneTo).toEqual(["/login?deleted=1"]);
    expect(sent).toEqual([
      {
        path: "/api/organization",
        method: "DELETE",
        body: JSON.stringify({ password: "pw-1", confirmName: "Acme Test" }),
      },
    ]);
  });

  test("test 3: a 400 wrong_password is a failed outcome with its text, and nothing is stored or opened", async () => {
    const { run, store, goneTo } = setup(() => Response.json({ error: "wrong_password" }, { status: 400 }));
    expect(await run(input)).toEqual({ kind: "failed", error: { field: "password", key: "del_wrong_password" } });
    expect(store.data.size).toBe(0);
    expect(goneTo).toEqual([]);
  });

  test("N2: the pending marker is written before the request and cleared when it fails", async () => {
    const store = memoryStore();
    let markerDuringRequest: string | undefined;
    const run = createDeleteRunner({
      request: () => {
        markerDuringRequest = store.data.get(DELETING_KEY);
        return Promise.reject(new ApiError(400, "wrong_password"));
      },
      storage: () => store,
      goTo: () => undefined,
      now: () => NOW,
    });
    await run(input);
    expect(markerDuringRequest).toBe(String(NOW));
    expect(store.data.has(DELETING_KEY)).toBe(false);
  });

  test("N2: after a network error the marker is gone and the text is the unknown one", async () => {
    const store = memoryStore();
    const run = createDeleteRunner({
      request: () => Promise.reject(new TypeError("fetch failed")),
      storage: () => store,
      goTo: () => undefined,
      now: () => NOW,
    });
    expect(await run(input)).toEqual({ kind: "failed", error: { field: null, key: "del_failed_unknown" } });
    expect(store.data.size).toBe(0);
  });

  test("N3: a 200 that does not parse is the unknown outcome, not 'nothing was deleted'", async () => {
    const { run, goneTo } = setup(() => new Response("<html>", { status: 200 }));
    expect(await run(input)).toEqual({ kind: "failed", error: { field: null, key: "del_failed_unknown" } });
    expect(goneTo).toEqual([]);
  });

  test("a busy 503 internal shows the generic error", async () => {
    const { run } = setup(() => Response.json({ error: "internal" }, { status: 503 }));
    expect(await run(input)).toEqual({ kind: "failed", error: { field: null, key: "del_failed" } });
  });

  test("a blocked storage still goes to the login page", async () => {
    const goneTo: string[] = [];
    const run = createDeleteRunner({
      request: () => Promise.resolve({ mailboxAddresses: ["a@x.test"] }),
      storage: () => undefined,
      goTo: (url) => void goneTo.push(url),
      now: () => NOW,
    });
    expect(await run(input)).toEqual({ kind: "deleted" });
    expect(goneTo).toEqual(["/login?deleted=1"]);
  });

  test("a double submit sends one request; the second call does nothing", async () => {
    let calls = 0;
    let release: () => void = () => undefined;
    const run = createDeleteRunner({
      request: () => {
        calls += 1;
        return new Promise((resolve) => {
          release = () => resolve({ mailboxAddresses: [] });
        });
      },
      storage: () => memoryStore(),
      goTo: () => undefined,
      now: () => NOW,
    });
    const first = run(input);
    const second = run(input);
    expect(await second).toBeUndefined();
    release();
    expect(await first).toEqual({ kind: "deleted" });
    expect(calls).toBe(1);
  });

  test("after a failure a new submit runs again", async () => {
    let calls = 0;
    const run = createDeleteRunner({
      request: () => {
        calls += 1;
        return Promise.reject(new ApiError(400, "wrong_password"));
      },
      storage: () => undefined,
      goTo: () => undefined,
      now: () => NOW,
    });
    await run(input);
    await run(input);
    expect(calls).toBe(2);
  });
});

describe("deleteFormReducer", () => {
  function reduce(...actions: DeleteFormAction[]) {
    return actions.reduce(deleteFormReducer, emptyDeleteForm);
  }
  const typed: DeleteFormAction[] = [
    { type: "password", value: "pw-1" },
    { type: "name", value: "Acme Test" },
  ];

  test("typing fills the fields; a submit sets pending and drops the old error", () => {
    const form = reduce(...typed, { type: "submit" });
    expect(form).toEqual({ password: "pw-1", name: "Acme Test", pending: true, error: null });
  });

  test("a failure clears the password and the name and keeps the error", () => {
    const error = { field: "password", key: "del_wrong_password" } as const;
    const form = reduce(...typed, { type: "submit" }, { type: "outcome", outcome: { kind: "failed", error } });
    expect(form).toEqual({ password: "", name: "", pending: false, error });
  });

  test("a success clears the password and the name and keeps the form disabled", () => {
    const form = reduce(...typed, { type: "submit" }, { type: "outcome", outcome: { kind: "deleted" } });
    expect(form).toEqual({ password: "", name: "", pending: true, error: null });
  });

  test("a close clears everything, but not while the request runs", () => {
    const error = { field: null, key: "del_failed" } as const;
    const failed = reduce(...typed, { type: "outcome", outcome: { kind: "failed", error } });
    expect(deleteFormReducer(failed, { type: "close" })).toEqual(emptyDeleteForm);
    const typedForm = reduce(...typed);
    expect(deleteFormReducer(typedForm, { type: "close" })).toEqual(emptyDeleteForm);
    const running = reduce(...typed, { type: "submit" });
    expect(deleteFormReducer(running, { type: "close" })).toBe(running);
  });
});

describe("takeDeletedNotice (test 5)", () => {
  test("lists both addresses on /login?next=/settings and removes the key", () => {
    const store = memoryStore({ [DELETED_MAILBOXES_KEY]: '["a@x.test","b@x.test"]' });
    expect(takeDeletedNotice("?next=/settings", store, NOW)).toEqual({ addresses: ["a@x.test", "b@x.test"] });
    expect(store.data.has(DELETED_MAILBOXES_KEY)).toBe(false);
    expect(takeDeletedNotice("?next=/settings", store, NOW)).toBeNull();
  });

  test("lists the addresses with ?deleted=1 too", () => {
    const store = memoryStore({ [DELETED_MAILBOXES_KEY]: '["a@x.test"]' });
    expect(takeDeletedNotice("?deleted=1", store, NOW)).toEqual({ addresses: ["a@x.test"] });
    expect(store.data.size).toBe(0);
  });

  test("?deleted=1 with no key shows the texts without a list", () => {
    expect(takeDeletedNotice("?deleted=1", memoryStore(), NOW)).toEqual({ addresses: [] });
    expect(takeDeletedNotice("?deleted=1", undefined, NOW)).toEqual({ addresses: [] });
  });

  test("a bad key shows the texts without a list and the key goes", () => {
    for (const bad of ["{bad", '{"a":1}', "[1,2]"]) {
      const store = memoryStore({ [DELETED_MAILBOXES_KEY]: bad });
      expect(takeDeletedNotice("?deleted=1", store, NOW)).toEqual({ addresses: [] });
      expect(store.data.size).toBe(0);
    }
  });

  test("no key and no query: no notice", () => {
    expect(takeDeletedNotice("", memoryStore(), NOW)).toBeNull();
    expect(takeDeletedNotice("?deleted=0", memoryStore(), NOW)).toBeNull();
    expect(takeDeletedNotice("?next=/", undefined, NOW)).toBeNull();
  });

  test("a storage that throws shows no list", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(takeDeletedNotice("?deleted=1", broken, NOW)).toEqual({ addresses: [] });
  });

  test("N2: a fresh pending marker alone shows the notice without a list, on /login?next=… too, and goes", () => {
    const store = memoryStore({ [DELETING_KEY]: String(NOW - 1000) });
    expect(takeDeletedNotice("?next=/settings", store, NOW)).toEqual({ addresses: [] });
    expect(store.data.size).toBe(0);
    expect(takeDeletedNotice("?next=/settings", store, NOW)).toBeNull();
  });

  test("N2: the list wins over the marker and both keys go", () => {
    const store = memoryStore({ [DELETING_KEY]: String(NOW), [DELETED_MAILBOXES_KEY]: '["a@x.test"]' });
    expect(takeDeletedNotice("", store, NOW)).toEqual({ addresses: ["a@x.test"] });
    expect(store.data.size).toBe(0);
  });

  test("N2: a stale, future or bad marker shows nothing and goes", () => {
    for (const marker of [String(NOW - DELETING_MAX_AGE_MS - 1), String(NOW + 60_000), "soon"]) {
      const store = memoryStore({ [DELETING_KEY]: marker });
      expect(takeDeletedNotice("?next=/", store, NOW)).toBeNull();
      expect(store.data.size).toBe(0);
    }
  });
});
