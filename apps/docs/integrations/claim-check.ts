// Astro integration: after the build, every claim of the security page must cite ledger rows that hold a source
// and repo files that exist and that a cited row names (`claimProblems`). Any problem fails the build with the whole list.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AstroIntegration } from "astro";
import { repoRoot } from "../src/in-place";
import { claimProblems, type PublicClaim, publicClaims } from "../src/security/claims";

export const LEDGER_PATH = "docs/legal/claims.md";

// Throws Error(`claim_check failed:\n<each problem>`); returns the number of claims when all hold.
export function checkClaims(claims: readonly PublicClaim[], root: string): number {
  const file = join(root, LEDGER_PATH);
  if (!existsSync(file)) throw new Error(`claim_check failed:\nledger_missing ${LEDGER_PATH}`);
  const problems = claimProblems(claims, root, readFileSync(file, "utf8"));
  if (problems.length > 0) throw new Error(`claim_check failed:\n${problems.join("\n")}`);
  return claims.length;
}

export default function claimCheck(claims: readonly PublicClaim[] = publicClaims): AstroIntegration {
  return {
    name: "ea-claim-check",
    hooks: {
      "astro:build:done": ({ logger }) => {
        logger.info(`claim_check ok ${checkClaims(claims, repoRoot())}`);
      },
    },
  };
}
