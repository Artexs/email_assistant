import { describe, expect, test } from "bun:test";

import { hardCaseRules, hardCaseTagIds, type SlotDraft } from "./hard-cases";
import { miniScenario } from "./fixtures";
import { createRng } from "./random";
import { valueCategories } from "./slot";

const base: SlotDraft = {
  persona: "client-a",
  direction: "in",
  to: ["szef"],
  cc: [],
  lang: "en",
  category: "needs_reply",
  hardCases: [],
  kind: "synthetic",
  style: { length: "short", format: "plain", signature: true, greeting: "formal" },
  headers: {},
  attachments: [],
  thread: [],
  brief: "base",
};

function ruleOf(id: string) {
  const found = hardCaseRules.find((r) => r.id === id);
  if (!found) throw new Error(`no rule ${id}`);
  return found;
}

describe("hard-case registry", () => {
  test("27 unique tags with unique short ids", () => {
    expect(hardCaseTagIds).toHaveLength(27);
    expect(new Set(hardCaseTagIds).size).toBe(27);
    const shorts = hardCaseRules.map((r) => r.short);
    expect(new Set(shorts).size).toBe(27);
    for (const short of shorts) expect(short).toMatch(/^[a-z]{2,4}$/);
  });

  test("categories are non-empty and valid", () => {
    for (const r of hardCaseRules) {
      expect(r.categories.length).toBeGreaterThan(0);
      for (const category of r.categories) expect(valueCategories).toContain(category);
    }
  });

  test("the 8 reply-injection rules are injections on needs_reply", () => {
    const set = hardCaseRules.filter((r) => r.id.startsWith("reply_inj_"));
    expect(set).toHaveLength(8);
    for (const r of set) {
      expect(r.kind).toBe("injection");
      expect(r.categories).toEqual(["needs_reply"]);
      expect(r.replyInjection).toBe(true);
    }
    expect(hardCaseRules.filter((r) => r.replyInjection)).toHaveLength(8);
  });

  test("calendar_invite adds one text/calendar attachment", () => {
    const out = ruleOf("calendar_invite").apply(base, { scenario: miniScenario, rng: createRng(1) });
    expect(out.attachments).toHaveLength(1);
    expect(out.attachments[0]?.mime).toBe("text/calendar");
    expect(out.attachments[0]?.name).toBe("invite.ics");
  });

  test("every rule applies to a draft of each of its categories with a valid brief and no input change", () => {
    for (const r of hardCaseRules) {
      for (const category of r.categories) {
        const draft: SlotDraft = { ...base, category };
        const before = JSON.stringify(draft);
        const out = r.apply(draft, { scenario: miniScenario, rng: createRng(7) });
        expect(JSON.stringify(draft)).toBe(before);
        expect(out.brief.length).toBeGreaterThan(0);
        expect(out.brief.length).toBeLessThanOrEqual(200);
        if (r.kind === "injection") expect(out.kind).toBe("injection");
      }
    }
  });

  test("facts of the table", () => {
    const ctx = () => ({ scenario: miniScenario, rng: createRng(3) });
    const run = (id: string, draft: Partial<SlotDraft> = {}) => ruleOf(id).apply({ ...base, ...draft }, ctx());
    expect(run("urgent_no_keyword", { category: "urgent" }).urgencySource).toBe("text");
    const missing = run("delegation_missing_data", { category: "delegation", expectedDelegate: "anna" });
    expect(missing.expectedDraft).toBe("clarification");
    expect(missing.expectedDelegate).toBeUndefined();
    expect(run("polish_diacritics").lang).toBe("pl");
    expect(run("german").lang).toBe("de");
    expect(run("html_only").style.format).toBe("html");
    expect(run("auto_reply").headers["Auto-Submitted"]).toBe("auto-replied");
    const bounce = run("bounce");
    expect(bounce.fromOverride).toBe("mailer-daemon@mini.test");
    expect(miniScenario.personas.find((p) => p.key === bounce.persona)?.group).toBe("system");
    const cc = run("cc_only", { category: "info" });
    expect(cc.cc).toEqual(["szef"]);
    expect(miniScenario.personas.find((p) => p.key === cc.to[0])?.group).toBe("team");
    const list = run("list_mail", { category: "info" });
    expect(list.headers["List-Id"]).toMatch(/^<.+\.lists\.client-a\.test>$/);
    expect(list.headers["List-Unsubscribe"]).toMatch(/^<https:\/\/lists\.client-a\.test\/u\/\d+>$/);
    expect(run("phishing_unsubscribe", { category: "spam" }).headers["List-Unsubscribe"]).toBeDefined();
    const answered = run("already_answered", { category: "info" });
    expect(answered.thread.at(-1)?.persona).toBe("szef");
    const rnt = run("reply_needed_thread");
    expect(rnt.thread.length).toBeGreaterThanOrEqual(2);
    expect(rnt.thread.length).toBeLessThanOrEqual(3);
    expect(rnt.thread.at(-1)?.persona).toBe("szef");
    expect(run("forwarded_in_thread").thread).toHaveLength(2);
    const att = run("attachments");
    expect(att.attachments.length).toBeGreaterThanOrEqual(1);
    expect(att.attachments.length).toBeLessThanOrEqual(3);
    for (const a of att.attachments) {
      expect(a.sizeBytes).toBeGreaterThanOrEqual(20_000);
      expect(a.sizeBytes).toBeLessThanOrEqual(2_000_000);
    }
  });
});
