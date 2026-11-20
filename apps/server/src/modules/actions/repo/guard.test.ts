import { describe, expect, test } from "bun:test";
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from "kysely";

import type { DB } from "../../../platform/db";
import { WRITER_GUARDS, type WriterGuard } from "../transitions";

import { guardGroups, statusGuard, writerGuard } from "./guard";

const G: WriterGuard = {
  writer: "finishAction",
  variant: "t",
  from: { move: ["ready", "applying"], flag: ["ready", "applying"], send: ["applying"] },
  to: ["failed"],
};

const compileDb = new Kysely<DB>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db) => new PostgresIntrospector(db),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});

function compile(guard: WriterGuard, narrow?: Parameters<typeof statusGuard>[2]) {
  return compileDb
    .updateTable("actions")
    .set({ locked_at: null })
    .where((eb) => statusGuard(eb, guard, narrow))
    .compile();
}

describe("guardGroups", () => {
  test("1: types with an equal from-list share a group, in actionTypes order", () => {
    expect(guardGroups(G)).toEqual([
      { types: ["move", "flag"], statuses: ["ready", "applying"] },
      { types: ["send"], statuses: ["applying"] },
    ]);
  });

  test("2: a narrowing keeps the statuses that it names and drops the empty groups", () => {
    expect(guardGroups(G, ["ready"])).toEqual([{ types: ["move", "flag"], statuses: ["ready"] }]);
  });

  test("3: a narrowing that matches nothing gives no group", () => {
    expect(guardGroups(G, ["approved"])).toEqual([]);
  });
});

describe("writerGuard", () => {
  test("4: an unknown row throws and names the writer and the variant", () => {
    expect(() => writerGuard("markUndone", "nope")).toThrow("markUndone / nope");
  });

  test("5: every (writer, variant) of the map resolves, and no pair appears twice", () => {
    const pairs = WRITER_GUARDS.map((guard) => `${guard.writer} / ${guard.variant}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    for (const guard of WRITER_GUARDS) {
      expect(writerGuard(guard.writer, guard.variant)).toBe(guard);
    }
  });
});

describe("statusGuard", () => {
  test("6: two type groups are joined by or", () => {
    const { sql, parameters } = compile(G);
    expect(sql).toContain(`("type" in ($2, $3) and "status" in ($4, $5)) or ("type" in ($6) and "status" in ($7))`);
    expect(parameters).toEqual([null, "move", "flag", "ready", "applying", "send", "applying"]);
  });

  test("6: no group is a false literal", () => {
    const { sql, parameters } = compile(G, ["approved"]);
    expect(sql).toMatch(/where false$/);
    expect(parameters).toEqual([null]);
  });
});
