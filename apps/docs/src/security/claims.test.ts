import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { sevenDayLimitProblems } from "@ea/core";

import { REPO_URL, repoRoot } from "../in-place";
import { claimProblems, parseLedger, type PublicClaim, proofUrl, publicClaims } from "./claims";

// The two security pages and the heading of the section that says what the product does not promise.
const PAGES = [
  { file: "../content/docs/security.mdx", heading: "## What this product does not promise" },
  { file: "../content/docs/pl/security.mdx", heading: "## Czego ten produkt nie obiecuje" },
];
function readPage(file: string): string {
  return readFileSync(join(import.meta.dir, file), "utf8");
}

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

  test("the real ledger has 266 rows, each with a source", () => {
    const text = readFileSync(join(import.meta.dir, "../../../../docs/legal/claims.md"), "utf8");
    const rows = parseLedger(text);
    expect(rows.size).toBe(266);
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

describe("the public claims of the security page", () => {
  const ledgerText = readFileSync(join(import.meta.dir, "../../../../docs/legal/claims.md"), "utf8");

  test("T1 the claim check finds no problem at HEAD", () => {
    expect(claimProblems(publicClaims, repoRoot(), ledgerText)).toEqual([]);
  });

  test("T2 every claim has an English and a Polish text with no angle bracket and no TODO", () => {
    expect(publicClaims.length).toBeGreaterThanOrEqual(5);
    for (const claim of publicClaims) {
      const texts = [claim.text.en, claim.text.pl, claim.condition?.en ?? "x", claim.condition?.pl ?? "x"];
      for (const text of texts) {
        expect(text.trim()).not.toBe("");
        expect(text).not.toMatch(/[<>]|TODO/);
      }
      expect(claim.id).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  test("T3 the first claim is never-sends-alone and its ledger holds the send-approval row", () => {
    expect(publicClaims[0]?.id).toBe("never-sends-alone");
    expect(publicClaims[0]?.ledger).toContain("C018");
    expect(parseLedger(ledgerText).get("C018")?.source).toContain("drafts-and-send.md");
  });

  test("the order is the order of the page, and no claim text or condition names a condition by a config key or a provider that is off by default", () => {
    expect(publicClaims.map((claim) => claim.id)).toEqual([
      "never-sends-alone",
      "mail-storage",
      "ai-provider-receives",
      "ai-provider-keeps",
      "telegram",
      "backups",
      "logs",
      "healthchecks",
      "retention",
      "export-and-delete",
      "undo",
      "shadow-first",
      "private-panel",
    ]);
    for (const claim of publicClaims) {
      for (const text of [claim.text.en, claim.text.pl, claim.condition?.en ?? "", claim.condition?.pl ?? ""]) {
        expect(text).not.toMatch(/gemini/i);
        expect(text).not.toMatch(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/);
      }
    }
  });

  test("a claim that cites a ledger row that names Gemini says so only with the condition: optional, off by default", () => {
    const rows = parseLedger(ledgerText);
    const geminiRows = new Set(
      [...rows.values()]
        .filter((row) => /gemini/i.test(row.source) || /gemini/i.test(row.condition))
        .map((row) => row.id)
    );
    for (const claim of publicClaims) {
      if (!claim.ledger.some((id) => geminiRows.has(id))) continue;
      expect(claim.condition?.en.toLowerCase()).toContain("optional, off by default");
    }
  });

  // The 7-day limit check is shared with the papers (`sevenDayLimitProblems` in `@ea/core`).
  test("a text that names the 7-day limit also names the thread context", () => {
    expect(sevenDayLimitProblems(["It does not send mail older than 7 days."])).toEqual([
      "It does not send mail older than 7 days.",
    ]);
    expect(sevenDayLimitProblems(["Nie wysyła wiadomości starszych niż 7 dni."]).length).toBe(1);
    // The first wording of the claim named "context" for another reason and still said the false thing.
    expect(
      sevenDayLimitProblems([
        "It sends up to three earlier mails of the same thread as context. It does not send mail older than 7 days.",
      ]).length
    ).toBe(1);
    expect(sevenDayLimitProblems(["Mail older than 7 days is not classified; context mails can be older."])).toEqual(
      []
    );
  });

  test("no claim, in either language, and no line of the page names the 7-day limit without the thread context", () => {
    const claimTexts = publicClaims.flatMap((claim) => [
      claim.text.en,
      claim.text.pl,
      claim.condition?.en ?? "",
      claim.condition?.pl ?? "",
    ]);
    expect(sevenDayLimitProblems(claimTexts)).toEqual([]);
    for (const { file } of PAGES) {
      expect(sevenDayLimitProblems(readPage(file).split("\n"))).toEqual([]);
    }
  });

  test("the claim ai-provider-receives cites the context row and the history-check row, with the numbers", () => {
    const receives = publicClaims.find((claim) => claim.id === "ai-provider-receives");
    expect(receives?.ledger).toContain("C261");
    expect(receives?.ledger).toContain("C262");
    expect(receives?.text.en).toMatch(/500 characters/);
    expect(receives?.text.en).toMatch(/can be older than 7 days/);
    expect(receives?.text.pl).toMatch(/500 znaków/);
  });

  // The shared 7-day scan reads a whole text, so another sentence with "context" and "classif" would hide a dropped one: each sentence is pinned here.
  test("the claim ai-provider-receives keeps each sentence of what is sent, in both languages", () => {
    const receives = publicClaims.find((claim) => claim.id === "ai-provider-receives");
    const { en, pl } = receives?.text ?? { en: "", pl: "" };
    // The 7-day rule and its exceptions: the one-off backfill and the history check.
    expect(en).toMatch(
      /does not classify a mail that is older than 7 days, unless the operator loads old mail once or the optional history check runs/
    );
    expect(pl).toMatch(
      /nie klasyfikuje wiadomości starszej niż 7 dni, chyba że operator jednorazowo załaduje starszą pocztę albo działa opcjonalna kontrola historii/
    );
    // A context mail can be older than 7 days.
    expect(en).toMatch(/can be older than 7 days/);
    expect(pl).toMatch(/może być starsza niż 7 dni/);
    // The history check: size, window, off by default.
    expect(en).toMatch(/off by default, classifies up to 500 mails of the last 30 days/);
    expect(pl).toMatch(/domyślnie wyłączona, klasyfikuje do 500 wiadomości z ostatnich 30 dni/);
    // Up to three earlier mails of the thread go along as context.
    expect(en).toMatch(/up to three earlier mails of the same thread as context/);
    expect(pl).toMatch(/do trzech wcześniejszych wiadomości z tego samego wątku jako kontekst/);
    // The operator can start the check by hand, also with the feature off.
    expect(en).toMatch(
      /operator of the install can also start that check by hand, and it then runs when the feature is off/
    );
    expect(pl).toMatch(
      /Operator instalacji może też uruchomić tę kontrolę ręcznie, a wtedy działa ona także przy wyłączonej funkcji/
    );
    // The sender marks.
    expect(en).toMatch(/whether the sender is on the whitelist or the VIP list or looks automatic/);
    expect(pl).toMatch(/czy nadawca jest na białej liście lub liście VIP albo wygląda na automatyczny/);
  });

  test("the short-list line of the claim names the two exceptions of the 7-day rule, in both languages", () => {
    const [en, pl] = PAGES.map(
      ({ file }) =>
        readPage(file)
          .split("\n")
          .find((line) => line.includes("#claim-ai-provider-receives")) ?? ""
    );
    expect(en).toMatch(/unless the operator loads old mail once or the optional history check runs/);
    expect(pl).toMatch(
      /chyba że operator jednorazowo załaduje starszą pocztę albo działa opcjonalna kontrola historii/
    );
  });

  test("the section of what the product does not promise holds no line about the 7-day limit, in either language", () => {
    for (const { file, heading } of PAGES) {
      const lines = readPage(file).split("\n");
      const start = lines.findIndex((line) => line.trim() === heading);
      expect(start).toBeGreaterThanOrEqual(0);
      const rest = lines.slice(start + 1);
      const end = rest.findIndex((line) => line.startsWith("## "));
      const section = end === -1 ? rest : rest.slice(0, end);
      expect(section.length).toBeGreaterThan(0);
      expect(section.filter((line) => /\b7\b|siedem|seven/i.test(line))).toEqual([]);
    }
  });
});
