import { describe, expect, test } from "bun:test";

import type { BatchCase } from "./batch";
import { buildSendRequest } from "./request";

const testCase: BatchCase = {
  id: "c1",
  persona: "boss",
  lang: "pl",
  subject: "Temat",
  body: "Tresc",
  expected: { category: "info" },
};
const base = { batchId: "2026-11-08-a", testCase, to: "inbox@example.test" };

describe("buildSendRequest", () => {
  test("without parent has no reply headers", () => {
    const request = buildSendRequest({ ...base, parentMessageId: null });
    expect(request.to).toEqual(["inbox@example.test"]);
    expect(request.subject).toBe("Temat");
    expect(request.text).toBe("Tresc");
    expect(request.headers).toEqual({ "X-EA-Testmail": "2026-11-08-a/c1" });
    expect("In-Reply-To" in request.headers).toBe(false);
    expect("References" in request.headers).toBe(false);
    expect(request.labels).toEqual(["ea-testmail", "ea-2026-11-08-a-c1"]);
  });

  test("with parent sets In-Reply-To and References", () => {
    const request = buildSendRequest({ ...base, parentMessageId: "<p@x.test>" });
    expect(request.headers["In-Reply-To"]).toBe("<p@x.test>");
    expect(request.headers["References"]).toBe("<p@x.test>");
  });

  test("same input gives byte-equal JSON", () => {
    const a = buildSendRequest({ ...base, parentMessageId: "<p@x.test>" });
    const b = buildSendRequest({ ...base, parentMessageId: "<p@x.test>" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
