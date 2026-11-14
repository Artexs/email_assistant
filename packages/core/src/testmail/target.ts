import { z } from "zod";

import type { Category } from "../triage/categories";

import { BATCH_ID_PATTERN, batchCategories, type Batch, type BatchCategory } from "./batch";
import { caseStates, type SendLogLine } from "./send-log";

const caseIdPattern = /^[a-z0-9-]{1,40}$/;

export const targetInputSchema = z
  .object({
    batch: z.string().regex(BATCH_ID_PATTERN),
    sender: z.string().regex(/^[^\s@]+@[^\s@]+$/),
    cases: z
      .array(
        z
          .object({
            caseId: z.string().regex(caseIdPattern),
            persona: z.string().regex(caseIdPattern),
            expected: z.enum(batchCategories),
            marker: z.enum(["none", "borderline", "attack"]),
            parentCaseId: z.string().regex(caseIdPattern).nullable(), // replyTo
            messageId: z.string().min(3).max(300).nullable(), // null = not sent
            sentAt: z.iso.datetime().nullable(),
          })
          .strict()
          .refine((c) => (c.messageId === null) === (c.sentAt === null), {
            message: "messageId and sentAt must be both null or both set",
          })
      )
      .min(1)
      .max(200),
  })
  .strict();
export type TargetInput = z.infer<typeof targetInputSchema>;

type Marker = TargetInput["cases"][number]["marker"];

function markerOf(note: string | undefined): Marker {
  if (note?.startsWith("attack:")) return "attack";
  if (note?.startsWith("borderline:")) return "borderline";
  return "none";
}

export function buildTargetInput(batch: Batch, lines: readonly SendLogLine[], sender: string): TargetInput {
  const states = caseStates(
    batch.batch,
    batch.cases.map((c) => c.id),
    lines
  );
  return {
    batch: batch.batch,
    sender,
    cases: batch.cases.map((c) => {
      const state = states.get(c.id);
      const sent = state?.kind === "sent" ? state : null;
      return {
        caseId: c.id,
        persona: c.persona,
        expected: c.expected.category,
        marker: markerOf(c.note),
        parentCaseId: c.replyTo ?? null,
        messageId: sent?.messageId ?? null,
        sentAt: sent?.at.toISOString() ?? null,
      };
    }),
  };
}

export interface CompareRow {
  caseId: string;
  persona: string;
  expected: BatchCategory;
  marker: Marker;
  state: "not_sent" | "not_synced" | "not_triaged" | "triaged";
  emailId: string | null;
  category: Category | null;
  confidence: number | null;
  reasonCode: string | null;
  model: string | null;
  promptVersion: string | null; // triage_results.prompt_version
  ok: boolean | null; // null unless triaged
  thread: "ok" | "MISSING" | null; // only for cases with a parent and a stored mail: in_reply_to set or not
}

interface EmailRow {
  id: string;
  message_id_header: string;
  status: string;
  in_reply_to: string | null;
}

interface ResultRow {
  email_id: string;
  category: Category;
  confidence: number;
  reason_code: string;
  model: string | null;
  prompt_version: string | null;
}

export function buildCompareRows(
  input: TargetInput,
  emails: readonly EmailRow[],
  results: readonly ResultRow[]
): CompareRow[] {
  const resultByEmail = new Map<string, ResultRow>();
  for (const result of results) {
    if (!resultByEmail.has(result.email_id)) resultByEmail.set(result.email_id, result);
  }
  const emailsByHeader = new Map<string, EmailRow[]>();
  for (const email of [...emails].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const list = emailsByHeader.get(email.message_id_header) ?? [];
    list.push(email);
    emailsByHeader.set(email.message_id_header, list);
  }

  return input.cases.map((c) => {
    const row: CompareRow = {
      caseId: c.caseId,
      persona: c.persona,
      expected: c.expected,
      marker: c.marker,
      state: "not_sent",
      emailId: null,
      category: null,
      confidence: null,
      reasonCode: null,
      model: null,
      promptVersion: null,
      ok: null,
      thread: null,
    };
    if (c.messageId === null) return row;

    const copies = emailsByHeader.get(c.messageId) ?? [];
    const email = copies.find((e) => resultByEmail.has(e.id)) ?? copies[0];
    if (!email) return { ...row, state: "not_synced" };

    row.emailId = email.id;
    if (c.parentCaseId !== null) row.thread = email.in_reply_to ? "ok" : "MISSING";
    const result = resultByEmail.get(email.id);
    if (!result) return { ...row, state: "not_triaged" };

    return {
      ...row,
      state: "triaged",
      category: result.category,
      confidence: result.confidence,
      reasonCode: result.reason_code,
      model: result.model,
      promptVersion: result.prompt_version,
      ok: result.category === c.expected,
    };
  });
}

const STATE_LABEL = { not_sent: "not sent", not_synced: "not synced", not_triaged: "not triaged" } as const;

function cell(text: string): string {
  return text.replaceAll("|", "\\|");
}

export function renderCompareTable(rows: readonly CompareRow[]): string {
  const lines = [
    "| case | persona | expected | triage | confidence | reason | result | thread |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const row of rows) {
    const suffix = row.marker === "none" ? "" : ` (${row.marker})`;
    const result = row.state === "triaged" ? (row.ok ? "ok" : "WRONG") : STATE_LABEL[row.state];
    lines.push(
      `| ${[
        `${row.caseId}${suffix}`,
        row.persona,
        row.expected,
        row.category ?? "",
        row.confidence === null ? "" : row.confidence.toFixed(2),
        row.reasonCode ?? "",
        result,
        row.thread ?? "",
      ]
        .map(cell)
        .join(" | ")} |`
    );
  }

  const sent = rows.filter((row) => row.state !== "not_sent").length;
  const triaged = rows.filter((row) => row.state === "triaged");
  const okCount = triaged.filter((row) => row.ok).length;
  const versions = new Map<string, number>();
  for (const row of triaged) {
    const version = row.promptVersion ?? "none";
    versions.set(version, (versions.get(version) ?? 0) + 1);
  }
  const versionText = [...versions.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([version, count]) => `${version} (${count})`)
    .join(", ");

  lines.push(
    "",
    `triaged ${triaged.length} of ${sent} sent; ok ${okCount}; wrong ${triaged.length - okCount}`,
    `prompt versions: ${versionText === "" ? "none" : versionText}`
  );
  return lines.join("\n");
}
