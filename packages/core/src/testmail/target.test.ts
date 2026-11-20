import { describe, expect, test } from "bun:test";

import type { Category } from "../triage/categories";

import type { Batch } from "./batch";
import type { SendLogLine } from "./send-log";
import {
  buildCompareRows,
  buildTargetInput,
  renderCompareTable,
  targetInputSchema,
  type CompareRow,
  type TargetInput,
} from "./target";

const batchId = "2026-11-08-a";
const mk = (id: string, extra: { replyTo?: string; note?: string } = {}) => ({
  id,
  persona: "boss",
  lang: "pl" as const,
  subject: "SECRET-SUBJECT",
  body: "SECRET-BODY",
  expected: { category: "info" as const },
  ...extra,
});

describe("buildTargetInput", () => {
  test("markers from the note, nulls for unsent cases", () => {
    const batch: Batch = {
      batch: batchId,
      writer: "w",
      delegatesActive: false,
      cases: [mk("a", { note: "attack: injection" }), mk("b", { note: "borderline: maybe", replyTo: "a" }), mk("c")],
    };
    const lines: SendLogLine[] = [
      {
        type: "sent",
        batch: batchId,
        case: "a",
        attempt: 1,
        key: "k",
        messageId: "<a@x>",
        threadId: "t",
        inbox: "i@x",
        via: "send",
        at: "2026-11-08T10:00:00.000Z",
      },
    ];
    const input = buildTargetInput(batch, lines, "i@x.test");
    expect(input.cases).toEqual([
      {
        caseId: "a",
        persona: "boss",
        expected: "info",
        marker: "attack",
        parentCaseId: null,
        messageId: "<a@x>",
        sentAt: "2026-11-08T10:00:00.000Z",
      },
      {
        caseId: "b",
        persona: "boss",
        expected: "info",
        marker: "borderline",
        parentCaseId: "a",
        messageId: null,
        sentAt: null,
      },
      {
        caseId: "c",
        persona: "boss",
        expected: "info",
        marker: "none",
        parentCaseId: null,
        messageId: null,
        sentAt: null,
      },
    ]);
    expect(targetInputSchema.parse(input)).toEqual(input);
  });
});

const entry = (
  caseId: string,
  messageId: string | null,
  extra: Partial<TargetInput["cases"][number]> = {}
): TargetInput["cases"][number] => ({
  caseId,
  persona: "boss",
  expected: "info",
  marker: "none",
  parentCaseId: null,
  messageId,
  sentAt: null,
  ...extra,
});
const email = (id: string, header: string, inReplyTo: string | null = null) => ({
  id,
  message_id_header: header,
  status: "done",
  in_reply_to: inReplyTo,
});
const result = (emailId: string, category: Category, version: string | null = "v2") => ({
  email_id: emailId,
  category,
  confidence: 0.9,
  reason_code: "llm",
  model: "m",
  prompt_version: version,
});

describe("buildCompareRows", () => {
  test("one case per state, ok and wrong, thread, second copy", () => {
    const input: TargetInput = {
      batch: batchId,
      sender: "i@x.test",
      cases: [
        entry("unsent", null),
        entry("lost", "<lost@x>"),
        entry("wait", "<wait@x>"),
        entry("right", "<right@x>"),
        entry("wrong", "<wrong@x>"),
        entry("child-ok", "<c1@x>", { parentCaseId: "right" }),
        entry("child-bad", "<c2@x>", { parentCaseId: "right" }),
        entry("copy", "<copy@x>"),
      ],
    };
    const emails = [
      email("e1", "<wait@x>"),
      email("e2", "<right@x>"),
      email("e3", "<wrong@x>"),
      email("e4", "<c1@x>", "<right@x>"),
      email("e5", "<c2@x>"),
      email("e6", "<copy@x>"),
      email("e7", "<copy@x>"),
    ];
    const results = [
      result("e2", "info"),
      result("e3", "spam"),
      result("e4", "info"),
      result("e5", "info"),
      result("e7", "info"),
    ];
    const rows = buildCompareRows(input, emails, results);
    expect(rows.map((r) => [r.caseId, r.state, r.ok, r.thread])).toEqual([
      ["unsent", "not_sent", null, null],
      ["lost", "not_synced", null, null],
      ["wait", "not_triaged", null, null],
      ["right", "triaged", true, null],
      ["wrong", "triaged", false, null],
      ["child-ok", "triaged", true, "ok"],
      ["child-bad", "triaged", true, "MISSING"],
      ["copy", "triaged", true, null],
    ]);
    expect(rows[7]?.emailId).toBe("e7");
    expect(rows[3]?.promptVersion).toBe("v2");
  });
});

describe("buildCompareRows, exact rows", () => {
  const blank = {
    emailId: null,
    category: null,
    confidence: null,
    reasonCode: null,
    model: null,
    promptVersion: null,
    ok: null,
    thread: null,
  };
  const input = (cases: TargetInput["cases"]): TargetInput => ({ batch: batchId, sender: "i@x.test", cases });

  test("one row per case in batch order, with every cell of each state", () => {
    const rows = buildCompareRows(
      input([
        entry("z-unsent", null, { persona: "shop", expected: "spam", marker: "attack" }),
        entry("lost", "<lost@x>", { parentCaseId: "z-unsent" }),
        entry("wait", "<wait@x>", { parentCaseId: "z-unsent" }),
        entry("hit", "<hit@x>", { expected: "urgent", marker: "borderline" }),
      ]),
      [email("e1", "<wait@x>", "<z@x>"), email("e2", "<hit@x>")],
      [{ email_id: "e2", category: "spam", confidence: 0.25, reason_code: "rule", model: null, prompt_version: "v7" }]
    );
    expect(rows).toEqual([
      { ...blank, caseId: "z-unsent", persona: "shop", expected: "spam", marker: "attack", state: "not_sent" },
      { ...blank, caseId: "lost", persona: "boss", expected: "info", marker: "none", state: "not_synced" },
      {
        ...blank,
        caseId: "wait",
        persona: "boss",
        expected: "info",
        marker: "none",
        state: "not_triaged",
        emailId: "e1",
        thread: "ok",
      },
      {
        caseId: "hit",
        persona: "boss",
        expected: "urgent",
        marker: "borderline",
        state: "triaged",
        emailId: "e2",
        category: "spam",
        confidence: 0.25,
        reasonCode: "rule",
        model: null,
        promptVersion: "v7",
        ok: false,
        thread: null,
      },
    ]);
  });

  test("the first result of an email wins", () => {
    const rows = buildCompareRows(
      input([entry("a", "<a@x>")]),
      [email("e1", "<a@x>")],
      [result("e1", "spam", "first"), result("e1", "info", "second")]
    );
    expect(rows[0]).toMatchObject({ category: "spam", promptVersion: "first", ok: false });
  });

  test("with no result on any copy, the copy with the lowest id is used, whatever the input order", () => {
    const rows = buildCompareRows(
      input([entry("a", "<a@x>")]),
      [email("e9", "<a@x>"), email("e1", "<a@x>"), email("e5", "<a@x>")],
      []
    );
    expect(rows[0]).toMatchObject({ state: "not_triaged", emailId: "e1" });
  });

  test("with results on several copies, the copy with the lowest id that has one is used", () => {
    const rows = buildCompareRows(
      input([entry("a", "<a@x>")]),
      [email("e9", "<a@x>"), email("e1", "<a@x>"), email("e5", "<a@x>"), email("e7", "<a@x>")],
      [result("e9", "spam"), result("e7", "info"), result("e5", "info")]
    );
    expect(rows[0]).toMatchObject({ state: "triaged", emailId: "e5", category: "info" });
  });

  test("the thread cell is empty for a case with no parent and for a parent whose mail is not stored", () => {
    const rows = buildCompareRows(
      input([
        entry("root", "<root@x>"),
        entry("kid-lost", "<kid@x>", { parentCaseId: "root" }),
        entry("kid-unsent", null, { parentCaseId: "root" }),
      ]),
      [email("e1", "<root@x>", "<before@x>")],
      []
    );
    expect(rows.map((row) => row.thread)).toEqual([null, null, null]);
  });
});

describe("buildCompareRows, delegation", () => {
  const delegationBatch: Batch = {
    batch: batchId,
    writer: "w",
    delegatesActive: true,
    cases: [{ ...mk("d"), expected: { category: "delegation" as const } }],
  };
  test("a delegation case builds a valid target input", () => {
    const input = buildTargetInput(delegationBatch, [], "i@x.test");
    expect(input.cases[0]?.expected).toBe("delegation");
    expect(targetInputSchema.safeParse(input).success).toBe(true);
  });

  test("a right delegation result is ok, another category is not", () => {
    const input: TargetInput = {
      batch: batchId,
      sender: "i@x.test",
      cases: [entry("d", "<d@x>", { expected: "delegation" })],
    };
    const emails = [email("e1", "<d@x>")];
    expect(buildCompareRows(input, emails, [result("e1", "delegation")])[0]?.ok).toBe(true);
    expect(buildCompareRows(input, emails, [result("e1", "needs_reply")])[0]?.ok).toBe(false);
  });

  test("the table prints ok for a right delegation result", () => {
    const input: TargetInput = {
      batch: batchId,
      sender: "i@x.test",
      cases: [entry("d", "<d@x>", { expected: "delegation" })],
    };
    const rows = buildCompareRows(input, [email("e1", "<d@x>")], [result("e1", "delegation")]);
    expect(renderCompareTable(rows).split("\n")[2]).toBe("| d | boss | delegation | delegation | 0.90 | llm | ok |  |");
  });
});

describe("buildCompareRows, categories outside the test set", () => {
  test("unsure is never ok", () => {
    const input: TargetInput = {
      batch: batchId,
      sender: "i@x.test",
      cases: [entry("u", "<u@x>")],
    };
    const rows = buildCompareRows(input, [email("e2", "<u@x>")], [result("e2", "unsure")]);
    expect(rows.map((r) => [r.caseId, r.state, r.category, r.ok])).toEqual([["u", "triaged", "unsure", false]]);
  });
});

describe("renderCompareTable", () => {
  test("snapshot", () => {
    const input: TargetInput = {
      batch: batchId,
      sender: "i@x.test",
      cases: [
        entry("a", "<a@x>"),
        entry("b", "<b@x>", { marker: "borderline", parentCaseId: "a" }),
        entry("c", "<c@x>"),
        entry("d", null),
      ],
    };
    const rows = buildCompareRows(
      input,
      [email("e1", "<a@x>"), email("e2", "<b@x>", "<a@x>")],
      [result("e1", "info", "v2"), result("e2", "spam", null)]
    );
    expect(renderCompareTable(rows)).toBe(
      [
        "| case | persona | expected | triage | confidence | reason | result | thread |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| a | boss | info | info | 0.90 | llm | ok |  |",
        "| b (borderline) | boss | info | spam | 0.90 | llm | WRONG | ok |",
        "| c | boss | info |  |  |  | not synced |  |",
        "| d | boss | info |  |  |  | not sent |  |",
        "",
        "triaged 2 of 3 sent; ok 1; wrong 1",
        "prompt versions: none (1), v2 (1)",
      ].join("\n")
    );
  });
});

describe("renderCompareTable, exact text", () => {
  const header = [
    "| case | persona | expected | triage | confidence | reason | result | thread |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  const row = (extra: Partial<CompareRow> = {}): CompareRow => ({
    caseId: "a",
    persona: "boss",
    expected: "info",
    marker: "none",
    state: "triaged",
    emailId: "e1",
    category: "info",
    confidence: 0.9,
    reasonCode: "llm",
    model: "m",
    promptVersion: "v2",
    ok: true,
    thread: null,
    ...extra,
  });

  test("an empty table is the header and a zero summary", () => {
    expect(renderCompareTable([])).toBe(
      [...header, "", "triaged 0 of 0 sent; ok 0; wrong 0", "prompt versions: none"].join("\n")
    );
  });

  test("two rows with a marker, a thread cell and a rounded confidence", () => {
    const table = renderCompareTable([
      row({ caseId: "a", marker: "attack", confidence: 0.5, thread: "MISSING" }),
      row({ caseId: "b", category: "spam", confidence: 0.126, ok: false, reasonCode: "rule", thread: "ok" }),
    ]);
    expect(table).toBe(
      [
        ...header,
        "| a (attack) | boss | info | info | 0.50 | llm | ok | MISSING |",
        "| b | boss | info | spam | 0.13 | rule | WRONG | ok |",
        "",
        "triaged 2 of 2 sent; ok 1; wrong 1",
        "prompt versions: v2 (2)",
      ].join("\n")
    );
  });

  test("a pipe in a cell is escaped and the cell keeps its other text", () => {
    const table = renderCompareTable([row({ caseId: "a|b", persona: "x|y|z", reasonCode: "r|s" })]);
    expect(table.split("\n")[2]).toBe("| a\\|b | x\\|y\\|z | info | info | 0.90 | r\\|s | ok |  |");
  });

  test("a row that is not sent, not synced or not triaged shows its state label", () => {
    const empty = { emailId: null, category: null, confidence: null, reasonCode: null, promptVersion: null, ok: null };
    const table = renderCompareTable([
      row({ ...empty, caseId: "a", state: "not_sent" }),
      row({ ...empty, caseId: "b", state: "not_synced" }),
      row({ ...empty, caseId: "c", state: "not_triaged", emailId: "e3", thread: "ok" }),
    ]);
    expect(table).toBe(
      [
        ...header,
        "| a | boss | info |  |  |  | not sent |  |",
        "| b | boss | info |  |  |  | not synced |  |",
        "| c | boss | info |  |  |  | not triaged | ok |",
        "",
        "triaged 0 of 2 sent; ok 0; wrong 0",
        "prompt versions: none",
      ].join("\n")
    );
  });

  test("prompt versions sort by count, then by name, and a missing version reads none", () => {
    const versions = ["v2", "v1", "v3", "v3", null, "v1", "v3", "v0"];
    const table = renderCompareTable(
      versions.map((promptVersion, index) => row({ caseId: `c${index}`, promptVersion }))
    );
    expect(table.split("\n").slice(-2)).toEqual([
      "triaged 8 of 8 sent; ok 8; wrong 0",
      "prompt versions: v3 (3), v1 (2), none (1), v0 (1), v2 (1)",
    ]);
  });

  test("prompt versions with equal counts are listed by name, whatever the row order", () => {
    const table = renderCompareTable(
      ["b", "c", "a"].map((promptVersion, index) => row({ caseId: `c${index}`, promptVersion }))
    );
    expect(table.split("\n").at(-1)).toBe("prompt versions: a (1), b (1), c (1)");
  });
});

describe("targetInputSchema", () => {
  const valid = { batch: batchId, sender: "i@x.test", cases: [entry("a", null)] };
  test("refuses an unknown field", () => {
    expect(targetInputSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
    expect(targetInputSchema.safeParse({ ...valid, cases: [{ ...entry("a", null), subject: "s" }] }).success).toBe(
      false
    );
  });
  test("refuses a caseId with a slash", () => {
    expect(targetInputSchema.safeParse({ ...valid, cases: [entry("a/b", null)] }).success).toBe(false);
    expect(targetInputSchema.safeParse(valid).success).toBe(true);
  });
  test("refuses messageId without sentAt and the reverse", () => {
    const sentAt = "2026-11-08T10:00:00.000Z";
    const parse = (extra: Partial<TargetInput["cases"][number]>) =>
      targetInputSchema.safeParse({ ...valid, cases: [entry("a", null, extra)] }).success;
    expect(parse({ messageId: "<a@x>", sentAt: null })).toBe(false);
    expect(parse({ messageId: null, sentAt })).toBe(false);
    expect(parse({ messageId: "<a@x>", sentAt })).toBe(true);
  });
});
