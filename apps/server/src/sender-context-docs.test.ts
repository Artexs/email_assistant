import { readFileSync } from "node:fs";
import path from "node:path";

import { featureFlags, noticeViewSchemas } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { startSource } from "./start/source.test-helper";

// The sender-context docs name what the code has: every flag of the epic, the job that `main.ts` schedules, the log events, the
// accepted ADR, the order of the flags in the deploy guide, and the rollback SQL for each strict outbox view that holds a key of
// the feature. A new flag, job or view key that nobody wrote down fails here (same idea as `open-loops-docs.test.ts`).
const ROOT = path.resolve(import.meta.dir, "../../..");
const read = (file: string): string => readFileSync(path.join(ROOT, file), "utf8");

const page = read("docs/capabilities/sender-context.md");
const architecture = read("docs/architecture.md");
const decisions = read("docs/decisions/README.md");
const adr = read("docs/decisions/0034-sender-profiles-from-counts.md");
const deployGuide = read("deploy/README.md");

const flags = Object.entries(featureFlags)
  .filter(([, flag]) => flag.epic === "E11a")
  .map(([name]) => name);
const jobs = [...startSource().matchAll(/scheduler\.add\("(contacts\.[a-z]+)"/g)].map((match) => match[1] ?? "");

// The section of the deploy guide, from its heading to the next `## ` heading.
function deploySection(): string {
  const start = deployGuide.indexOf("\n## Sender context (F120)\n");
  expect(start).toBeGreaterThan(-1);
  return deployGuide.slice(start, deployGuide.indexOf("\n## ", start + 1));
}

describe("the sender-context docs name the code", () => {
  test("the code has the flags and the job that the checks below read", () => {
    expect(flags).toEqual(["sender_context", "contact_wait", "sender_suggestions"]);
    expect(jobs).toEqual(["contacts.refresh"]);
  });

  test("every flag of epic E11a is on the page and in the deploy guide, and each has the remove-by date of the plan", () => {
    const section = deploySection();
    for (const name of flags) {
      expect({ name, page: page.includes(`\`${name}\``) }).toEqual({ name, page: true });
      expect({ name, deploy: section.includes(`\`${name}\``) }).toEqual({ name, deploy: true });
      expect({ name, removeBy: (featureFlags as Record<string, { removeBy: string }>)[name]?.removeBy }).toEqual({
        name,
        removeBy: "2027-06-01",
      });
    }
  });

  test("every contacts job is on the page and in the jobs table of the architecture", () => {
    for (const job of jobs) {
      expect({ job, page: page.includes(`\`${job}\``) }).toEqual({ job, page: true });
      expect({ job, architecture: architecture.includes(`| \`${job}\``) }).toEqual({ job, architecture: true });
    }
  });

  test("the log events that the page names are in the code", () => {
    const code = [
      "apps/server/src/modules/contacts/jobs.ts",
      "apps/server/src/modules/contacts/suggest.ts",
      "apps/server/src/modules/loops/analyze-write.ts",
    ]
      .map(read)
      .join("\n");
    const events = [
      "contacts_refresh_done",
      "contacts_refresh_mailbox_failed",
      "contacts_suggestion_refused",
      "contact_wait_failed",
    ];
    for (const event of events) {
      expect({ event, page: page.includes(`\`${event}\``), code: code.includes(`"${event}"`) }).toEqual({
        event,
        page: true,
        code: true,
      });
    }
  });

  test("ADR 0034 is accepted in the index and in its file, with the amendment", () => {
    expect(decisions).toMatch(
      /^\| 0034 \| Sender profiles hold counts under a keyed hash, never mail text\s+\| accepted with amendments \(F120\)\s+\|$/m
    );
    expect(adr).toMatch(/^- Status: accepted \(F120, 2026-11-19\)/m);
    expect(adr).toContain("## Amendment (F120, 2026-11-19)");
  });

  test("the deploy guide turns the flags on in the order of the plan and turns them off in the reverse order", () => {
    const section = deploySection();
    const on = section.slice(section.indexOf("### Turn the flags on"), section.indexOf("### Roll back"));
    const order = (text: string) => flags.map((name) => text.indexOf(`\`${name}\``));
    const [context, wait, suggestions] = order(on);
    expect(context).toBeGreaterThan(-1);
    expect(wait).toBeGreaterThan(context ?? 0);
    expect(suggestions).toBeGreaterThan(wait ?? 0);
    expect(section).toContain("`sender_suggestions`, `contact_wait`, `sender_context`");
  });
});

// The old release parses the view of an outbox row with a strict schema, so a pending row with a key that it does not know
// blocks the notice sender. The keys that this feature adds to a view are listed here: the rollback must fail the rows that hold
// one. A view schema that gets a new key of the feature and is not on this list fails the first test; a kind that is on the
// list and not in the rollback SQL fails the second.
const FEATURE_VIEW_KEYS: Record<string, readonly string[]> = { weekly_report: ["suggestions"] };
const FEATURE_KEY_NAMES = ["suggestions", "usualReplyDays", "senderLine", "usualReply"];

describe("the rollback SQL covers each strict view that holds a key of the feature", () => {
  test("only the listed kinds hold a top-level key of the feature in their view schema", () => {
    const found: Record<string, string[]> = {};
    for (const [kind, schema] of Object.entries(noticeViewSchemas)) {
      const shape = (schema as { shape?: Record<string, unknown> }).shape ?? {};
      const keys = FEATURE_KEY_NAMES.filter((name) => name in shape);
      if (keys.length > 0) found[kind] = keys;
    }
    expect(found).toEqual(FEATURE_VIEW_KEYS as Record<string, string[]>);
  });

  test("the rollback SQL fails the pending rows of each listed kind that hold one of its keys", () => {
    const section = deploySection();
    const sqlStart = section.indexOf("<<'SQL'");
    const rollback = section.slice(sqlStart, section.indexOf("\n   SQL\n", sqlStart));
    for (const [kind, keys] of Object.entries(FEATURE_VIEW_KEYS)) {
      expect({ kind, named: rollback.includes(`kind = '${kind}'`) }).toEqual({ kind, named: true });
      for (const key of keys)
        expect({ key, named: rollback.includes(`view ? '${key}'`) }).toEqual({ key, named: true });
    }
    expect(rollback).toContain("due_source = 'default', usual_reply_days = NULL WHERE due_source = 'contact'");
    expect(rollback).toContain("status IN ('pending', 'sending')");
  });
});
