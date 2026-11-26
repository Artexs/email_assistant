import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type ActiveWhen, subprocessors } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { configSchema } from "./config";
import { llmProviderIds, llmProviders } from "./llm";
import { OUTSIDE_CALL_CLASSES, OUTSIDE_SERVICE_KEYS } from "./outside-services";

const configKeys = Object.keys(configSchema.shape);
const rowIds = new Set(subprocessors.map((row) => row.id));
const outsideKey = /(_URL|_HOST|_API_KEY|_TOKEN|_ENDPOINT|_API_ROOT)$|^MAIL_OAUTH_/;

describe("sub-processor registry and config", () => {
  test("1. every LLM provider that may get real mail has exactly one row; a provider that may not has none", () => {
    for (const provider of llmProviderIds) {
      const rows = subprocessors.filter(
        (row) => row.activeWhen.kind === "llmProvider" && row.activeWhen.provider === provider
      );
      // `realMail: false` is the registry flag that config turns into the refusal of `TRIAGE_LLM_SCOPE=all`.
      const expected = llmProviders[provider].realMail ? [expect.any(String)] : [];
      expect({ provider, rows: rows.map((row) => row.id) }).toEqual({ provider, rows: expected });
    }
    const named = subprocessors.flatMap((row) =>
      row.activeWhen.kind === "llmProvider" ? [row.activeWhen.provider] : []
    );
    for (const provider of named)
      expect({ provider, known: (llmProviderIds as readonly string[]).includes(provider) }).toEqual({
        provider,
        known: true,
      });
  });

  test("1b. the row deepseek has the purpose and data of the row openai, a location in China and follows the provider", () => {
    const row = (id: string) => subprocessors.find((entry) => entry.id === id);
    expect(row("deepseek")?.purpose).toEqual(row("openai")?.purpose);
    expect(row("deepseek")?.dataReceived).toEqual(row("openai")?.dataReceived);
    expect(row("deepseek")?.location.en).toContain("People's Republic of China");
    expect(row("deepseek")?.activeWhen).toEqual({ kind: "llmProvider", provider: "deepseek" });
    expect(row("deepseek")?.personalData).toBe(true);
    expect(OUTSIDE_SERVICE_KEYS.DEEPSEEK_API_KEY).toBe("deepseek");
  });

  test("2. every env key of a row is a key of the config schema", () => {
    const keyOf = (when: ActiveWhen): string | undefined => (when.kind === "env" ? when.key : undefined);
    for (const row of subprocessors) {
      const key = keyOf(row.activeWhen);
      if (key !== undefined)
        expect({ id: row.id, key, inSchema: configKeys.includes(key) }).toEqual({ id: row.id, key, inSchema: true });
    }
  });

  test("3. every config key that names an outside endpoint or credential is mapped, and every mapped id is a row", () => {
    const unmapped = configKeys.filter((key) => outsideKey.test(key) && !(key in OUTSIDE_SERVICE_KEYS));
    expect(unmapped).toEqual([]);
    for (const [key, target] of Object.entries(OUTSIDE_SERVICE_KEYS)) {
      expect({ key, inSchema: configKeys.includes(key) }).toEqual({ key, inSchema: true });
      if (typeof target === "string")
        expect({ key, target, isRow: rowIds.has(target) }).toEqual({ key, target, isRow: true });
      else expect({ key, reason: target.exempt.trim() !== "" }).toEqual({ key, reason: true });
    }
  });

  test("3b. the push services are the row `web-push`: it follows the private VAPID key, and both keys map to it", () => {
    const row = subprocessors.find((entry) => entry.id === "web-push");
    expect(row?.activeWhen).toEqual({ kind: "env", key: "VAPID_PRIVATE_KEY" });
    expect(row?.personalData).toBe(true);
    expect(OUTSIDE_SERVICE_KEYS.VAPID_PRIVATE_KEY).toBe("web-push");
    expect(OUTSIDE_SERVICE_KEYS.VAPID_SUBJECT).toBe("web-push");
  });

  test("4. an outside call to a host from mail text is a listed class with a reason, and its file still makes the call", () => {
    for (const [name, entry] of Object.entries(OUTSIDE_CALL_CLASSES)) {
      expect({ name, reason: entry.exempt.trim().length > 40 }).toEqual({ name, reason: true });
      const text = readFileSync(join(import.meta.dir, "..", entry.file), "utf8");
      expect({ name, calls: text.includes(entry.call) }).toEqual({ name, calls: true });
    }
    // Production code that calls the guarded client is one listed file (the test of the client also scans for a seam).
    expect(Object.values(OUTSIDE_CALL_CLASSES).map((entry) => entry.file)).toEqual(["web-routers.ts"]);
  });
});
