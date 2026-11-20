import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";

import { testDb } from "./helpers";
import { jobOf, historyJobKit, withHistoryBox } from "./trust-history-helpers";

// The history check job: claim, backfill, flags wait. Committed rows, a fixed clock and the in-memory mail server;
// the model is never called (the job has no client). The two-connection rules are in trust-history-job-race.test.ts.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const { queue } = historyJobKit(db);

describe("TG6. the queue side reaches no triage code and no model client, also through its imports", () => {
  const srcRoot = resolve(import.meta.dir, "../../src");

  // The files that a start file imports, found through relative imports (`from "./x"`, `from "../mail"`), with `index.ts` and `.ts` resolved.
  function reachable(starts: string[]): Set<string> {
    const seen = new Set<string>();
    const queue = [...starts];
    while (queue.length > 0) {
      const file = queue.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/(?:from|import)\s*\(?\s*"(\.[^"]+)"/g)) {
        const base = resolve(file, "..", match[1] as string);
        for (const candidate of [`${base}.ts`, resolve(base, "index.ts")]) {
          if (existsSync(candidate)) queue.push(candidate);
        }
      }
    }
    return seen;
  }

  test("no file of the closure is in the triage module, and none calls a model or records a model call", () => {
    // `history-classify.ts` (the classify step) is the one trust file that reaches the model, through `classifyStored`.
    const closure = reachable(
      ["modules/trust/history-queue.ts", "modules/trust/history-items.ts"].map((file) => resolve(srcRoot, file))
    );
    expect(closure.size).toBeGreaterThan(5);
    expect([...closure].filter((file) => file.includes("/modules/triage/"))).toEqual([]);
    // The model client and the call record live in platform/llm and audit; nothing else of the closure may use them.
    const callers = [...closure]
      .filter((file) => !file.includes("/platform/llm/") && !file.includes("/modules/audit/"))
      .filter((file) => /createLlmClient\(|\.generate\(\{|recordLlmCall\(/.test(readFileSync(file, "utf8")));
    expect(callers).toEqual([]);
  });
});

describe("only the classify step calls the model, and no trust file writes a triage row", () => {
  const dir = resolve(import.meta.dir, "../../src/modules/trust");

  test("no trust source names the triage_results table or calls the client directly; recordLlmCall only in the classify step", () => {
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))) {
      const source = readFileSync(resolve(dir, file), "utf8");
      expect(source, file).not.toMatch(/triage_results|generate\(|createLlmClient\(|insertTriageResult/);
      if (file !== "history-classify.ts") expect(source, file).not.toMatch(/recordLlmCall/);
    }
  });

  test("the backfill and flags steps record no llm.call row (the default client of the helper throws)", async () => {
    await withHistoryBox(db, {}, async (box) => {
      await queue(box);
      const job = jobOf(db, box);
      await job.run();
      await job.run();
      const calls = await db
        .selectFrom("audit_log")
        .select("id")
        .where("org_id", "=", box.orgId)
        .where("event", "=", "llm.call")
        .execute();
      expect(calls).toEqual([]);
    });
  });
});
