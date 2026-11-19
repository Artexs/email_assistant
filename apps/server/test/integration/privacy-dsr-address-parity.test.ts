import {
  addressCaseForms,
  addressCasedCodePoints,
  ADDRESS_RULE_PROBES,
  ADDRESS_TRIM_CHARS,
  normalizeSenderAddress,
} from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { divergentCodePoints, normalizedAddress } from "../../src/modules/contacts";
import { addressRegex, matchesAddress, normalizeDsrAddress } from "../../src/modules/privacy";

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

// The text match (`addressRegex` with `matchesAddress`) and the equality match (`normalizedAddress`) give one answer for
// the same pair of an asked address and a text. The texts are the probes inside a sentence.
describe("the text pattern and the equality match", () => {
  const ASKED = ADDRESS_RULE_PROBES.map((probe) => normalizeDsrAddress(probe)).filter(
    (address): address is string => address !== null
  );
  const TEXTS = ADDRESS_RULE_PROBES.map((probe) => probe.trim());

  test("every accepted probe address against every probe: no difference, in the text form", async () => {
    expect(ASKED.length).toBeGreaterThanOrEqual(40);
    const mismatches: string[] = [];
    let hits = 0;
    for (const asked of ASKED) {
      const result = await sql<{ n: string; hit: boolean; equal: boolean }>`
        select t.n::text as n,
          ${matchesAddress(sql`'write to ' || t.p || ' today'`, addressRegex(asked))} as hit,
          ${normalizedAddress("t.p")} = ${asked} as equal
        from unnest(${TEXTS}::text[]) with ordinality as t(p, n)
      `.execute(db);
      expect(result.rows).toHaveLength(TEXTS.length);
      for (const row of result.rows) {
        if (row.hit) hits++;
        if (row.hit !== row.equal) mismatches.push(`${hex(asked)} vs ${hex(TEXTS[Number(row.n) - 1] as string)}`);
      }
    }
    expect(mismatches).toEqual([]);
    // Not an empty agreement: every asked address finds at least its own probe, and the case forms add more.
    expect(hits).toBeGreaterThan(ASKED.length);
  });

  test("every accepted probe address against every probe: no difference, in the json form", async () => {
    const mismatches: string[] = [];
    let hits = 0;
    const documents = TEXTS.map((text) => JSON.stringify({ to: `write to ${text} today` }));
    for (const asked of ASKED) {
      const result = await sql<{ n: string; hit: boolean; equal: boolean }>`
        select t.n::text as n,
          ${matchesAddress(sql`t.d::jsonb::text`, addressRegex(asked, { json: true }))} as hit,
          ${normalizedAddress("t.p")} = ${asked} as equal
        from unnest(${documents}::text[], ${TEXTS}::text[]) with ordinality as t(d, p, n)
      `.execute(db);
      expect(result.rows).toHaveLength(TEXTS.length);
      for (const row of result.rows) {
        if (row.hit) hits++;
        if (row.hit !== row.equal) mismatches.push(`${hex(asked)} vs ${hex(TEXTS[Number(row.n) - 1] as string)}`);
      }
    }
    expect(mismatches).toEqual([]);
    expect(hits).toBeGreaterThan(ASKED.length);
  });

  // The asked address, the text and the answer. Escapes: DOTLESS is U+0131, SHARP is U+00DF, CAPITAL_SHARP is U+1E9E,
  // OHM is U+2126, OMEGA_SIGN is U+03A9, KELVIN is U+212A, LONG_S is U+017F, DOT is U+0307, DOTTED is U+0130.
  const NAMED: { asked: string; text: string; hit: boolean }[] = [
    { asked: "\u0131lker@x.tr", text: "ILKER@x.tr", hit: false },
    { asked: "\u0131lker@x.tr", text: "\u0131lker@x.tr", hit: true },
    { asked: "ilker@x.tr", text: "ILKER@x.tr", hit: true },
    { asked: "ilker@x.tr", text: "\u0130LKER@x.tr", hit: true },
    { asked: "ilker@x.tr", text: "I\u0307LKER@x.tr", hit: true },
    { asked: "ilker@x.tr", text: "i\u0307lker@x.tr", hit: true },
    { asked: "ilker@x.tr", text: "\u0131lker@x.tr", hit: false },
    { asked: "stra\u00dfe@x.de", text: "STRA\u1e9eE@x.de", hit: true },
    { asked: "stra\u00dfe@x.de", text: "STRASSE@x.de", hit: false },
    { asked: "\u03c9hm@x.test", text: "\u2126hm@x.test", hit: true },
    { asked: "\u03c9hm@x.test", text: "\u03a9hm@x.test", hit: true },
    { asked: "kelvin@x.test", text: "\u212aelvin@x.test", hit: true },
    { asked: "kelvin@x.test", text: "KELVIN@X.TEST", hit: true },
    { asked: "\u017fam@x.test", text: "SAM@x.test", hit: false },
    { asked: "sam@x.test", text: "\u017fam@x.test", hit: false },
    // A combining mark or a letter next to the address is no boundary: it is a longer address.
    { asked: "bob@x.test", text: "jose\u0301bob@x.test", hit: false },
    { asked: "bob@x.test", text: "bob@x.test\u0301", hit: false },
    { asked: "bob@x.test", text: "\u212abob@x.test", hit: false },
    { asked: "bob@x.test", text: "\u00e9 bob@x.test", hit: true },
    { asked: "bob@x.test", text: "\u0301bob@x.test", hit: false },
    { asked: "bob@x.test", text: "bob@x.test\u20d0", hit: false },
  ];

  test("named cases: dotless i, sharp s, Ohm, Kelvin, long s and the boundary marks, in the text form", async () => {
    const wrong: string[] = [];
    for (const row of NAMED) {
      const hit = (
        await sql<{
          hit: boolean;
        }>`select ${matchesAddress(sql`${`write to ${row.text} today`}::text`, addressRegex(row.asked))} as hit`.execute(
          db
        )
      ).rows[0]?.hit;
      if (hit !== row.hit) wrong.push(`${hex(row.asked)} vs ${hex(row.text)}: ${hit}`);
    }
    expect(wrong).toEqual([]);
  });

  test("named cases: the same rows in a jsonb value", async () => {
    const wrong: string[] = [];
    for (const row of NAMED) {
      const document = JSON.stringify({ to: `write to ${row.text} today` });
      const hit = (
        await sql<{
          hit: boolean;
        }>`select ${matchesAddress(sql`${document}::jsonb::text`, addressRegex(row.asked, { json: true }))} as hit`.execute(
          db
        )
      ).rows[0]?.hit;
      if (hit !== row.hit) wrong.push(`${hex(row.asked)} vs ${hex(row.text)}: ${hit}`);
    }
    expect(wrong).toEqual([]);
  });

  // Every letter that has another case form, with the forms of the next letter beside it: the text match gives the same
  // answer as the equality match for each form. A code point that the database lowers unlike Bun (the known 28 letters
  // of the image `postgres:17`) is left out: the run-time check, not the pattern, handles it.
  test("every case form of every cased letter: the same answer as the equality match", async () => {
    const divergent = new Set((await divergentCodePoints(db)).map(({ cp }) => cp));
    const targets = [...new Set(addressCasedCodePoints().map((cp) => normalizeSenderAddress(String.fromCodePoint(cp))))]
      .filter((target) => [...target].length === 1 && !divergent.has(target.codePointAt(0) as number))
      .sort();
    expect(targets.length).toBeGreaterThan(1400);
    const mismatches: string[] = [];
    let hits = 0;
    for (const [index, target] of targets.entries()) {
      const next = targets[(index + 1) % targets.length] as string;
      const texts = [...addressCaseForms(target), ...addressCaseForms(next)]
        .filter((form) => [...form].every((char) => !divergent.has(char.codePointAt(0) as number)))
        .map((form) => `${form}@x.test`);
      const asked = `${target}@x.test`;
      const result = await sql<{ n: string; hit: boolean; equal: boolean }>`
        select t.n::text as n,
          ${matchesAddress(sql`'write to ' || t.p || ' today'`, addressRegex(asked))} as hit,
          ${normalizedAddress("t.p")} = ${asked} as equal
        from unnest(${texts}::text[]) with ordinality as t(p, n)
      `.execute(db);
      for (const row of result.rows) {
        if (row.hit) hits++;
        if (row.hit !== row.equal) mismatches.push(`${hex(asked)} vs ${hex(texts[Number(row.n) - 1] as string)}`);
      }
    }
    expect(mismatches).toEqual([]);
    expect(hits).toBeGreaterThan(targets.length);
  });

  // A letter or a combining mark next to the address makes it a longer address: no boundary, in front or behind, for every
  // code point that has a case form, whatever the database calls a letter.
  test("no cased code point and no combining mark next to the address is a boundary", async () => {
    const marks = [0x0300, 0x036f, 0x1ab0, 0x1aff, 0x1dc0, 0x1dff, 0x20d0, 0x20ff, 0xfe20, 0xfe2f];
    const points = [...new Set([...addressCasedCodePoints(), ...marks])];
    const texts = points.flatMap((cp) => [
      `${String.fromCodePoint(cp)}bob@x.test`,
      `bob@x.test${String.fromCodePoint(cp)}`,
    ]);
    const result = await sql<{ p: string; hit: boolean }>`
      select t.p, ${matchesAddress(sql`t.p`, addressRegex("bob@x.test"))} as hit from unnest(${texts}::text[]) as t(p)
    `.execute(db);
    expect(result.rows).toHaveLength(texts.length);
    expect(result.rows.filter((row) => row.hit).map((row) => hex(row.p))).toEqual([]);
  });
});
