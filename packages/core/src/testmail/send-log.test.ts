import { describe, expect, test } from "bun:test";

import {
  caseLabel,
  caseStates,
  formatSendLogLine,
  idempotencyKey,
  parseSendLog,
  sentInWindow,
  type SendLogLine,
} from "./send-log";

const HASH = "a".repeat(64);
const BATCH = "2026-11-08-a";

function intent(attempt: number, caseId = "c1", batch = BATCH): SendLogLine {
  return {
    type: "intent",
    batch,
    case: caseId,
    attempt,
    key: idempotencyKey(batch, caseId, attempt),
    hash: HASH,
    at: "2026-11-08T10:00:00.000Z",
  };
}

function sent(attempt: number, at = "2026-11-08T10:00:01.000Z", via: "send" | "label" = "send"): SendLogLine {
  return {
    type: "sent",
    batch: BATCH,
    case: "c1",
    attempt,
    key: idempotencyKey(BATCH, "c1", attempt),
    messageId: `<m${attempt}@x.test>`,
    threadId: "t1",
    inbox: "ea@agentmail.to",
    via,
    at,
  };
}

function failed(attempt: number): SendLogLine {
  return {
    type: "failed",
    batch: BATCH,
    case: "c1",
    attempt,
    key: idempotencyKey(BATCH, "c1", attempt),
    code: "http_500",
    at: "2026-11-08T10:00:02.000Z",
  };
}

const delivered: SendLogLine = {
  type: "delivered",
  batch: BATCH,
  case: "c1",
  folder: "offers",
  result: "moved",
  at: "2026-11-08T10:05:00.000Z",
};

const text = (...lines: SendLogLine[]) => lines.map(formatSendLogLine).join("");

describe("parseSendLog", () => {
  test("parses valid lines", () => {
    const result = parseSendLog(text(intent(1), sent(1), delivered));
    expect(result.lines).toHaveLength(3);
    expect(result.badLines).toEqual([]);
    expect(result.partialLast).toBe(false);
  });

  test("ignores a partial last line", () => {
    const result = parseSendLog(`${text(intent(1))}{"type":"sent"`);
    expect(result.lines).toHaveLength(1);
    expect(result.partialLast).toBe(true);
    expect(result.badLines).toEqual([]);
  });

  test("ignores a valid JSON last line without a final newline", () => {
    const result = parseSendLog(`${text(intent(1))}${JSON.stringify(sent(1))}`);
    expect(result.lines).toHaveLength(1);
    expect(result.partialLast).toBe(true);
  });

  test("keeps the complete line before a whitespace-only tail", () => {
    const result = parseSendLog(`${text(intent(1))} `);
    expect(result.lines).toHaveLength(1);
    expect(result.partialLast).toBe(false);
  });

  test("reports bad lines with 1-based numbers", () => {
    const valid = text(intent(1));
    const result = parseSendLog(`${valid}not json\n${valid}`);
    expect(result.badLines).toEqual([2]);
    expect(result.lines).toHaveLength(2);
    expect(result.partialLast).toBe(false);
  });

  test("rejects a line that fails the schema", () => {
    const result = parseSendLog(`${JSON.stringify({ ...intent(1), hash: "short" })}\n`);
    expect(result.badLines).toEqual([1]);
  });

  test("empty text", () => {
    expect(parseSendLog("")).toEqual({ lines: [], badLines: [], partialLast: false });
  });
});

describe("formatSendLogLine", () => {
  test("round-trips through parseSendLog", () => {
    for (const line of [intent(1), sent(1), failed(1), delivered]) {
      const formatted = formatSendLogLine(line);
      expect(formatted.endsWith("\n")).toBe(true);
      expect(parseSendLog(formatted).lines).toEqual([line]);
    }
  });
});

describe("caseStates", () => {
  const states = (...lines: SendLogLine[]) => caseStates(BATCH, ["c1", "c2"], lines).get("c1");

  test("no lines is due", () => {
    expect(states()).toEqual({ kind: "due" });
  });

  test("intent is open", () => {
    expect(states(intent(1))).toMatchObject({ kind: "open", attempt: 1, hash: HASH });
  });

  test("intent and sent is sent", () => {
    expect(states(intent(1), sent(1))).toMatchObject({ kind: "sent", attempt: 1, messageId: "<m1@x.test>" });
  });

  test("intent and failed is failed", () => {
    expect(states(intent(1), failed(1))).toMatchObject({ kind: "failed", attempt: 1, code: "http_500" });
  });

  test("a newer intent is open", () => {
    expect(states(intent(1), intent(2))).toMatchObject({ kind: "open", attempt: 2 });
  });

  test("sent of an older attempt wins over a newer intent", () => {
    expect(states(sent(1), intent(2))).toMatchObject({ kind: "sent", attempt: 1 });
  });

  test("the earliest sent wins", () => {
    expect(states(sent(2, "2026-11-08T11:00:00.000Z"), sent(1, "2026-11-08T10:00:00.000Z"))).toMatchObject({
      kind: "sent",
      attempt: 1,
    });
  });

  test("lines of another batch and unknown cases are ignored", () => {
    expect(states(intent(1, "c1", "2026-11-08-b"), intent(1, "zzz"))).toEqual({ kind: "due" });
  });

  test("a delivered line alone is due", () => {
    expect(states(delivered)).toEqual({ kind: "due" });
  });
});

describe("sentInWindow", () => {
  const now = new Date("2026-11-08T12:00:00Z");
  const day = 24 * 3_600_000;

  test("counts only sends inside the window", () => {
    expect(sentInWindow([sent(1, "2026-11-07T12:00:01Z")], now, day)).toBe(1);
    expect(sentInWindow([sent(1, "2026-11-07T11:59:59Z")], now, day)).toBe(0);
  });

  test("ignores label recoveries and other types", () => {
    expect(sentInWindow([sent(1, "2026-11-08T11:00:00Z", "label"), intent(1), delivered], now, day)).toBe(0);
  });
});

describe("keys and labels", () => {
  test("idempotencyKey", () => {
    expect(idempotencyKey("2026-11-08-a", "c1", 2)).toBe("ea-2026-11-08-a-c1-a2");
    expect(() => idempotencyKey("2026-11-08-a", "c@1", 1)).toThrow();
  });

  test("caseLabel", () => {
    expect(caseLabel("2026-11-08-a", "c1")).toBe("ea-2026-11-08-a-c1");
    expect(() => caseLabel("b", "x".repeat(300))).toThrow();
  });
});
