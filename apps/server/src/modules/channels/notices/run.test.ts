import { randomUUID } from "node:crypto";
import { format } from "node:util";

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { warnSkipped } from "./run";

let lines: string[] = [];
let errorSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  lines = [];
  errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    lines.push(format(...args));
  });
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("warnSkipped", () => {
  test("one notice_skipped line per row, with the kind, the row id and the error name only", () => {
    const id = randomUUID();
    const error = new Error("123456:MARKER-TOKEN user@x.test");
    warnSkipped("urgent", id, error);
    warnSkipped("urgent", id, error);
    warnSkipped("urgent", randomUUID(), error);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(`[channels] notice_skipped kind=urgent item_id=${id} error=Error`);
    expect(lines.join("\n")).not.toContain("MARKER");
    expect(lines.join("\n")).not.toContain("user@x.test");
  });

  test("the dedup key splits one id into several rows; the logged id stays a UUID", () => {
    const orgId = randomUUID();
    warnSkipped("weekly_report", orgId, new Error("x"), `${orgId}:2026-11-16`);
    warnSkipped("weekly_report", orgId, new Error("x"), `${orgId}:2026-11-16`);
    warnSkipped("weekly_report", orgId, new Error("x"), `${orgId}:2026-11-23`);

    expect(lines).toEqual([
      `[channels] notice_skipped kind=weekly_report item_id=${orgId} error=Error`,
      `[channels] notice_skipped kind=weekly_report item_id=${orgId} error=Error`,
    ]);
  });

  test("an id that is not a UUID is dropped and counted, never written", () => {
    warnSkipped("urgent", "123456:MARKER-ID", new Error("x"));

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("kind=urgent");
    expect(lines[0]).toContain("dropped_fields=1");
    expect(lines[0]).not.toContain("MARKER");
  });
});
