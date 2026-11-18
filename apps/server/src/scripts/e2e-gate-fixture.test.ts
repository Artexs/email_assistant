import { resolve } from "node:path";

import { barCategories, movingCategories } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { globalEvidenceFor, loadGateEvidence, runningEvidenceKey } from "../modules/triage";
import { llmRoleTable, loadConfig } from "../platform/config";

import { E2E_GATE_FIXTURE_DIR, E2E_LLM_PIN } from "./e2e-seed-args";

// The autonomy card spec (F110 stage 13) reads gate files from a fixture folder through `GATE_EVIDENCE_DIR`. A file counts only for the
// exact running key, so a change of the prompt pointer or of the pin must show here, not as a card without lines in e2e.
const repoRoot = resolve(import.meta.dir, "../../../..");
const config = loadConfig({
  DATABASE_URL: "postgres://app:pw@127.0.0.1:5433/email_assistant_e2e",
  CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  ...E2E_LLM_PIN,
});

describe("the e2e gate fixture", () => {
  const index = loadGateEvidence(resolve(repoRoot, E2E_GATE_FIXTURE_DIR), { quiet: true });
  const key = runningEvidenceKey(llmRoleTable(config));

  test("one file loads and matches the running key of the e2e server", () => {
    expect(index.files).toHaveLength(1);
    const evidence = globalEvidenceFor(index, key);
    for (const category of movingCategories) {
      expect(evidence[category]).toMatchObject({ decision: "go", provisional: false, cases: 200, wilsonLower: 0.991 });
    }
  });

  test("the other categories have no `go`, so only the three moving categories show proof", () => {
    const evidence = globalEvidenceFor(index, key);
    const others = barCategories.filter((category) => !movingCategories.includes(category as never));
    expect(others.length).toBe(2);
    for (const category of others) expect(evidence[category].decision).toBe("no-go");
  });
});
