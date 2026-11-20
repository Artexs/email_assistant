import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { parseEvalArgs } from "../eval-args";

import { loadSource, replyFactsCaseSchema } from "./eval-drafter-source";

const factsPath = resolve(import.meta.dir, "../../../../../evals/cases/reply-facts.json");
const cases = z.array(replyFactsCaseSchema).parse(JSON.parse(readFileSync(factsPath, "utf8")));
// The two cases whose instruction line is in the other language than the mail.
const OTHER_LANGUAGE = ["rfct-06", "rfct-12"];

describe("the reply facts set file", () => {
  test("holds 12 cases with unique ids, 6 per language, all dev needs_reply", () => {
    expect(cases.map((c) => c.id)).toEqual(
      Array.from({ length: 12 }, (_, i) => `rfct-${String(i + 1).padStart(2, "0")}`)
    );
    expect(cases.filter((c) => c.lang === "pl")).toHaveLength(6);
    expect(cases.filter((c) => c.lang === "en")).toHaveLength(6);
    expect(cases.every((c) => c.expected.category === "needs_reply" && c.sim?.part === "dev")).toBe(true);
  });

  test("each instruction is one clean line of at most 300 characters", () => {
    for (const c of cases) {
      expect(c.instruction).not.toContain("\n");
      expect(c.instruction.length).toBeLessThanOrEqual(300);
      expect(c.instruction).not.toMatch(/@|https?:|www\.|\d{7,}/);
    }
  });

  test("each fact of a case where the line is in the other language is a number, a time or a name of the line", () => {
    const foreign = cases.filter((c) => OTHER_LANGUAGE.includes(c.id));
    expect(foreign).toHaveLength(2);
    for (const c of foreign) {
      for (const forms of c.mustHold) {
        for (const form of forms) {
          const numeric = /^\d+([:.]\d+)?$/.test(form);
          const nameOfLine = /^\p{Lu}\p{L}+$/u.test(form) && c.instruction.includes(form);
          expect({ id: c.id, form, ok: numeric || nameOfLine }).toEqual({ id: c.id, form, ok: true });
        }
      }
    }
  });

  test("loads through --set reply-facts with the fixed persona and its key", async () => {
    const options = parseEvalArgs(["--set", "reply-facts", "--drafter"]);
    const source = await loadSource(options, {});
    expect(source.key).toBe("reply-facts");
    expect(source.data).toBe("reply facts set (dev only), 12 cases");
    expect(source.cases).toHaveLength(12);
  });
});
