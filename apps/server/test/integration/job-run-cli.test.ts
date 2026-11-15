import { resolve } from "node:path";

import { describe, expect, test } from "bun:test";

const repoRoot = resolve(import.meta.dir, "../../../..");
const script = resolve(import.meta.dir, "../../src/scripts/job-run.ts");

async function runJob(args: string[]) {
  const proc = Bun.spawn(["bun", script, ...args], {
    cwd: repoRoot,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  return {
    code,
    stdout: await new Response(proc.stdout).text(),
    stderr: await new Response(proc.stderr).text(),
  };
}

describe("job:run CLI", () => {
  test("the committer warning goes to stderr and the result line to stdout", async () => {
    const result = await runJob(["--name", "actions.committer"]);

    expect(result.code).toBe(0);
    expect(result.stderr).toContain("[job-run] do not run the committer here while the server runs");
    expect(result.stdout).not.toContain("do not run the committer");
    expect(result.stdout).toContain("[job-run] actions.committer: ran once");
    expect(result.stderr).not.toContain("ran once");
  });
});
