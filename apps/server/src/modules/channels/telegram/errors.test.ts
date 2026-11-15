import { describe, expect, test } from "bun:test";
import { GrammyError, HttpError } from "grammy";

import { telegramErrorFields } from "./errors";

describe("telegramErrorFields", () => {
  test("a GrammyError gives its name, code and method, never the description or the payload", () => {
    const error = new GrammyError(
      "Call to 'sendMessage' failed!",
      { ok: false, error_code: 403, description: "Forbidden: bot was blocked by MARKER-DESC" },
      "sendMessage",
      { text: "MARKER-PAYLOAD" }
    );
    const fields = telegramErrorFields(error);
    expect(fields).toEqual({ error: "GrammyError", error_code: 403, method: "sendMessage" });
    expect(JSON.stringify(fields)).not.toContain("MARKER");
  });

  test("a GrammyError whose error_code is a string gives no error_code", () => {
    const error = new GrammyError(
      "Call to 'sendMessage' failed!",
      { ok: false, error_code: "123456789:AAH-canary" as unknown as number, description: "x" },
      "sendMessage",
      {}
    );
    const fields = telegramErrorFields(error);
    expect(fields).toEqual({ error: "GrammyError", method: "sendMessage" });
    expect(JSON.stringify(fields)).not.toContain("canary");
  });

  test("an HttpError gives its name and method, never the inner error with the token URL", () => {
    const inner = new Error("fetch failed: https://api.telegram.org/bot123456:MARKER/getUpdates");
    const error = new HttpError("Network request for 'getUpdates' failed!", inner);
    const fields = telegramErrorFields(error);
    expect(fields).toEqual({ error: "HttpError", method: "getUpdates" });
    expect(JSON.stringify(fields)).not.toContain("MARKER");
  });

  test("an HttpError whose message holds no method gives the name only", () => {
    const error = new HttpError("failed https://api.telegram.org/bot123456:MARKER/x", new Error("MARKER"));
    const fields = telegramErrorFields(error);
    expect(fields).toEqual({ error: "HttpError" });
    expect(JSON.stringify(fields)).not.toContain("MARKER");
  });

  test("any other error gives its name only, never its message", () => {
    const fields = telegramErrorFields(new Error("MARKER"));
    expect(fields).toEqual({ error: "Error" });
    expect(JSON.stringify(fields)).not.toContain("MARKER");
  });
});
