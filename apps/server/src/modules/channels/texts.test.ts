import { textTables } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { commandNames } from "./port";
import { BOT_COMMANDS } from "./telegram/polling";
import { helpText, LINKED_TEXT } from "./texts";

describe("texts", () => {
  test("helpText names all six commands", () => {
    expect(commandNames).toHaveLength(6);
    for (const name of commandNames) {
      expect(helpText()).toContain(`/${name} `);
    }
  });

  test("7. the help list holds /review and the command menu holds review (en and pl texts exist)", () => {
    expect(helpText()).toContain("/review – label a random sample of recent mail");
    expect(BOT_COMMANDS.map((entry) => entry.command)).toContain("review");
    expect(BOT_COMMANDS.find((entry) => entry.command === "review")?.description).toBe(
      textTables.en.review.commandDescription
    );
    expect(textTables.pl.review.helpLine).toStartWith("/review ");
    expect(BOT_COMMANDS.map((entry) => entry.command).sort()).toEqual([...commandNames].sort());
  });

  test("LINKED_TEXT starts with a check mark and holds the help", () => {
    expect(LINKED_TEXT.startsWith("✅")).toBe(true);
    expect(LINKED_TEXT).toContain(helpText());
  });
});
