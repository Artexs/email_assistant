import { readFileSync } from "node:fs";
import path from "node:path";

import { featureFlags } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { startSource } from "./start/source.test-helper";

// The open-loops page and the architecture jobs table must name what the code has: every flag of the open loops and every job
// `loops.*` that `main.ts` schedules. A new loop flag or job that nobody wrote down fails here.
const ROOT = path.resolve(import.meta.dir, "../../..");
const read = (file: string): string => readFileSync(path.join(ROOT, file), "utf8");

const page = read("docs/capabilities/open-loops.md");
const architecture = read("docs/architecture.md");
const decisions = read("docs/decisions/README.md");

const e5bFlags = Object.entries(featureFlags)
  .filter(([, flag]) => flag.epic === "E5b")
  .map(([name]) => name);
const loopJobs = [...startSource().matchAll(/scheduler\.add\("(loops\.[a-z]+)"/g)].map((match) => match[1] ?? "");

describe("the open-loops docs name the code", () => {
  test("the code has the flags and jobs that the checks below read", () => {
    expect(e5bFlags.length).toBeGreaterThanOrEqual(2);
    expect(loopJobs.length).toBeGreaterThanOrEqual(3);
  });

  test("every flag of epic E5b is on the page", () => {
    for (const name of e5bFlags) {
      expect({ name, named: page.includes(`\`${name}\``) }).toEqual({ name, named: true });
    }
  });

  test("every loops job is on the page and in the jobs table of the architecture", () => {
    for (const job of loopJobs) {
      expect({ job, page: page.includes(`\`${job}\``) }).toEqual({ job, page: true });
      expect({ job, architecture: architecture.includes(`| \`${job}\``) }).toEqual({ job, architecture: true });
    }
  });

  test("ADR 0036 is accepted in the index", () => {
    expect(decisions).toMatch(
      /^\| 0036 \| Open loops: one module, one chaser, a loop anchor for actions\s+\| accepted\s+\|$/m
    );
  });
});
