import { describe, expect, test } from "bun:test";

import { buildTriageAnalysisSchema, categories } from "@ea/core";

import { DEMO_SEED_FORMAT, DEMO_TABLES, type DemoSeed } from "../../../apps/server/src/modules/lab";
import { classifierVersions } from "../../../apps/server/src/modules/triage/prompts";

import { buildReplayTable, replayAnswer, replayKey } from "./replay";

const uuid = (n: number): string => `0b6e0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const MARTA = uuid(7);
const PARTS = ["attachments"] as const;

type Row = Record<string, unknown>;
interface MailSpec {
  from: string;
  subject: string;
  category: string;
  reasonCode?: string;
  reason?: string;
  fields?: Row;
  summary?: string;
  delegate?: string;
}

// A seed with the given mails; each has one newest `triage_results` row (older rows come from `extraResults`).
function seedOf(mails: MailSpec[], extraResults: Row[] = []): DemoSeed {
  const tables = Object.fromEntries(DEMO_TABLES.map((table) => [table, [] as Row[]])) as unknown as DemoSeed["tables"];
  tables.delegates = [{ id: MARTA, name: "Marta Nowak" }];
  mails.forEach((mail, index) => {
    const id = uuid(100 + index);
    tables.emails.push({ id, from_address: mail.from, subject: mail.subject });
    tables.triage_results.push({
      id: uuid(200 + index),
      email_id: id,
      category: mail.category,
      confidence: 0.9,
      reason_code: mail.reasonCode ?? "other",
      reason: mail.reason ?? "because",
      fields: mail.fields ?? {},
      created_at: "2026-11-23T10:00:00.000Z",
    });
    if (mail.summary !== undefined) {
      tables.actions.push({
        email_id: id,
        type: "save_summary",
        payload: { summary: mail.summary },
        created_at: "2026-11-23T10:00:00.000Z",
      });
    }
    if (mail.delegate !== undefined) {
      tables.delegations.push({ email_id: id, delegate_id: MARTA, created_at: "2026-11-23T10:00:00.000Z" });
    }
  });
  tables.triage_results.push(...extraResults);
  return { format: DEMO_SEED_FORMAT, scenario: "lab-01", runId: "r", day: 1, exportedAt: "x", tables };
}

// The request body of the production classifier prompt for a mail with one thread mail.
function requestOf(
  over: { from?: string; subject?: string; delegates?: { id: string; name: string; tags: string[] }[] } = {}
) {
  const date = new Date("2026-11-23T10:00:00Z");
  const input = classifierVersions["classifier-v4"].buildUser(
    {
      from: over.from ?? "ops@kordelan.test",
      to: ["boss@kordelan.test"],
      cc: [],
      subject: over.subject ?? "Server down",
      receivedAt: date,
      bodyText: "The email to classify: not this one",
      thread: [{ from: "anna@kordelan.test", subject: "Lunch", receivedAt: date, bodyExcerpt: "noon?" }],
    },
    { whitelisted: false, vip: false, noreply: false },
    over.delegates ?? [],
    "NONCE",
    { attachments: [], isList: false, senderHistory: null, senderProfile: null, urgency: null },
    PARTS
  );
  return { model: "m", input };
}

const serverDown = (over: Partial<MailSpec> = {}): MailSpec => ({
  from: "ops@kordelan.test",
  subject: "Server down",
  category: "urgent",
  ...over,
});

test("replayKey lower-cases the address, drops the display name and trims", () => {
  expect(replayKey(" Anna <Anna@Firma.test> ", " Invoice 7 ")).toBe("anna@firma.test\nInvoice 7");
});

test("the entry of the mail to classify answers, not the thread mail", () => {
  const table = buildReplayTable(
    seedOf([
      serverDown({ reason: "Server outage since 9:00" }),
      { from: "anna@kordelan.test", subject: "Lunch", category: "info" },
    ])
  );
  const result = replayAnswer(table, requestOf());
  expect(result.status).toBe(200);
  expect(result.status === 200 && result.body.category).toBe("urgent");
  // 5a: the reason is the stored text.
  expect(result.status === 200 && result.body.reason).toBe("Server outage since 9:00");
});

test("a request with no entry is a miss with the reason no_entry", () => {
  const table = buildReplayTable(seedOf([serverDown()]));
  expect(replayAnswer(table, requestOf({ subject: "Other" }))).toEqual({ status: 500, reason: "no_entry" });
});

test("a request with no mail block is no_mail_block", () => {
  const table = buildReplayTable(seedOf([serverDown()]));
  expect(replayAnswer(table, { input: "Hello" })).toEqual({ status: 500, reason: "no_mail_block" });
  expect(replayAnswer(table, undefined)).toEqual({ status: 500, reason: "no_mail_block" });
});

describe("a key that two mails share", () => {
  test("with different answers has no entry and counts as dropped", () => {
    const table = buildReplayTable(seedOf([serverDown({ category: "info" }), serverDown({ category: "urgent" })]));
    expect([table.entries.size, table.dropped]).toEqual([0, 1]);
  });

  test("with the same answer is one entry and is not dropped", () => {
    const table = buildReplayTable(seedOf([serverDown(), serverDown()]));
    expect([table.entries.size, table.dropped]).toEqual([1, 0]);
  });
});

describe("a delegation answer", () => {
  const mail = serverDown({
    category: "delegation",
    delegate: "Marta Nowak",
    fields: { task: "Send the Q3 report", delegate_id: MARTA },
  });
  test.each([
    ["no tags", { id: MARTA, name: "Marta Nowak", tags: [] as string[] }],
    ["tags", { id: MARTA, name: "Marta Nowak", tags: ["finance"] }],
  ])("carries the delegate id of the prompt line (%s) and the stored task", (_name, delegate) => {
    const result = replayAnswer(buildReplayTable(seedOf([mail])), requestOf({ delegates: [delegate] }));
    expect(result.status === 200 && result.body.fields).toEqual({
      due_date: null,
      language: "other",
      delegate_id: MARTA,
      task: "Send the Q3 report",
      clarification: null,
    });
  });

  test("takes the delegate of the delegations row when the fields have none", () => {
    const table = buildReplayTable(seedOf([{ ...mail, fields: { task: "Send the Q3 report" } }]));
    expect(table.entries.get(replayKey(mail.from, mail.subject))?.delegateName).toBe("Marta Nowak");
  });

  test("without a prompt line for the delegate is delegate_missing", () => {
    expect(replayAnswer(buildReplayTable(seedOf([mail])), requestOf())).toEqual({
      status: 500,
      reason: "delegate_missing",
    });
  });
});

test("a row with a rule reason code has no entry and counts as a rule row", () => {
  const table = buildReplayTable(seedOf([serverDown({ reasonCode: "blocklist" })]));
  expect([table.entries.size, table.ruleRows]).toEqual([0, 1]);
});

test("the newest row of a mail answers, and the summary comes from its save_summary action", () => {
  const older = {
    id: uuid(300),
    email_id: uuid(100),
    category: "spam",
    confidence: 0.5,
    reason_code: "marketing",
    reason: "old",
    fields: {},
    created_at: "2026-11-22T10:00:00.000Z",
  };
  const table = buildReplayTable(seedOf([serverDown({ category: "info", summary: "Short summary" })], [older]));
  const answer = table.entries.get(replayKey("ops@kordelan.test", "Server down"))?.answer;
  expect([answer?.category, answer?.summary]).toEqual(["info", "Short summary"]);
});

test("the model category of a row that the threshold made unsure is replayed", () => {
  const table = buildReplayTable(
    seedOf([serverDown({ category: "unsure", fields: { model_category: "needs_reply" } })])
  );
  expect(table.entries.get(replayKey("ops@kordelan.test", "Server down"))?.answer.category).toBe("needs_reply");
});

test.each(categories.filter((category) => category !== "unsure"))(
  "the %s answer parses with the production classifier schema",
  (category) => {
    const mail = serverDown({
      category,
      summary: "S",
      fields: { task: "T", due_date: "2026-11-30", language: "pl", delegate_id: MARTA },
    });
    const delegate = { id: MARTA, name: "Marta Nowak", tags: [] };
    const result = replayAnswer(buildReplayTable(seedOf([mail])), requestOf({ delegates: [delegate] }));
    expect(result.status).toBe(200);
    const schema = buildTriageAnalysisSchema(
      categories.filter((name) => name !== "unsure"),
      [MARTA]
    );
    expect(result.status === 200 && schema.safeParse(result.body).success).toBe(true);
  }
);
