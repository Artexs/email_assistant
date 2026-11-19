import { ADDRESS_RULE_PROBES, ADDRESS_TRIM_CHARS, normalizeSenderAddress } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { divergentCodePoints, normalizedAddress } from "../../src/modules/contacts";

import { testDb } from "./helpers";

// The SQL form of the address rule (`normalizedAddress`) and the program form (`normalizeSenderAddress`) agree on the
// whitespace ends and on every letter that a real address holds. This test runs on the test database, so it proves the
// rule for that database build only: the C library and its Unicode version decide how `lower()` treats new letters.
const db = testDb();
afterAll(async () => {
  await db.destroy();
});

const TRIM_CODE_POINTS = [...ADDRESS_TRIM_CHARS].map((char) => char.codePointAt(0) as number);

// The letters that Bun (Unicode 16 and 17) lowers and the glibc of the image `postgres:17` does not: U+A7CE, U+A7D2,
// U+A7D4 and U+16EA0 to U+16EB8.
const KNOWN_POSTGRES_17_LETTERS: number[] = [
  0xa7ce,
  0xa7d2,
  0xa7d4,
  ...Array.from({ length: 0x16eb8 - 0x16ea0 + 1 }, (_, index) => 0x16ea0 + index),
];

const hex = (text: string): string =>
  [...text].map((char) => `U+${(char.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, "0")}`).join(",");

describe("the SQL form and the program form of the address rule", () => {
  test("probe strings: no difference over all probes, whitespace included", async () => {
    // The probes go in as one `text[]` parameter: no `convert_from`, no `name` value (the collation of a `name` is `C`).
    const result = await sql<{ n: string; db: string }>`
      select t.n::text as n, ${normalizedAddress("t.p")} as db
      from unnest(${ADDRESS_RULE_PROBES as string[]}::text[]) with ordinality as t(p, n)
      order by t.n
    `.execute(db);
    expect(result.rows).toHaveLength(ADDRESS_RULE_PROBES.length);
    const differences = result.rows
      .map((row) => {
        const probe = ADDRESS_RULE_PROBES[Number(row.n) - 1] as string;
        return { probe: hex(probe), js: normalizeSenderAddress(probe), db: row.db };
      })
      .filter((row) => row.js !== row.db)
      .map((row) => ({ ...row, js: hex(row.js), db: hex(row.db) }));
    expect(differences).toEqual([]);
  });

  test("every code point: no difference in whitespace, below U+0530 and in the letters of the probes", async () => {
    const started = Date.now();
    const divergent = await divergentCodePoints(db);
    const elapsed = Date.now() - started;
    const probeLetters = new Set([...ADDRESS_RULE_PROBES.join("")].map((char) => char.codePointAt(0) as number));
    const trimSet = new Set(TRIM_CODE_POINTS);
    const mustAgree = divergent.filter(
      ({ cp }) => trimSet.has(cp) || cp < 0x0530 || probeLetters.has(cp) || String.fromCodePoint(cp).trim() === ""
    );
    expect(mustAgree.map(({ cp, js, db: dbForm }) => `U+${cp.toString(16)} js ${hex(js)} db ${hex(dbForm)}`)).toEqual(
      []
    );
    // Letters that a newer Unicode table of Bun lowers and an older C library of the database does not (the image
    // `postgres:17` shows 28, a newer C library shows 0). The run-time check refuses such an address.
    process.stdout.write(`address rule: ${divergent.length} divergent code points, query and compare ${elapsed} ms\n`);
    expect(elapsed).toBeLessThan(10_000);
  });

  test("every code point: on postgres 17 the divergent set is inside the 28 known letters", async () => {
    const version = Number((await sql<{ v: string }>`show server_version_num`.execute(db)).rows[0]?.v);
    const divergent = await divergentCodePoints(db);
    const listed = divergent.map(({ cp }) => cp);
    if (version < 170000 || version >= 180000) {
      // Another server version: another C library, another answer. Printed only.
      process.stdout.write(`address rule: server ${version}, divergent ${listed.map((cp) => cp.toString(16))}\n`);
      return;
    }
    const known = new Set(KNOWN_POSTGRES_17_LETTERS);
    const unknown = divergent.filter(({ cp }) => !known.has(cp));
    expect(unknown.map(({ cp, js, db: dbForm }) => `U+${cp.toString(16)} js ${hex(js)} db ${hex(dbForm)}`)).toEqual([]);
    // No trim difference and nothing below U+0530, whatever the known set holds.
    expect(listed.filter((cp) => cp < 0x0530 || TRIM_CODE_POINTS.includes(cp))).toEqual([]);
  });

  test("framed whitespace: each character of the trim set around an address is cut in SQL", async () => {
    const framed = TRIM_CODE_POINTS.map((cp) => `${String.fromCodePoint(cp)}Anna@X.test${String.fromCodePoint(cp)}`);
    const result = await sql<{ db: string }>`
      select ${normalizedAddress("t.p")} as db from unnest(${framed}::text[]) with ordinality as t(p, n) order by t.n
    `.execute(db);
    expect(result.rows.map((row) => row.db)).toEqual(framed.map(() => "anna@x.test"));
    // The program form agrees.
    expect(framed.map((text) => normalizeSenderAddress(text))).toEqual(framed.map(() => "anna@x.test"));
  });

  test("the full-range check sees a break: with the default btrim it lists every trim code point but the space", async () => {
    const spacesOnly = (column: string) => sql<unknown>`btrim(${sql.raw(column)})`;
    const divergent = await divergentCodePoints(db, spacesOnly);
    const listed = new Set(divergent.map(({ cp }) => cp));
    const missed = TRIM_CODE_POINTS.filter((cp) => cp !== 0x20 && !listed.has(cp));
    expect(missed).toEqual([]);
    expect(listed.has(0x20)).toBe(false);
  });
});
