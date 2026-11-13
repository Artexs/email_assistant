import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { isLlmRole, llmRoles } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { prompts, rolesWithoutPrompt } from "./index";

const promptsDir = import.meta.dir;
const modulesDir = join(import.meta.dir, "../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "prompts" ? [] : sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
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
