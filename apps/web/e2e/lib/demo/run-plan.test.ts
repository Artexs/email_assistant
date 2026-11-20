import { describe, expect, test } from "bun:test";

import { barCategories } from "@ea/core";

import { DEMO_SEED_FORMAT, DEMO_TABLES, type DemoSeed } from "../../../../server/src/modules/lab";
import type { GateFile } from "../../../../server/src/modules/triage";

import { demoGateCopy, type DemoRunPlan, planDemoRun } from "./run-plan";

type Row = Record<string, unknown>;

const uuid = (n: number): string => `0b6e0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const MAILBOX = uuid(1);
const MARTA = uuid(2);
const PIOTR = uuid(3);
const ADDRESS_A = "ceo@kordelan.test";
const MODEL = "gpt-5.2";
const PROMPT = "classifier-v3";
const DAY_MS = 24 * 60 * 60 * 1000;
const BASE_TIME = Date.parse("2026-11-23T08:00:00.000Z");

interface MailSet {
  category: string;
  count: number;
  confidence?: number;
  /** For `delegation`: who gets the task; `none` leaves the delegate out. */
  delegate?: "active" | "inactive" | "none";
  task?: string | null;
}

interface SeedOptions {
  promptVersion?: string;
  /** The prompt version of the first mail of the first set, to build a seed with two. */
  firstPromptVersion?: string;
  from?: string;
  subject?: string | null;
  mode?: string;
  createDraft?: boolean;
}

// A seed whose mails are numbered by age: the later the number, the newer the mail.
function seedOf(sets: MailSet[], options: SeedOptions = {}, extra?: (tables: DemoSeed["tables"]) => void) {
  const tables = Object.fromEntries(DEMO_TABLES.map((table) => [table, [] as Row[]])) as unknown as DemoSeed["tables"];
  tables.mailboxes = [{ id: MAILBOX, address: ADDRESS_A }];
  tables.mailbox_settings = [
    {
      mailbox_id: MAILBOX,
      mode: options.mode ?? "assist",
      tool_switches: { create_draft: options.createDraft ?? true },
    },
  ];
  tables.delegates = [
    { id: MARTA, name: "Marta Nowak", email: "marta@kordelan.test", active: true },
    { id: PIOTR, name: "Piotr Zielinski", email: "piotr@kordelan.test", active: false },
  ];
  let index = 0;
  for (const set of sets) {
    for (let n = 0; n < set.count; n += 1) {
      index += 1;
      const id = uuid(1000 + index);
      tables.emails.push({
        id,
        mailbox_id: MAILBOX,
        from_address: `sender${index}@firma.test`,
        subject: `Mail ${index}`,
        body_text: `Body ${index}`,
        received_at: new Date(BASE_TIME + index * DAY_MS).toISOString(),
      });
      tables.triage_results.push({
        id: uuid(2000 + index),
        email_id: id,
        category: set.category,
        confidence: set.confidence ?? 0.97,
        reason_code: "other",
        reason: "because",
        fields: {
          task: set.task === undefined ? (set.category === "delegation" ? "Send the report" : null) : set.task,
        },
        model: MODEL,
        prompt_version:
          index === 1 && options.firstPromptVersion ? options.firstPromptVersion : (options.promptVersion ?? PROMPT),
        created_at: new Date(BASE_TIME + index * DAY_MS).toISOString(),
      });
      const delegate = set.delegate ?? "active";
      if (set.category === "delegation" && delegate !== "none") {
        tables.delegations.push({
          id: uuid(3000 + index),
          email_id: id,
          delegate_id: delegate === "active" ? MARTA : PIOTR,
          status: "sent",
          reminders_sent: 0,
          created_at: new Date(BASE_TIME + index * DAY_MS).toISOString(),
        });
      }
    }
  }
  extra?.(tables);
  return { format: DEMO_SEED_FORMAT, scenario: "lab-01", runId: "r", day: 5, exportedAt: "x", tables } as DemoSeed;
}

type GateRows = Partial<Record<(typeof barCategories)[number], { decision: "go" | "no-go"; threshold: number | null }>>;

function gateOf(rows: GateRows, over: Partial<GateFile> = {}): GateFile {
  const row = (category: (typeof barCategories)[number]) => ({
    support: 300,
    threshold: rows[category]?.threshold ?? null,
    kept: 250,
    tp: 240,
    precision: 0.96,
    wilsonLower: 0.93,
    recall: 0.8,
    decision: rows[category]?.decision ?? "no-go",
    metrics: { tp: 240, fp: 10, fn: 30, support: 300 },
  });
  return {
    scenario: "lab-01",
    version: "1",
    manifestSha: null,
    audit: "pending",
    provisional: true,
    part: "holdout",
    date: "2026-11-10",
    role: "classifier",
    provider: "openai",
    endpoint: "standard",
    host: "api.openai.com",
    model: MODEL,
    reasoningEffort: "low",
    promptVersion: PROMPT,
    promptParts: ["attachments"],
    bar: 0.95,
    minKept: 50,
    categories: Object.fromEntries(barCategories.map((category) => [category, row(category)])),
    urgentRecallBySource: {
      text: { n: 1, recall: 1 },
      vip: { n: 1, recall: 1 },
      context: { n: 1, recall: 1 },
    },
    injection: { passed: 3, total: 3 },
    ...over,
  } as GateFile;
}

const V3_GATE = gateOf({ notification: { decision: "go", threshold: 0.5 }, spam: { decision: "go", threshold: 0.9 } });
const V2_GATE = gateOf({ info: { decision: "go", threshold: 0.95 } }, { promptVersion: "classifier-v2" });

const FOUR_EACH = (count: number): MailSet[] => [
  { category: "urgent", count: 3 },
  { category: "delegation", count: 2 },
  ...["info", "notification", "spam", "needs_reply"].map((category) => ({ category, count })),
];

function planOf(seed: DemoSeed, gates: GateFile[] = [V3_GATE], prompt = PROMPT): DemoRunPlan {
  const result = planDemoRun(seed, gates, prompt);
  if (!result.ok) throw new Error(`plan refused: ${result.code}`);
  return result.plan;
}

const keysOf = (plan: DemoRunPlan): string[] => [
  ...plan.history.map((mail) => mail.key),
  ...plan.shadow.map((mail) => mail.key),
  plan.urgent.key,
  plan.delegation.key,
  plan.undo.key,
];

describe("planDemoRun", () => {
  test("picks every set from a seed with all categories", () => {
    const plan = planOf(seedOf(FOUR_EACH(8)));
    expect(plan.model).toBe(MODEL);
    expect(plan.promptVersion).toBe(PROMPT);
    expect(plan.mailboxB).toBe("office@kordelan.test");
    expect(plan.undo.category).toBe("notification");
    expect(plan.shadow.map((mail) => mail.category).sort()).toEqual(["info", "needs_reply", "notification", "spam"]);
    expect(plan.history).toHaveLength(27);
    expect(plan.recommended).toEqual([
      { category: "notification", threshold: 0.5 },
      { category: "spam", threshold: 0.9 },
    ]);
    expect(plan.delegation.delegateName).toBe("Marta Nowak");
    expect(plan.delegation.delegateAddress).toBe("marta@kordelan.test");
  });

  test("takes the newest mail for urgent, delegation and undo, and lists history newest first", () => {
    const plan = planOf(seedOf(FOUR_EACH(8)));
    expect(plan.urgent.subject).toBe("Mail 3");
    expect(plan.delegation.subject).toBe("Mail 5");
    expect(plan.undo.subject).toBe("Mail 21");
    const times = plan.history.map((mail) => mail.at.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  test("refuses a seed whose history has 11 mails", () => {
    expect(planDemoRun(seedOf(FOUR_EACH(4)), [V3_GATE], PROMPT)).toEqual({
      ok: false,
      code: "demo_seed_short history",
    });
  });

  test("keeps at most 60 mails in history", () => {
    expect(planOf(seedOf(FOUR_EACH(30))).history).toHaveLength(60);
  });

  test("undo needs the confidence of the gate threshold of its category", () => {
    const rest: MailSet[] = [
      { category: "urgent", count: 1 },
      { category: "delegation", count: 1 },
      { category: "notification", count: 6 },
      { category: "spam", count: 6 },
      { category: "needs_reply", count: 6 },
    ];
    const options = { promptVersion: "classifier-v2" };
    const info = (confidence: number, count: number): MailSet => ({ category: "info", count, confidence });
    const plan = planOf(
      seedOf([...rest, info(0.9, 12), info(0.96, 1), info(0.9, 12)], options),
      [V2_GATE],
      "classifier-v2"
    );
    expect(plan.undo.subject).toBe("Mail 33");
    const low = planDemoRun(seedOf([...rest, info(0.9, 25)], options), [V2_GATE], "classifier-v2");
    expect(low).toEqual({ ok: false, code: "demo_seed_short undo" });
  });

  test("refuses a seed with two prompt versions", () => {
    const seed = seedOf(FOUR_EACH(8), { firstPromptVersion: "classifier-v2" });
    expect(planDemoRun(seed, [V3_GATE], PROMPT)).toEqual({ ok: false, code: "demo_seed_mixed_models" });
  });

  test("refuses rows of another prompt version than the production prompt", () => {
    const seed = seedOf(FOUR_EACH(8), { promptVersion: "classifier-v2" });
    expect(planDemoRun(seed, [V3_GATE], PROMPT)).toEqual({ ok: false, code: "demo_prompt_mismatch" });
  });

  test("refuses a seed with no gate file for the model and prompt", () => {
    const other = [gateOf({}, { model: "other-model" }), V2_GATE];
    expect(planDemoRun(seedOf(FOUR_EACH(8)), other, PROMPT)).toEqual({ ok: false, code: "demo_gate_missing" });
  });

  test("refuses a gate that recommends no moving category", () => {
    const gate = gateOf({ urgent: { decision: "go", threshold: 0.9 }, info: { decision: "no-go", threshold: null } });
    expect(planDemoRun(seedOf(FOUR_EACH(8)), [gate], PROMPT)).toEqual({ ok: false, code: "demo_nothing_recommended" });
  });

  test("uses the non-provisional file, then the newest one", () => {
    const old = gateOf({ spam: { decision: "go", threshold: 0.9 } }, { provisional: false, date: "2026-11-01" });
    const fresh = gateOf(
      { notification: { decision: "go", threshold: 0.6 } },
      { provisional: false, date: "2026-11-09" }
    );
    const provisionalNewest = gateOf({ info: { decision: "go", threshold: 0.9 } }, { date: "2026-11-15" });
    const plan = planOf(seedOf(FOUR_EACH(8)), [old, provisionalNewest, fresh]);
    expect(plan.recommended).toEqual([{ category: "notification", threshold: 0.6 }]);
  });

  test("refuses a seed with no urgent pick", () => {
    const sets = FOUR_EACH(8).filter((set) => set.category !== "urgent");
    expect(planDemoRun(seedOf(sets), [V3_GATE], PROMPT)).toEqual({ ok: false, code: "demo_seed_short urgent" });
  });

  test("a pick below 0.7 does not count", () => {
    const sets = FOUR_EACH(8).map((set) => (set.category === "urgent" ? { ...set, confidence: 0.6 } : set));
    expect(planDemoRun(seedOf(sets), [V3_GATE], PROMPT)).toEqual({ ok: false, code: "demo_seed_short urgent" });
  });

  test.each([
    ["an inactive delegate", { delegate: "inactive" as const }],
    ["no delegate", { delegate: "none" as const }],
    ["no task", { task: null }],
  ])("refuses a seed whose only delegation mail has %s", (_name, over) => {
    const sets = FOUR_EACH(8).map((set) => (set.category === "delegation" ? { ...set, count: 1, ...over } : set));
    expect(planDemoRun(seedOf(sets), [V3_GATE], PROMPT)).toEqual({ ok: false, code: "demo_seed_short delegation" });
  });

  test("refuses a seed with fewer than 4 shadow categories", () => {
    const sets = FOUR_EACH(8).filter((set) => set.category !== "needs_reply");
    expect(planDemoRun(seedOf(sets), [V3_GATE], PROMPT)).toEqual({ ok: false, code: "demo_seed_short shadow" });
  });

  test.each([
    ["a plain seed", seedOf(FOUR_EACH(8))],
    ["a seed with 100 mails", seedOf(FOUR_EACH(24))],
    [
      "a seed with a repeated mail",
      seedOf(FOUR_EACH(8), {}, (tables) => {
        const first = tables.emails[10];
        if (first === undefined) throw new Error("no fixture mail");
        tables.emails.push({ ...first, id: uuid(9999) });
      }),
    ],
  ])("uses no mail twice in %s", (_name, seed) => {
    const keys = keysOf(planOf(seed));
    expect(new Set(keys).size).toBe(keys.length);
  });

  test.each([
    ["mailbox A", { from_address: ADDRESS_A }],
    ["mailbox B", { from_address: "office@kordelan.test" }],
    ["no sender", { from_address: null }],
    ["no subject", { subject: null }],
  ])("never picks a mail from %s or with a missing field", (_name, over) => {
    const seed = seedOf(FOUR_EACH(8), {}, (tables) => {
      const id = uuid(8888);
      tables.emails.push({
        id,
        mailbox_id: MAILBOX,
        from_address: "newest@firma.test",
        subject: "Newest",
        received_at: new Date(BASE_TIME + 900 * DAY_MS).toISOString(),
        ...over,
      });
      tables.triage_results.push({
        id: uuid(8889),
        email_id: id,
        category: "urgent",
        confidence: 0.99,
        reason_code: "other",
        reason: "because",
        fields: {},
        model: MODEL,
        prompt_version: PROMPT,
        created_at: new Date(BASE_TIME + 900 * DAY_MS).toISOString(),
      });
    });
    const plan = planOf(seed);
    expect(plan.urgent.subject).toBe("Mail 3");
    expect(keysOf(plan).some((key) => key.endsWith("\nNewest"))).toBe(false);
  });
});

describe("overdue delegation", () => {
  const overdue = (reminders: number, id: number, createdAt: number) => (tables: DemoSeed["tables"]) => {
    const email = tables.emails[id];
    if (email === undefined) throw new Error("no fixture mail");
    tables.delegations.push({
      id: uuid(7000 + id),
      email_id: email.id,
      delegate_id: MARTA,
      status: "overdue",
      reminders_sent: reminders,
      created_at: new Date(BASE_TIME + createdAt * DAY_MS).toISOString(),
    });
  };
  const withOverdue = (options: SeedOptions = {}) =>
    seedOf(FOUR_EACH(8), options, (tables) => {
      overdue(2, 6, 50)(tables);
      overdue(1, 7, 40)(tables);
    });

  test("takes the newest delegation with fewer than 2 reminders", () => {
    expect(planOf(withOverdue()).overdueDelegation).toEqual({ delegateName: "Marta Nowak", subject: "Mail 8" });
  });

  test.each([
    ["drafts off", { createDraft: false }],
    ["shadow mode", { mode: "shadow" }],
  ])("is null with %s", (_name, options) => {
    expect(planOf(withOverdue(options)).overdueDelegation).toBeNull();
  });

  test("is null when no delegation is overdue", () => {
    expect(planOf(seedOf(FOUR_EACH(8))).overdueDelegation).toBeNull();
  });
});

describe("demoGateCopy", () => {
  test("changes the key to the replay server and keeps decisions and thresholds", () => {
    const copy = demoGateCopy(V3_GATE, { model: "demo-replay", host: "127.0.0.1" });
    expect(copy.sourceProvisional).toBe(true);
    expect(copy.fileName).toBe("classifier-classifier-v3-demo-replay-default-lab-01-v1-own.json");
    expect(copy.file).toEqual({
      ...V3_GATE,
      provider: "openai",
      model: "demo-replay",
      endpoint: "own",
      host: "127.0.0.1",
      reasoningEffort: null,
      provisional: false,
      audit: "done",
    });
    expect(copy.file.categories).toEqual(V3_GATE.categories);
  });

  test("reports a source that was not provisional", () => {
    const source = gateOf({}, { provisional: false, audit: "done" });
    expect(demoGateCopy(source, { model: "demo-replay", host: "127.0.0.1" }).sourceProvisional).toBe(false);
  });
});
