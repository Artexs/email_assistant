import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { REPO_URL } from "../in-place";
import { claimProblems, parseLedger, type PublicClaim, proofUrl } from "./claims";

const LEDGER = `# Claims

| #    | Claim | Source | Condition |
| ---- | ----- | ------ | --------- |
| C001 | one   | ADR 0003; a/b.ts | — |
| C002 | two   | gap: the code breaks the rule | — |
| C003 | three | unverified — a plan decision | — |
| C004 | four  | OpenAI terms read 2026-11-17, unverified: contract not in repo | — |
| C005 | five  | a/b.ts | LLM_PROVIDER |
`;

const claim = (over: Partial<PublicClaim> = {}): PublicClaim => ({
  id: "x",
  text: { en: "e", pl: "p" },
  ledger: ["C001"],
  proofs: ["a/b.ts", "docs/decisions/0003-x.md"],
  condition: null,
  ...over,
});

let root = "";
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "claims-"));
  // `etc/passwd` and `https:/example.com/a/b.ts` exist under the root: the rules for an absolute path and a URL must refuse them,
  // not the missing file (`join(root, "/etc/passwd")` would find the first).
  for (const file of ["a/b.ts", "a/c.ts", "docs/decisions/0003-x.md", "etc/passwd", "https:/example.com/a/b.ts"]) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), "x\n");
  }
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const problems = (...claims: PublicClaim[]) => claimProblems(claims, root, LEDGER);

describe("claimProblems", () => {
  test("T8 a claim with a ledger row and proofs that its source names has no problem", () => {
    expect(problems(claim())).toEqual([]);
  });

  test("T9 a proof that does not exist, is not in the ledger, or leaves the repo", () => {
    expect(problems(claim({ proofs: ["a/missing.ts"] }))).toEqual(["claim x proof_missing a/missing.ts"]);
    expect(problems(claim({ proofs: ["a/c.ts"] }))).toEqual(["claim x proof_not_in_ledger a/c.ts"]);
    expect(problems(claim({ proofs: ["../etc"] }))).toEqual(["claim x proof_missing ../etc"]);
    expect(problems(claim({ proofs: ["/etc/passwd"] }))).toEqual(["claim x proof_missing /etc/passwd"]);
    expect(problems(claim({ proofs: ["https://example.com/a/b.ts"] }))).toEqual([
      "claim x proof_missing https://example.com/a/b.ts",
    ]);
    expect(problems(claim({ proofs: ["a/../a/b.ts"] }))).toEqual(["claim x proof_missing a/../a/b.ts"]);
  });

  test("a proof counts when the source cell names only its file name, or its ADR number", () => {
    const ledger = "| C001 | c | b.ts and ADR 0003 | — |\n";
    expect(claimProblems([claim()], root, ledger)).toEqual([]);
    // A longer file name that ends in the same letters is no match.
    expect(claimProblems([claim({ proofs: ["a/b.ts"] })], root, "| C001 | c | ab.ts | — |\n")).toEqual([
      "claim x proof_not_in_ledger a/b.ts",
    ]);
  });

  test("T10 a weak row is a problem wherever the word stands in the source cell; a missing row too", () => {
    for (const id of ["C002", "C003", "C004"]) {
      expect(problems(claim({ ledger: [id], proofs: ["a/b.ts"] }))).toContain(`claim x ledger_weak ${id}`);
    }
    expect(problems(claim({ ledger: ["C999"] }))).toContain("claim x ledger_missing C999");
  });

  test("a word that only contains the weak word is not weak", () => {
    const ledger = "| C001 | c | a/b.ts, ungapped and unverifiedly named | — |\n";
    expect(claimProblems([claim({ proofs: ["a/b.ts"] })], root, ledger)).toEqual([]);
  });

  test("T11 a cited row with a condition needs the condition of the claim", () => {
    const base = { ledger: ["C005"], proofs: ["a/b.ts"] };
    expect(problems(claim({ ...base, condition: null }))).toEqual(["claim x condition_missing"]);
    expect(problems(claim({ ...base, condition: { en: "when LLM_PROVIDER is set", pl: "gdy LLM_PROVIDER" } }))).toEqual(
      []
    );
  });

  test("T12 a claim without proofs or ledger rows, and a repeated id", () => {
    expect(problems(claim({ proofs: [] }))).toEqual(["claim x no_proof"]);
    expect(problems(claim({ ledger: [] }))).toContain("claim x no_ledger");
    expect(problems(claim(), claim())).toEqual(["claim x duplicate_id"]);
  });

  test("every problem is listed, not only the first", () => {
    const list = problems(claim({ ledger: ["C002", "C999"], proofs: ["a/missing.ts"] }));
    expect(list).toEqual([
      "claim x ledger_weak C002",
      "claim x ledger_missing C999",
      "claim x proof_missing a/missing.ts",
    ]);
  });
});

describe("parseLedger", () => {
  test("reads the id, the source and the condition of each row, and skips headings", () => {
    const rows = parseLedger(LEDGER);
    expect([...rows.keys()]).toEqual(["C001", "C002", "C003", "C004", "C005"]);
    expect(rows.get("C005")).toEqual({ id: "C005", source: "a/b.ts", condition: "LLM_PROVIDER" });
  });

  test("the real ledger has 260 rows, each with a source", () => {
    const text = readFileSync(join(import.meta.dir, "../../../../docs/legal/claims.md"), "utf8");
    const rows = parseLedger(text);
    expect(rows.size).toBe(260);
    for (const row of rows.values()) expect(row.source).not.toBe("");
  });
});

describe("proofUrl", () => {
  test("T13 links the file at the ref", () => {
    expect(proofUrl("docs/decisions/0003-x.md", "v0.3.0")).toBe(`${REPO_URL}/blob/v0.3.0/docs/decisions/0003-x.md`);
  });
  test("the default ref is master without DOCS_GIT_REF", () => {
    if (process.env.DOCS_GIT_REF === undefined) expect(proofUrl("a/b.ts")).toBe(`${REPO_URL}/blob/master/a/b.ts`);
  });
});
