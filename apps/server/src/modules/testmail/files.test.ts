import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { batchSchema, personaFileSchema, validateBatch } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { testmailPaths } from "./paths";
import { loadRemoteTarget } from "./target";

const paths = testmailPaths({});
const readJson = (file: string): unknown => JSON.parse(readFileSync(file, "utf8"));

describe("committed testmail files", () => {
  test("the persona file parses", () => {
    const parsed = personaFileSchema.parse(readJson(paths.personasFile));
    expect(parsed.personas.map((persona) => persona.key)).toHaveLength(10);
  });

  test("the target file parses", () => {
    expect(loadRemoteTarget(paths.targetFile).host).toBe("home_vm");
  });

  test("every batch file is valid and blind-checked", () => {
    const personas = personaFileSchema.parse(readJson(paths.personasFile));
    const files = (existsSync(paths.batchesDir) ? readdirSync(paths.batchesDir) : []).filter((name) =>
      name.endsWith(".json")
    );
    for (const name of files) {
      const batch = batchSchema.parse(readJson(join(paths.batchesDir, name)));
      expect({ name, delegatesActive: batch.delegatesActive }).toEqual({ name, delegatesActive: false });
      const issues = validateBatch(batch, personas, { requireBlind: true, fileBatchId: name.replace(/\.json$/, "") });
      expect({ name, issues }).toEqual({ name, issues: [] });
    }
  });
});
