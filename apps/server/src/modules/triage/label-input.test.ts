import { describe, expect, test } from "bun:test";

import { parseLabelInput } from "./label-input";

describe("parseLabelInput", () => {
  test("Enter on a real category means right", () => {
    expect(parseLabelInput("", "info")).toEqual({ kind: "right" });
  });

  test("Enter on unsure asks again", () => {
    const result = parseLabelInput("", "unsure");
    expect(result.kind).toBe("ask_again");
  });

  test("a number or a name gives the true category", () => {
    expect(parseLabelInput("3", "spam")).toEqual({ kind: "category", category: "info" });
    expect(parseLabelInput("spam", "info")).toEqual({ kind: "category", category: "spam" });
    expect(parseLabelInput("1", "unsure")).toEqual({ kind: "category", category: "urgent" });
  });

  test("w, s and q", () => {
    expect(parseLabelInput("w", "info")).toEqual({ kind: "wrong" });
    expect(parseLabelInput("s", "info")).toEqual({ kind: "skip" });
    expect(parseLabelInput("q", "info")).toEqual({ kind: "quit" });
  });

  test("w on unsure asks again", () => {
    const result = parseLabelInput("w", "unsure");
    expect(result.kind).toBe("ask_again");
    expect(result.kind === "ask_again" && result.message).toContain("unsure is not a label");
  });

  test("unknown input, delegation and unsure ask again", () => {
    expect(parseLabelInput("x", "info").kind).toBe("ask_again");
    expect(parseLabelInput("delegation", "info").kind).toBe("ask_again");
    expect(parseLabelInput("unsure", "info").kind).toBe("ask_again");
    expect(parseLabelInput("6", "info").kind).toBe("ask_again");
  });
});
