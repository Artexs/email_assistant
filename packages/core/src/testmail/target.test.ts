import { describe, expect, test } from "bun:test";

import type { Category } from "../triage/categories";

import type { Batch } from "./batch";
import type { SendLogLine } from "./send-log";
import { buildCompareRows, buildTargetInput, renderCompareTable, targetInputSchema, type TargetInput } from "./target";

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

describe("buildCompareRows, categories outside the test set", () => {
  test("delegation and unsure are never ok", () => {
    const input: TargetInput = {
      batch: batchId,
      sender: "i@x.test",
      cases: [entry("d", "<d@x>"), entry("u", "<u@x>")],
    };
    const rows = buildCompareRows(
      input,
      [email("e1", "<d@x>"), email("e2", "<u@x>")],
      [result("e1", "delegation"), result("e2", "unsure")]
    );
    expect(rows.map((r) => [r.caseId, r.state, r.category, r.ok])).toEqual([
      ["d", "triaged", "delegation", false],
      ["u", "triaged", "unsure", false],
    ]);
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
