import { describe, expect, test } from "bun:test";

import { llmShape } from "../../config-llm";

import { llmProviderIds, llmProviders } from "./index";

describe("provider registry rows", () => {
  for (const id of llmProviderIds) {
    test(`${id}: the config shape has its key, timeout and rate, and the server row exists`, () => {
      const row = llmProviders[id];
      expect(row).toBeDefined();
      const shape = Object.keys(llmShape);
      for (const key of [`${row.envPrefix}_API_KEY`, `${row.envPrefix}_TIMEOUT_MS`, `${row.envPrefix}_RPM`]) {
        expect(shape, key).toContain(key);
      }
    });

    test(`${id}: the extra keys of the row are in the config shape`, () => {
      for (const key of Object.keys(llmProviders[id].envShape)) expect(Object.keys(llmShape), key).toContain(key);
    });
  }

  test("the own model key of a row is one of its extra keys", () => {
    for (const id of llmProviderIds) {
      const { ownModelKey, envShape } = llmProviders[id];
      if (ownModelKey !== null) expect(Object.keys(envShape)).toContain(ownModelKey);
    }
  });
});
