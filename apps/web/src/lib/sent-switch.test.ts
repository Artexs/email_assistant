/// <reference types="bun" />
import type { SettingsWebChange } from "@ea/core/web";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { TextKey } from "../i18n";
import { ApiError } from "./api";
import { changeSentSync, type SentSwitchDeps } from "./sent-switch";

const ID = "0190f5a0-0000-7000-8000-000000000003";
const CHANGE = { changed: true, expired: 0, settings: {} } as unknown as SettingsWebChange;

function setup(patch: SentSwitchDeps["patch"]) {
  const calls: { mailboxId: string; tail: string; body: unknown }[] = [];
  const toasts: TextKey[] = [];
  const errors: TextKey[] = [];
  let missing = 0;
  const deps: SentSwitchDeps = {
    patch: (mailboxId, tail, body) => {
      calls.push({ mailboxId, tail, body });
      return patch(mailboxId, tail, body);
    },
    onChanged: (_change, key) => void toasts.push(key),
    toastError: (key) => void errors.push(key),
    onMissing: () => void missing++,
  };
  return { deps, calls, toasts, errors, missing: () => missing };
}

describe("changeSentSync", () => {
  test("on: PATCH /sent-sync with { enabled: true }, then the on toast", async () => {
    const s = setup(() => Promise.resolve(CHANGE));
    await changeSentSync(s.deps, ID, true);
    expect(s.calls).toEqual([{ mailboxId: ID, tail: "/sent-sync", body: { enabled: true } }]);
    expect(s.toasts).toEqual(["sent_on_toast"]);
    expect(s.errors).toEqual([]);
    expect(s.missing()).toBe(0);
  });

  test("off: PATCH /sent-sync with { enabled: false }, then the off toast", async () => {
    const s = setup(() => Promise.resolve(CHANGE));
    await changeSentSync(s.deps, ID, false);
    expect(s.calls).toEqual([{ mailboxId: ID, tail: "/sent-sync", body: { enabled: false } }]);
    expect(s.toasts).toEqual(["sent_off_toast"]);
  });

  test("a 404 shows the not-found text and asks the page to reload", async () => {
    const s = setup(() => Promise.reject(new ApiError(404, "not_found")));
    await changeSentSync(s.deps, ID, true);
    expect(s.errors).toEqual(["err_not_found"]);
    expect(s.missing()).toBe(1);
    expect(s.toasts).toEqual([]);
  });

  test("403 owner_only shows the owner text and does not reload", async () => {
    const s = setup(() => Promise.reject(new ApiError(403, "owner_only")));
    await changeSentSync(s.deps, ID, true);
    expect(s.errors).toEqual(["owner_only"]);
    expect(s.missing()).toBe(0);
    expect(s.toasts).toEqual([]);
  });

  test("403 bad_origin and a network error show the generic text", async () => {
    const origin = setup(() => Promise.reject(new ApiError(403, "bad_origin")));
    await changeSentSync(origin.deps, ID, false);
    expect(origin.errors).toEqual(["error_generic"]);
    expect(origin.missing()).toBe(0);
    const network = setup(() => Promise.reject(new TypeError("fetch failed")));
    await changeSentSync(network.deps, ID, false);
    expect(network.errors).toEqual(["error_generic"]);
    expect(network.toasts).toEqual([]);
  });
});

describe("the connect line of MailboxesPage", () => {
  // The island needs a live session and a mailbox list, so the wiring is read from the source (as islands.test.ts does).
  const source = readFileSync(join(import.meta.dir, "../islands/MailboxesPage.tsx"), "utf8");

  test("sentSyncLine is true exactly when me.features holds sent_sync", () => {
    expect(source).toContain('sentSyncLine={me.features.includes("sent_sync")}');
    expect(source).not.toMatch(/sentSyncLine=\{(true|false)\}/);
  });
});
