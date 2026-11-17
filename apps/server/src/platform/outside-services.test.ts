import { type ActiveWhen, subprocessors } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { configSchema } from "./config";
import { llmProviderIds } from "./llm";
import { OUTSIDE_SERVICE_KEYS } from "./outside-services";

const configKeys = Object.keys(configSchema.shape);
const rowIds = new Set(subprocessors.map((row) => row.id));
const outsideKey = /(_URL|_HOST|_API_KEY|_TOKEN|_ENDPOINT|_API_ROOT)$|^MAIL_OAUTH_/;

describe("sub-processor registry and config", () => {
  test("1. every LLM provider has exactly one row that is active when an LLM role uses it", () => {
    for (const provider of llmProviderIds) {
      const rows = subprocessors.filter(
        (row) => row.activeWhen.kind === "llmProvider" && row.activeWhen.provider === provider
      );
      expect({ provider, rows: rows.map((row) => row.id) }).toEqual({ provider, rows: [expect.any(String)] });
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
});
