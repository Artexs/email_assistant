import { describe, expect, test } from "bun:test";

import { commandNames } from "./port";
import { helpText, LINKED_TEXT } from "./texts";

describe("texts", () => {
  test("helpText names all five commands", () => {
    expect(commandNames).toHaveLength(5);
    for (const name of commandNames) {
      expect(helpText()).toContain(`/${name} `);
    }
  });

  test("LINKED_TEXT starts with a check mark and holds the help", () => {
    expect(LINKED_TEXT.startsWith("✅")).toBe(true);
    expect(LINKED_TEXT).toContain(helpText());
  });
});
