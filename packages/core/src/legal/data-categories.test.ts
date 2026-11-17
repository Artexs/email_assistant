import { describe, expect, test } from "bun:test";

import { categoryOfColumn, dataCategories, NO_PERSONAL_DATA_TABLES, tableOfEntry } from "./data-categories";

describe("dataCategories", () => {
  test("category ids are unique", () => {
    const ids = dataCategories.map((category) => category.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every text has a non-empty en and pl, and a category has a subject", () => {
    for (const category of dataCategories) {
      for (const text of [category.label, category.purpose]) {
        expect({ id: category.id, en: text.en.trim() !== "", pl: text.pl.trim() !== "" }).toEqual({
          id: category.id,
          en: true,
          pl: true,
        });
      }
      expect({ id: category.id, subjects: category.subjects.length > 0 }).toEqual({ id: category.id, subjects: true });
    }
  });

  test("every entry is table.column or table.*", () => {
    for (const category of dataCategories) {
      expect(category.columns.length).toBeGreaterThan(0);
      for (const entry of category.columns)
        expect({ entry, ok: /^[a-z_]+\.([a-z_]+|\*)$/.test(entry) }).toEqual({ entry, ok: true });
    }
  });

  test("a column is in at most one category", () => {
    const owner = new Map<string, string>();
    for (const category of dataCategories) {
      for (const entry of category.columns) {
        expect({ entry, other: owner.get(entry) }).toEqual({ entry, other: undefined });
        owner.set(entry, category.id);
      }
    }
    // `table.*` takes the whole table: no other category may list a column of it.
    for (const [entry, id] of owner) {
      if (!entry.endsWith(".*")) continue;
      const table = tableOfEntry(entry);
      const clashes = [...owner].filter(([other]) => other !== entry && tableOfEntry(other) === table);
      expect({ entry, id, clashes }).toEqual({ entry, id, clashes: [] });
    }
  });

  test("no table is both in a category and in NO_PERSONAL_DATA_TABLES", () => {
    const listed = new Set(dataCategories.flatMap((category) => category.columns.map(tableOfEntry)));
    for (const table of Object.keys(NO_PERSONAL_DATA_TABLES))
      expect({ table, listed: listed.has(table) }).toEqual({ table, listed: false });
  });

  test("every NO_PERSONAL_DATA_TABLES entry has a reason", () => {
    for (const [table, reason] of Object.entries(NO_PERSONAL_DATA_TABLES))
      expect({ table, reason: reason.trim() !== "" }).toEqual({ table, reason: true });
  });

  test("categoryOfColumn finds a column by name and by table.*", () => {
    expect(categoryOfColumn("emails", "body_text")?.id).toBe("mail-body");
    expect(categoryOfColumn("chat_links", "channel")?.id).toBe("chat-links");
    expect(categoryOfColumn("emails", "no_such_column")).toBeUndefined();
  });
});
