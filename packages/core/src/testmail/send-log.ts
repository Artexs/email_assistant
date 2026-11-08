import { z } from "zod";

export const TESTMAIL_LABEL = "ea-testmail";

export const deliverFolderKeys = ["inbox", "offers", "social", "bills", "junk", "db"] as const;

export const sendLogLineSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("intent"),
    batch: z.string(),
    case: z.string(),
    attempt: z.number().int().min(1),
    key: z.string(),
    hash: z.string().regex(/^[0-9a-f]{64}$/),
    at: z.iso.datetime(),
  }),
  z.object({
    type: z.literal("sent"),
    batch: z.string(),
    case: z.string(),
    attempt: z.number().int().min(1),
    key: z.string(),
    messageId: z.string().min(3),
    threadId: z.string(),
    inbox: z.string(),
    via: z.enum(["send", "label"]),
    at: z.iso.datetime(),
  }),
  z.object({
    type: z.literal("failed"),
    batch: z.string(),
    case: z.string(),
    attempt: z.number().int().min(1),
    key: z.string(),
    code: z.string().regex(/^[a-z0-9_]{1,40}$/),
    at: z.iso.datetime(),
  }),
  z.object({
    type: z.literal("delivered"),
    batch: z.string(),
    case: z.string(),
    folder: z.enum(deliverFolderKeys),
    result: z.enum(["moved", "in_inbox", "duplicate_removed", "synced"]),
    at: z.iso.datetime(),
  }),
]);
export type SendLogLine = z.infer<typeof sendLogLineSchema>;

function parseLine(text: string): SendLogLine | null {
  try {
    const result = sendLogLineSchema.safeParse(JSON.parse(text));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function parseSendLog(text: string): { lines: SendLogLine[]; badLines: number[]; partialLast: boolean } {
  const rawLines = text.split("\n");
  const lastIndex = rawLines.length - 1;
  const partialLast = (rawLines[lastIndex] ?? "").trim() !== "";

  const lines: SendLogLine[] = [];
  const badLines: number[] = [];
  rawLines.forEach((raw, index) => {
    if (raw.trim() === "") return;
    if (partialLast && index === lastIndex) return;
    const line = parseLine(raw);
    if (line === null) badLines.push(index + 1);
    else lines.push(line);
  });
  return { lines, badLines, partialLast };
}

export function formatSendLogLine(line: SendLogLine): string {
  return `${JSON.stringify(line)}\n`;
}

export type CaseState =
  | { kind: "due" }
  | { kind: "open"; attempt: number; key: string; hash: string; at: Date }
  | { kind: "sent"; attempt: number; messageId: string; threadId: string; inbox: string; at: Date }
  | { kind: "failed"; attempt: number; code: string };

const RANK = { intent: 0, failed: 1, sent: 2 } as const;

export function caseStates(
  batchId: string,
  caseIds: readonly string[],
  lines: readonly SendLogLine[]
): Map<string, CaseState> {
  type Tracked = Exclude<SendLogLine, { type: "delivered" }>;
  const known = new Set(caseIds);
  const byCase = new Map<string, Tracked[]>();
  for (const line of lines) {
    if (line.batch !== batchId || !known.has(line.case) || line.type === "delivered") continue;
    const list = byCase.get(line.case) ?? [];
    list.push(line);
    byCase.set(line.case, list);
  }

  const states = new Map<string, CaseState>();
  for (const id of caseIds) {
    const list = byCase.get(id) ?? [];
    let sent: Extract<Tracked, { type: "sent" }> | null = null;
    let top: Tracked | null = null;
    for (const line of list) {
      if (line.type === "sent" && (sent === null || Date.parse(line.at) < Date.parse(sent.at))) sent = line;
      if (
        top === null ||
        line.attempt > top.attempt ||
        (line.attempt === top.attempt && RANK[line.type] > RANK[top.type])
      ) {
        top = line;
      }
    }
    if (sent !== null) {
      states.set(id, {
        kind: "sent",
        attempt: sent.attempt,
        messageId: sent.messageId,
        threadId: sent.threadId,
        inbox: sent.inbox,
        at: new Date(sent.at),
      });
    } else if (top === null) {
      states.set(id, { kind: "due" });
    } else if (top.type === "failed") {
      states.set(id, { kind: "failed", attempt: top.attempt, code: top.code });
    } else if (top.type === "intent") {
      states.set(id, { kind: "open", attempt: top.attempt, key: top.key, hash: top.hash, at: new Date(top.at) });
    }
  }
  return states;
}

export function sentInWindow(lines: readonly SendLogLine[], now: Date, windowMs: number): number {
  const from = now.getTime() - windowMs;
  return lines.filter((line) => line.type === "sent" && line.via === "send" && Date.parse(line.at) > from).length;
}

function guardId(value: string): string {
  if (!/^[A-Za-z0-9\-._~]+$/.test(value) || value.length > 256) {
    throw new Error("Invalid id for key or label");
  }
  return value;
}

export function idempotencyKey(batchId: string, caseId: string, attempt: number): string {
  return guardId(`ea-${batchId}-${caseId}-a${attempt}`);
}

export function caseLabel(batchId: string, caseId: string): string {
  return guardId(`ea-${batchId}-${caseId}`);
}
