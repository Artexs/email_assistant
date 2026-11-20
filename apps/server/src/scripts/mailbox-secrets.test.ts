import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, test } from "bun:test";

// No operator CLI and no mail tool reads a mailbox secret itself: `openMailboxProvider` does (a password or an OAuth access token).
// A tool that decrypts or reads the stored credentials would skip the OAuth refresh and the login retry.
const scriptsDirs = [import.meta.dir, join(import.meta.dir, "lib")];
const toolsFile = resolve(import.meta.dir, "../modules/mail/tools.ts");
const MAILBOX_SECRET_READ = /\.decrypt\(|\bgetCredentials\b|\bloadImapOptions\b/;

describe("operator tools and mailbox secrets", () => {
  test("no script and no mail tool decrypts a mailbox secret or reads the stored credentials", () => {
    const files = [
      ...scriptsDirs.flatMap((dir) =>
        readdirSync(dir)
          .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
          .map((name) => join(dir, name))
      ),
      toolsFile,
    ];
    expect(files.length).toBeGreaterThan(10);
    const readers = files.filter((file) => MAILBOX_SECRET_READ.test(readFileSync(file, "utf8")));
    expect(readers).toEqual([]);
  });
});
