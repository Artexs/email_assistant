import { describe, expect, test } from "bun:test";

import { readStdinSecret } from "./stdin-secret";

describe("readStdinSecret", () => {
  test("a terminal is refused and stdin is not read", async () => {
    let reads = 0;
    const result = await readStdinSecret({
      isTTY: true,
      read: async () => {
        reads += 1;
        return "typed\n";
      },
    });
    expect(result).toEqual({
      ok: false,
      refusal: "refused: stdin is a terminal; pipe the password in (it never comes from an argument)",
    });
    expect(reads).toBe(0);
  });

  test.each([
    ["a pipe with a final newline", "s3cret\n", "s3cret"],
    ["a pipe with a CRLF", "s3cret\r\n", "s3cret"],
    ["a pipe with no newline", "s3cret", "s3cret"],
    ["a secret with inner spaces and one newline", " a b \n\n", " a b \n"],
  ])("%s gives the secret", async (_label, text, secret) => {
    expect(await readStdinSecret({ isTTY: false, read: async () => text })).toEqual({ ok: true, secret });
  });

  test.each([
    ["nothing", ""],
    ["one newline", "\n"],
  ])("%s is refused as empty", async (_label, text) => {
    expect(await readStdinSecret({ isTTY: false, read: async () => text })).toEqual({
      ok: false,
      refusal: "refused: the password on stdin is empty",
    });
  });
});
