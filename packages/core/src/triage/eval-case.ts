import { createHash } from "node:crypto";

import { z } from "zod";

import { senderRuleKinds } from "./rules";
import { senderHistorySchema } from "./sender-history";
import { urgencyProfileSchema, urgencySources } from "./urgency-profile";

// The receivedAt of every eval case. "Today" in a case text is 2026-11-02 (a Monday).
export const EVAL_RECEIVED_AT = new Date("2026-11-02T09:00:00Z");

// A deterministic uuid per delegate key: the payload schemas need a uuid (D2) and a mail cannot know it.
export function delegateIdOf(key: string): string {
  return `00000000-0000-4000-8000-${createHash("sha256").update(key).digest("hex").slice(0, 12)}`;
}

export const evalCaseSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  kind: z.enum(["synthetic", "injection"]),
  lang: z.enum(["pl", "en", "de"]),
  from: z.string(),
  to: z.array(z.string()).min(1),
  cc: z.array(z.string()).default([]),
  subject: z.string(),
  body: z.string(),
  // When set, the runner uses it instead of EVAL_RECEIVED_AT.
  receivedAt: z.iso.datetime().optional(),
  thread: z
    .array(
      z.object({ from: z.string(), subject: z.string(), body: z.string(), receivedAt: z.iso.datetime().optional() })
    )
    .default([]),
  senderRules: z.array(z.object({ pattern: z.string(), kind: z.enum(senderRuleKinds) })).default([]),
  delegates: z
    .array(
      z.object({
        key: z.string().regex(/^[a-z0-9-]+$/),
        name: z.string().min(1),
        tags: z.array(z.string()).default([]),
      })
    )
    .default([]),
  expected: z.object({
    category: z.enum(["urgent", "needs_reply", "info", "notification", "spam", "delegation"]),
    delegate: z.string().optional(),
    draft: z.enum(["delegation", "clarification", "none"]).optional(),
  }),
  note: z.string().optional(),
  // Ground truth and facts of a generated lab case; the 108 old cases have none.
  sim: z
    .object({
      corpus: z.string(),
      version: z.string(),
      part: z.enum(["dev", "holdout", "week"]),
      slotId: z.string(),
      urgencySource: z.enum(urgencySources).optional(),
      hardCases: z.array(z.string()).default([]),
      senderHistory: senderHistorySchema.optional(),
      urgencyProfile: urgencyProfileSchema.optional(),
      headers: z.record(z.string(), z.string()).default({}),
      attachments: z.array(z.object({ name: z.string(), mime: z.string(), sizeBytes: z.number() })).default([]),
      expectedPoints: z.array(z.string()).optional(),
      mustNot: z.array(z.string()).optional(),
      planted: z.array(z.string()).optional(),
    })
    .strict()
    .optional(),
});

export type EvalCase = z.infer<typeof evalCaseSchema>;

function byId(a: EvalCase, b: EvalCase): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function hasKind(evalCase: EvalCase, kinds: readonly string[]): boolean {
  return evalCase.senderRules.some((rule) => kinds.includes(rule.kind));
}

// Priority: (1) first whitelist/vip case, (2) first blocklist-only case, (3) cases without rules, (4) the rest.
function prioritize(cases: readonly EvalCase[]): EvalCase[] {
  const sorted = [...cases].sort(byId);
  const first = sorted.find((c) => hasKind(c, ["whitelist", "vip"]));
  const second = sorted.find((c) => hasKind(c, ["blocklist"]) && !hasKind(c, ["whitelist", "vip"]));
  const picked = new Set([first, second]);
  const noRules = sorted.filter((c) => !picked.has(c) && c.senderRules.length === 0);
  const rest = sorted.filter((c) => !picked.has(c) && c.senderRules.length > 0);
  return [first, second, ...noRules, ...rest].filter((c): c is EvalCase => c !== undefined);
}

export function selectCases(cases: readonly EvalCase[], opts: { perCategory?: number }): EvalCase[] {
  const n = opts.perCategory;
  if (n === undefined) return [...cases].sort(byId);

  const selected: EvalCase[] = [];
  const synthetic = cases.filter((c) => c.kind === "synthetic");
  const categories = new Set(synthetic.map((c) => c.expected.category));
  for (const category of categories) {
    selected.push(...prioritize(synthetic.filter((c) => c.expected.category === category)).slice(0, n));
  }
  selected.push(
    ...cases
      .filter((c) => c.kind === "injection")
      .sort(byId)
      .slice(0, n)
  );
  return selected.sort(byId);
}
