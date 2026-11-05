import { describe, expect, test } from "bun:test";

import { describeError, HardError } from "./errors";

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
