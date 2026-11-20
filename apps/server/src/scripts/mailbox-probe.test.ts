import { resolve } from "node:path";

import type { TCPSocketListener } from "bun";
import { afterEach, describe, expect, test } from "bun:test";

const entry = resolve(import.meta.dir, "mailbox-probe.ts");
const repoRoot = resolve(import.meta.dir, "../../../..");

let server: TCPSocketListener | undefined;

afterEach(() => {
  server?.stop(true);
  server = undefined;
});

// A listener that counts connections: a probe that passes the address guard connects to it.
function listen(): { port: number; connections: () => number } {
  let count = 0;
  const listener = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open() {
        count += 1;
      },
      data() {
        // The listener never answers: a probe that connects only waits.
      },
    },
  });
  server = listener;
  return { port: listener.port, connections: () => count };
}

async function run(args: string[], env: Record<string, string>) {
  const proc = Bun.spawn(["bun", "--no-env-file", entry, ...args], {
    cwd: repoRoot,
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", MAIL_ALLOW_LOCAL_HOSTS: "true", ...env },
    stdin: new Response("pw\n"),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

describe("mailbox-probe address guard", () => {
  test("move refuses an address that is not TEST_MAILBOX_ADDRESS and opens no connection", async () => {
    const { port, connections } = listen();
    const result = await run(
      ["move", "--host", "127.0.0.1", "--port", String(port), "--address", "other@example.test"],
      { TEST_MAILBOX_ADDRESS: "probe@example.test" }
    );
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("[mailbox-probe-move] failed: the address is not the test mailbox");
    expect(connections()).toBe(0);
  });

  test("send refuses a missing TEST_MAILBOX_ADDRESS and opens no connection", async () => {
    const { port, connections } = listen();
    const result = await run(
      [
        "send",
        ...["--host", "127.0.0.1", "--port", String(port), "--address", "other@example.test"],
        ...["--smtp-host", "127.0.0.1", "--smtp-port", String(port), "--to", "other@example.test"],
      ],
      {}
    );
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("[mailbox-probe-send] failed: TEST_MAILBOX_ADDRESS is not set");
    expect(connections()).toBe(0);
  });

  test("a bad subcommand prints the usage and exits 2", async () => {
    const result = await run(["drop"], {});
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("[mailbox-probe] usage:");
  });
});
