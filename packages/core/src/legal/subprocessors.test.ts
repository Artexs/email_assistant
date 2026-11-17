import { describe, expect, test } from "bun:test";

import { subprocessors } from "./subprocessors";

describe("subprocessors", () => {
  test("ids are unique", () => {
    const ids = subprocessors.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every text has a non-empty en and pl", () => {
    for (const row of subprocessors) {
      for (const [field, text] of [
        ["purpose", row.purpose],
        ["dataReceived", row.dataReceived],
        ["location", row.location],
      ] as const) {
        expect({ id: row.id, field, en: text.en.trim() === "" }).toEqual({ id: row.id, field, en: false });
        expect({ id: row.id, field, pl: text.pl.trim() === "" }).toEqual({ id: row.id, field, pl: false });
      }
      expect(row.name.trim()).not.toBe("");
    }
  });

  test("a placeholder is the same in both languages", () => {
    const placeholders = (text: string) => text.match(/<[^>]+>/g) ?? [];
    for (const row of subprocessors) {
      for (const text of [row.purpose, row.dataReceived, row.location]) {
        expect({ id: row.id, pl: placeholders(text.pl) }).toEqual({ id: row.id, pl: placeholders(text.en) });
      }
    }
  });

  test("termsUrl is an https URL or a to-confirm placeholder", () => {
    for (const row of subprocessors) {
      expect({
        id: row.id,
        ok: /^https:\/\/\S+$/.test(row.termsUrl) || /^<to confirm: [^>]+>$/.test(row.termsUrl),
      }).toEqual({
        id: row.id,
        ok: true,
      });
    }
  });
});
