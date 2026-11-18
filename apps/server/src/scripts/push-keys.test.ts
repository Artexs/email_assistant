import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { decodeBase64Url, vapidPublicKeyOf } from "../platform/vapid-keys";

const script = join(import.meta.dir, "push-keys.ts");

async function run(args: string[]): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn(["bun", script, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { PATH: process.env.PATH ?? "" },
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, out, err };
}

// The keys of this run are throw-away: they are checked as booleans, so a failure never prints them.
describe("push:keys", () => {
  test("prints a matching pair and a subject line through the CLI output, with no config and no env", async () => {
    const { code, out, err } = await run([]);
    expect(code).toBe(0);
    expect(err).toBe("");
    const lines = out.trim().split("\n");
    expect(lines.every((line) => line.startsWith("[push-keys] "))).toBe(true);
    const value = (name: string): string => lines.find((line) => line.includes(`${name}=`))?.split(`${name}=`)[1] ?? "";
    const publicKey = value("VAPID_PUBLIC_KEY");
    const privateKey = value("VAPID_PRIVATE_KEY");
    expect({
      publicSize: decodeBase64Url(publicKey)?.length,
      privateSize: decodeBase64Url(privateKey)?.length,
      match: vapidPublicKeyOf(privateKey) === publicKey,
      subject: value("VAPID_SUBJECT").startsWith("mailto:"),
    }).toEqual({ publicSize: 65, privateSize: 32, match: true, subject: true });
  });

  test("refuses an argument and prints no key", async () => {
    const { code, out, err } = await run(["--write"]);
    expect({ code, out, usage: err.includes("usage:") }).toEqual({ code: 1, out: "", usage: true });
  });

  test("the script writes no file and no log line, and reads no config", () => {
    const text = readFileSync(script, "utf8");
    expect(
      /node:fs|writeFile|Bun\.write|createLog|loadConfig|process\.env|console\./.test(text.replace(/^\/\/.*$/gm, ""))
    ).toBe(false);
  });
});
