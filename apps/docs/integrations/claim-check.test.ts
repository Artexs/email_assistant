import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { PublicClaim } from "../src/security/claims";
import claimCheck, { checkClaims } from "./claim-check";

const good: PublicClaim = {
  id: "good",
  text: { en: "e", pl: "p" },
  ledger: ["C001"],
  proofs: ["a/b.ts"],
  condition: null,
};
const bad: PublicClaim = { ...good, id: "bad", proofs: ["a/missing.ts"] };

let root = "";
const saved = process.env.EA_DOCS_REPO_ROOT;
const put = (path: string, text: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};
const logger = () => {
  const lines: string[] = [];
  return { lines, logger: { info: (line: string) => void lines.push(line) } };
};
const run = (claims: readonly PublicClaim[], log: ReturnType<typeof logger>) => {
  const hook = claimCheck(claims).hooks["astro:build:done"] as (arguments_: Record<string, unknown>) => void;
  hook({ logger: log.logger });
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "claim-check-"));
  put("docs/legal/claims.md", "| C001 | c | a/b.ts | — |\n");
  put("a/b.ts", "x\n");
  process.env.EA_DOCS_REPO_ROOT = root;
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  if (saved === undefined) delete process.env.EA_DOCS_REPO_ROOT;
  else process.env.EA_DOCS_REPO_ROOT = saved;
});

describe("claimCheck", () => {
  test("T14 a bad claim fails the build with every problem of the list", () => {
    const worse: PublicClaim = { ...bad, id: "worse", ledger: ["C999"] };
    expect(() => run([good, bad, worse], logger())).toThrow(
      "claim_check failed:\nclaim bad proof_missing a/missing.ts\nclaim worse ledger_missing C999\nclaim worse proof_missing a/missing.ts"
    );
  });

  test("T14 with no bad claim it logs the count; the shipped list is empty", () => {
    const one = logger();
    run([good], one);
    expect(one.lines).toEqual(["claim_check ok 1"]);
    const none = logger();
    run([], none);
    expect(none.lines).toEqual(["claim_check ok 0"]);
  });

  test("a root without the ledger fails the build", () => {
    expect(() => checkClaims([], join(root, "nowhere"))).toThrow("ledger_missing docs/legal/claims.md");
  });
});
