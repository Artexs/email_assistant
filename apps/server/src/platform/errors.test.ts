import { describe, expect, test } from "bun:test";

import { describeError, errorFields, HardError } from "./errors";

describe("describeError", () => {
  test("gives the name and never the message", () => {
    const text = describeError(new HardError("secret"));
    expect(text).toBe("HardError");
    expect(text).not.toContain("secret");
  });

  test("adds a string code", () => {
    const error = Object.assign(new Error("secret"), { code: "23505" });
    expect(describeError(error)).toBe("Error 23505");
  });

  test("adds a number code", () => {
    const error = Object.assign(new Error("secret"), { code: 429 });
    expect(describeError(error)).toBe("Error 429");
  });

  test("adds the code of a plain object", () => {
    expect(describeError({ code: "23505", message: "secret" })).toBe("object 23505");
  });

  test("gives the type of a non-Error", () => {
    expect(describeError("secret")).toBe("string");
  });
});

describe("errorFields", () => {
  test("gives the name and a string code, never the message", () => {
    const fields = errorFields(Object.assign(new Error("MARKER"), { code: "EAUTH" }));
    expect(fields).toEqual({ error: "Error", error_code: "EAUTH" });
    expect(JSON.stringify(fields)).not.toContain("MARKER");
  });

  test("gives a number code", () => {
    expect(errorFields(Object.assign(new Error("m"), { code: 503 }))).toEqual({
      error: "Error",
      error_code: 503,
    });
  });

  test("has no error_code key without a code", () => {
    const fields = errorFields(new TypeError("MARKER"));
    expect(fields).toEqual({ error: "TypeError" });
    expect("error_code" in fields).toBe(false);
    expect(JSON.stringify(fields)).not.toContain("MARKER");
  });

  test("gives the type of a non-Error", () => {
    expect(errorFields("MARKER")).toEqual({ error: "string" });
    expect(errorFields(null)).toEqual({ error: "object" });
  });

  test("ignores a code that is not a string or number", () => {
    expect(errorFields(Object.assign(new Error("m"), { code: { a: 1 } }))).toEqual({
      error: "Error",
    });
  });
});
