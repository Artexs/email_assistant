import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const repoRoot = resolve(import.meta.dir, "../../../..");
const checkScript = resolve(import.meta.dir, "../../src/scripts/telegram-check.ts");
const token = "123456:ROOTTESTaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const paths: string[] = [];
let fake: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  fake = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      paths.push(new URL(request.url).pathname);
      return Response.json({
        ok: true,
        result: { id: 77, is_bot: true, first_name: "T", username: "root_test_bot" },
      });
    },
  });
});

afterAll(async () => {
  await fake.stop(true);
});

async function runCheck(apiRoot: string): Promise<{ code: number; output: string }> {
  const proc = Bun.spawn(["bun", checkScript], {
    cwd: repoRoot,
    env: { ...process.env, TELEGRAM_BOT_TOKEN: token, TELEGRAM_API_ROOT: apiRoot },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, output: `${stdout}${stderr}` };
}

describe("telegram:check with TELEGRAM_API_ROOT", () => {
  test("talks to a loopback root", async () => {
    const { code, output } = await runCheck(`http://127.0.0.1:${fake.port}`);
    expect(output).toContain("@root_test_bot");
    expect(code).toBe(0);
    expect(paths).toContain(`/bot${token}/getMe`);
  });

  test("refuses a non-loopback root, with no token in the output", async () => {
    const { code, output } = await runCheck("https://api.telegram.org");
    expect(code).toBe(1);
    expect(output).toContain("TELEGRAM_API_ROOT");
    expect(output).not.toContain(token);
  });
});
