import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { isLlmRole, llmRoles } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { classifierV3Parts, classifierVersionIds, classifierVersions, prompts, rolesWithoutPrompt } from "./index";

const promptsDir = import.meta.dir;
const modulesDir = join(import.meta.dir, "../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "prompts" ? [] : sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".test-helper.ts")
      ? [path]
      : [];
  });
}

describe("prompt registry", () => {
  test("every LLM role is in exactly one of `prompts` and `rolesWithoutPrompt`", () => {
    for (const role of llmRoles) {
      const inPrompts = Object.hasOwn(prompts, role);
      const without = Object.hasOwn(rolesWithoutPrompt, role);
      expect(`${role}:${inPrompts !== without}`).toBe(`${role}:true`);
    }
  });

  test("each entry has its key as role, a version of that role and a file with that PROMPT_VERSION", async () => {
    for (const [key, entry] of Object.entries(prompts)) {
      expect(entry.role as string).toBe(key);
      expect(entry.version).toMatch(new RegExp(`^${key}-v\\d+$`));
      const file = (await import(join(promptsDir, `${entry.version}.ts`))) as { PROMPT_VERSION: string };
      expect(file.PROMPT_VERSION).toBe(entry.version);
    }
  });

  test("every `<role>-v<n>.ts` file names a role and holds its own file name as PROMPT_VERSION", async () => {
    const files = readdirSync(promptsDir).filter((name) => /^([a-z]+)-v(\d+)\.ts$/.test(name));
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const role = /^([a-z]+)-v/.exec(name)?.[1] ?? "";
      expect(`${name}:${isLlmRole(role)}`).toBe(`${name}:true`);
      const file = (await import(join(promptsDir, name))) as { PROMPT_VERSION: string };
      expect(file.PROMPT_VERSION).toBe(name.replace(/\.ts$/, ""));
    }
  });

  test("`readsExtras` is true exactly for the versions whose user prompt changes with the extras", () => {
    const email = {
      from: "a@x.test",
      to: ["b@x.test"],
      cc: [],
      subject: "Hello",
      receivedAt: new Date("2026-11-18T10:00:00Z"),
      bodyText: "Body",
      thread: [],
    };
    const sender = { whitelisted: false, vip: false, noreply: false };
    const extras = {
      attachments: [{ name: "plan.pdf", type: "application/pdf", size: 10 }],
      isList: true,
      senderHistory: { days: 30, received: 12, corrections: { info: 2 } },
      senderProfile: null,
      urgency: { today: "2026-11-18", topics: [{ label: "Audit", keywords: ["audit"] }], deadlines: [] },
    };
    const empty = { attachments: [], isList: false, senderHistory: null, senderProfile: null, urgency: null };
    for (const id of classifierVersionIds) {
      const entry = classifierVersions[id];
      const build = (value: typeof extras | typeof empty) =>
        entry.buildUser(email, sender, [], "nonce", value, classifierV3Parts);
      expect(`${id}:${build(extras) !== build(empty)}`).toBe(`${id}:${entry.readsExtras}`);
    }
  });

  test("module code outside prompts/ compares no classifier version with a literal", () => {
    const problems: string[] = [];
    for (const file of sourceFiles(modulesDir)) {
      if (/[!=]==\s*["'`]classifier-v\d+["'`]/.test(readFileSync(file, "utf8"))) problems.push(file);
    }
    expect(problems).toEqual([]);
  });

  test("module code outside prompts/ holds no version literal and no role literal of a role without a prompt", () => {
    const problems: string[] = [];
    for (const file of sourceFiles(modulesDir)) {
      const text = readFileSync(file, "utf8");
      if (/promptVersion:\s*["'`]/.test(text)) problems.push(`${file}: promptVersion literal`);
      for (const match of text.matchAll(/\brole:\s*"([a-z]+)"/g)) {
        const role = match[1] ?? "";
        if (isLlmRole(role) && !Object.hasOwn(prompts, role))
          problems.push(`${file}: role "${role}" has no prompt entry`);
      }
    }
    expect(problems).toEqual([]);
  });
});
