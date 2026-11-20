import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { featureFlags } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { startSource } from "./start/source.test-helper";

// The trust-ladder docs name what the code has: every flag of the trust ladder, every job `trust.*` and `channels.report_mail` that
// `main.ts` schedules, the three migrations of the trust-ladder ticket, the limits that the last step left for the docs, and the accepted ADRs. A new
// flag or job that nobody wrote down fails here (same idea as `open-loops-docs.test.ts`).
const ROOT = path.resolve(import.meta.dir, "../../..");
const read = (file: string): string => readFileSync(path.join(ROOT, file), "utf8");

const page = read("docs/capabilities/trust.md");
const architecture = read("docs/architecture.md");
const decisions = read("docs/decisions/README.md");
const deployGuide = read("deploy/README.md");

const e4bFlags = Object.entries(featureFlags)
  .filter(([, flag]) => flag.epic === "E4-B")
  .map(([name]) => name);
const jobs = [...startSource().matchAll(/scheduler\.add\("(trust\.[a-z]+|channels\.report_mail)"/g)].map(
  (match) => match[1] ?? ""
);
const migrations = [
  "20261115180001_trust_ladder.sql",
  "20261117120001_history_model_failing.sql",
  "20261117140001_unsubscribe_data.sql",
];

describe("the trust-ladder docs name the code", () => {
  test("the code has the flags, jobs and migrations that the checks below read", () => {
    expect(e4bFlags.length).toBeGreaterThanOrEqual(8);
    expect(jobs.length).toBeGreaterThanOrEqual(4);
    for (const migration of migrations) {
      expect({ migration, exists: existsSync(path.join(ROOT, "db/migrations", migration)) }).toEqual({
        migration,
        exists: true,
      });
    }
  });

  test("every flag of epic E4-B is in the flag table and in the deploy guide", () => {
    for (const name of e4bFlags) {
      expect({ name, page: page.includes(`| \`${name}\``) }).toEqual({ name, page: true });
      expect({ name, deploy: deployGuide.includes(`\`${name}\``) }).toEqual({ name, deploy: true });
    }
  });

  test("every trust job and the report mail job is on the page and in the jobs table of the architecture", () => {
    for (const job of jobs) {
      expect({ job, page: page.includes(`\`${job}\``) }).toEqual({ job, page: true });
      expect({ job, architecture: architecture.includes(`| \`${job}\``) }).toEqual({ job, architecture: true });
    }
  });

  test("the rollback names the three migrations and the stuck outbox batch", () => {
    for (const migration of migrations) {
      expect({ migration, page: page.includes(migration) }).toEqual({ migration, page: true });
      expect({ migration, deploy: deployGuide.includes(migration) }).toEqual({ migration, deploy: true });
    }
    expect(page).toContain("so one new row blocks the sender of every organization");
    expect(deployGuide).toContain("`claimDueOutbox`");
  });

  test("the one-click limits stay on the page", () => {
    expect(page).toContain("needs EVERY stored signature of the passing `header.d` to name both");
    expect(page).not.toContain("does NOT check that the DKIM signature covers");
    expect(page).toContain("NEWEST mail of the sender");
    expect(page).toContain("NAT64 `64:ff9b::/96` is refused");
    expect(page).toContain("counts a domain that the sender chooses");
    expect(page).toContain("may name only providers that write their own `Authentication-Results` on top");
  });

  test("the page lists what a legal text change would need", () => {
    expect(page).toContain("What needs a bump");
    expect(page).toContain("`TERMS_VERSION`");
  });

  test("ADR 0028 and ADR 0022 are accepted in the index", () => {
    expect(decisions).toMatch(/^\| 0028 \| Autonomy earned from global evidence[^|]*\| accepted[^|]*\|$/m);
    expect(decisions).toMatch(/^\| 0022 \| Report mail goes into the user's own INBOX[^|]*\| accepted[^|]*\|$/m);
    expect(read("docs/decisions/0028-autonomy-evidence-without-user-labels.md")).toMatch(/^- Status: accepted/m);
    expect(read("docs/decisions/0022-report-mail-into-own-inbox.md")).toMatch(/^- Status: accepted/m);
  });
});
