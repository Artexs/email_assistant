import { readFileSync } from "node:fs";
import path from "node:path";

import { dataCategories, subprocessors } from "@ea/core/web";
import { describe, expect, test } from "bun:test";

import { en } from "../i18n/en";
import { pl } from "../i18n/pl";
import { fillSlots } from "./legal";
import { daysText, keptText, usedWhenText } from "./legal-tables";

describe("fillSlots", () => {
  test("fills a known slot and leaves an unknown one", () => {
    expect(fillSlots("a {x} b {y}", { x: 1 })).toBe("a 1 b {y}");
  });
});

describe("table texts", () => {
  test("days: one form for 1, another for the rest, in both languages", () => {
    expect(daysText(en, 1)).toBe("1 day");
    expect(daysText(en, 30)).toBe("30 days");
    expect(daysText(pl, 1)).toBe("1 dzień");
    expect(daysText(pl, 7)).toBe("7 dni");
  });

  test("the Kept column of the records of processing says the text of the privacy page for each until-delete category", () => {
    const records = readFileSync(path.join(import.meta.dir, "../../../../docs/legal/records-of-processing.md"), "utf8");
    const lines = records.split("\n").filter((line) => line.startsWith("|"));
    for (const category of dataCategories) {
      if (category.kept.kind !== "untilDelete") continue;
      const row = lines.find((line) => line.split("|")[1]?.trim() === `\`${category.id}\``);
      const cells = (row ?? "").split("|").map((cell) => cell.trim());
      const kept = cells[cells.length - 2] ?? "";
      expect({ id: category.id, kept: kept.toLowerCase() }).toEqual({
        id: category.id,
        kept: keptText(en, category.kept).toLowerCase(),
      });
    }
  });

  test("every kept kind of the registry has a text without an open slot", () => {
    for (const category of dataCategories)
      for (const texts of [en, pl]) expect(keptText(texts, category.kept)).not.toMatch(/[{}]/);
  });

  test("every used-when of the registry has a text without an open slot", () => {
    for (const row of subprocessors)
      for (const texts of [en, pl]) expect(usedWhenText(texts, row, row.activeWhen)).not.toMatch(/[{}]/);
  });

  test("a row with `unless` names the key and the value", () => {
    expect(usedWhenText(en, { name: "x" }, { kind: "env", key: "AUTH_PWNED_CHECK", unless: "off" })).toBe(
      "AUTH_PWNED_CHECK is not off"
    );
  });
});
