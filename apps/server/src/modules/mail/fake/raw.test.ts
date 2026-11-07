import { expect, test } from "bun:test";

import { parseRawHeaders } from "./raw";

test("parseRawHeaders unfolds lines, lower-cases names and keeps the first value", () => {
  const raw = Buffer.from(
    "References:\r\n <a>\r\n <b>\r\nX-Ea-Action-ID: one\r\nx-ea-action-id: two\r\n\r\nSubject: body"
  );
  const headers = parseRawHeaders(raw);
  expect(headers.get("references")).toBe("<a> <b>");
  expect(headers.get("x-ea-action-id")).toBe("one");
  expect(headers.has("subject")).toBe(false);
});
