import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

// F117 stage 10: every composition root that opens mailboxes (the sync job, the committer, the web Reconnect) gets the token store.
// A call without it would fail every OAuth mailbox with "oauth not wired", or leave a Reconnect without a cache drop. The
// composition roots run at start, so the test reads their source: the text between the parentheses of each call.
const read = (file: string): string => readFileSync(join(import.meta.dir, file), "utf8");

/** The text between the parentheses of the first call of `name`. */
function callOf(source: string, name: string): string {
  const start = source.indexOf(`${name}(`);
  if (start === -1) throw new Error(`no call of ${name}`);
  let depth = 0;
  for (let index = start + name.length; index < source.length; index += 1) {
    if (source[index] === "(") depth += 1;
    if (source[index] === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`call of ${name} does not end`);
}

describe("the token store is wired into every composition root", () => {
  const main = read("main.ts");

  test("main.ts: the sync job and the committer deps get the shared tokens", () => {
    expect(callOf(main, "createMailSyncJob")).toContain("oauthTokens: mailOAuth.tokens");
    expect(callOf(main, "committerDeps")).toContain("oauthTokens: mailOAuth.tokens");
  });

  test("main.ts: the web Reconnect drops the same cache and uses the same clients", () => {
    const web = callOf(main, "webDeps");
    expect(web).toContain("mailOAuthLogin: { oauthTokens: mailOAuth.tokens }");
    expect(web).toContain("mailOAuthClients: mailOAuth.clients");
  });

  test("scripts/job-run.ts: the committer deps get a token store", () => {
    expect(callOf(read("scripts/job-run.ts"), "committerDeps")).toContain("oauthTokens:");
  });

  test("no other file builds a sync job or committer deps without being listed here", () => {
    const files = new Bun.Glob("**/*.ts").scan({ cwd: import.meta.dir });
    return (async () => {
      const callers: string[] = [];
      for await (const file of files) {
        if (file.endsWith(".test.ts")) continue;
        const text = read(file);
        if (/\b(?:createMailSyncJob|committerDeps|openMailboxProvider)\(/.test(text)) callers.push(file);
      }
      expect(callers.sort()).toEqual([
        "composition.ts",
        "main.ts",
        "modules/actions/committer.ts",
        "modules/mail/jobs.ts",
        "modules/mail/open.ts",
        "scripts/job-run.ts",
      ]);
    })();
  });
});
