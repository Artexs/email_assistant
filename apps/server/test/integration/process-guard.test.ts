import path from "node:path";

import { expect, test } from "bun:test";

const repoRoot = path.resolve(import.meta.dir, "../../../..");

async function crash(mode: "console" | "reject" | "throw"): Promise<{ code: number; lines: string[] }> {
  const proc = Bun.spawn(["bun", "apps/server/test/integration/crash-entry.ts", mode], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const lines = `${stdout}\n${stderr}`.split("\n").filter((line) => line.trim() !== "");
  return { code, lines };
}

test("an unhandled rejection writes one event with errorFields and exits 1", async () => {
  const { code, lines } = await crash("reject");
  expect(code).toBe(1);
  expect(lines.join("\n")).not.toContain("MARKER");
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0] ?? "")).toMatchObject({ event: "process_unhandled_rejection", error: "Error" });
});

test("an uncaught exception writes one event with errorFields and exits 1", async () => {
  const { code, lines } = await crash("throw");
  expect(code).toBe(1);
  expect(lines.join("\n")).not.toContain("MARKER");
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0] ?? "")).toMatchObject({ event: "process_uncaught_exception", error: "Error" });
});

test("a library console.error writes one console_output event and no text", async () => {
  const { code, lines } = await crash("console");
  expect(code).toBe(0);
  expect(lines.join("\n")).not.toContain("MARKER");
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0] ?? "")).toMatchObject({ event: "console_output", level: "warn", dropped_fields: 1 });
});
