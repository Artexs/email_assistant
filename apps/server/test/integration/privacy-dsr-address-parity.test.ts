import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import {
  addressCaseForms,
  addressCasedCodePoints,
  ADDRESS_RULE_PROBES,
  ADDRESS_TRIM_CHARS,
  normalizeSenderAddress,
} from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { divergentCodePoints, normalizedAddress, refreshMailboxProfiles } from "../../src/modules/contacts";
import {
  addressRegex,
  addressRuleConflicts,
  checkAddressRule,
  eraseSubjectData,
  findSubjectData,
  formatRuleCheck,
  matchesAddress,
  normalizeDsrAddress,
} from "../../src/modules/privacy";

import { resetRuleCheckCache } from "../../src/modules/privacy/rule-check";

import { KEY, newOrg, NO_TEST, NOW } from "./contacts-fixtures";
import { seedSenderActivity } from "./fixtures";
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

// The run-time check of the address rule: the divergent code points that matter for the asked address.
describe("the rule check", () => {
  const A7CE = { cp: 0xa7ce, js: "\uA7CF", db: "\uA7CE" };

  test("a divergent code point that is a letter of the address conflicts; another address does not", () => {
    expect(addressRuleConflicts("\uA7CFx@x.test", [A7CE])).toEqual([0xa7ce]);
    expect(addressRuleConflicts("anna@x.test", [A7CE])).toEqual([]);
  });

  test("a database that lowers more than the program conflicts through its form", () => {
    const lowersMore = [{ cp: 0x1e9e, js: "\u1E9E", db: "\u00DF" }];
    expect(addressRuleConflicts("stra\u00DFe@x.de", lowersMore)).toEqual([0x1e9e]);
    expect(addressRuleConflicts("strasse@x.de", lowersMore)).toEqual([]);
  });

  test("a trim difference (empty program form) conflicts with any address", () => {
    const trim = [{ cp: 0x09, js: "", db: "\t" }];
    expect(addressRuleConflicts("anna@x.test", trim)).toEqual([0x09]);
    expect(addressRuleConflicts("\uA7CFx@x.test", trim)).toEqual([0x09]);
  });

  test("formatRuleCheck: the count, then one line per code point; an empty form shows as a dash", () => {
    expect(formatRuleCheck([A7CE])).toEqual(["rule check 1", "U+A7CE js a7cf db a7ce"]);
    expect(formatRuleCheck([])).toEqual(["rule check 0"]);
    expect(
      formatRuleCheck([
        { cp: 0x09, js: "", db: "\t" },
        { cp: 0x49, js: "i\u0307", db: "i" },
      ])
    ).toEqual(["rule check 2", "U+0009 js - db 9", "U+0049 js 69,307 db 69"]);
  });

  test("default check on the test database: a plain address passes; an address with a divergent letter refuses", async () => {
    expect(await checkAddressRule(db, "anna@x.test")).toEqual({ ok: true });
    const divergent = await divergentCodePoints(db);
    const letter = divergent.find(({ js }) => js !== "");
    if (letter === undefined) {
      process.stdout.write("rule check: no divergent letter on this database, the refusal assert is skipped\n");
      return;
    }
    const result = await checkAddressRule(db, `${letter.js}x@x.test`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.codePoints).toContain(letter.cp);
  });
});

// Find and erase call the check first: a refusal changes nothing and writes no audit row.
describe("find and erase with the rule check", () => {
  const orgIds: string[] = [];
  const userIds: string[] = [];
  afterEach(async () => {
    if (orgIds.length > 0) await db.deleteFrom("organizations").where("id", "in", orgIds).execute();
    if (userIds.length > 0) await db.deleteFrom("users").where("id", "in", userIds).execute();
    orgIds.length = 0;
    userIds.length = 0;
  });

  const FAIL = async () => ({ ok: false as const, codePoints: [0xa7ce] });
  const ADDRESS = "anna@x.test";

  // An organization with one mail From `anna@x.test` and its profile row; committed.
  async function seedAnna() {
    const org = await db.transaction().execute(async (trx) => {
      const made = await newOrg(trx);
      await seedSenderActivity(trx, made.ctx, made.mailboxId, { address: ADDRESS, mails: [{ at: NOW }] });
      return made;
    });
    orgIds.push(org.ctx.orgId);
    const owner = await db
      .selectFrom("memberships")
      .select("user_id")
      .where("org_id", "=", org.ctx.orgId)
      .executeTakeFirst();
    if (owner) userIds.push(owner.user_id);
    await refreshMailboxProfiles({ db, credentialsKey: KEY, testMail: NO_TEST }, org.ctx, org.mailboxId, { now: NOW });
    return org;
  }

  const state = async (orgId: string) => ({
    mails: Number(
      (await sql<{ n: string }>`select count(*) as n from emails where org_id = ${orgId}::uuid`.execute(db)).rows[0]?.n
    ),
    profiles: Number(
      (await sql<{ n: string }>`select count(*) as n from sender_profiles where org_id = ${orgId}::uuid`.execute(db))
        .rows[0]?.n
    ),
    tombstones: Number(
      (await sql<{ n: string }>`select count(*) as n from dsr_tombstones where org_id = ${orgId}::uuid`.execute(db))
        .rows[0]?.n
    ),
  });
  const auditCount = async (orgId: string, event: string) =>
    Number(
      (
        await sql<{
          n: string;
        }>`select count(*) as n from audit_log where org_id = ${orgId}::uuid and event = ${event}`.execute(db)
      ).rows[0]?.n
    );

  test("find with a failing check: rule_mismatch, no dsr.find audit row", async () => {
    const org = await seedAnna();
    const result = await findSubjectData(db, {
      orgId: org.ctx.orgId,
      address: ADDRESS,
      credentialsKey: KEY,
      ruleCheck: FAIL,
    });
    expect(result).toEqual({ kind: "rule_mismatch", codePoints: [0xa7ce] });
    expect(await auditCount(org.ctx.orgId, "dsr.find")).toBe(0);
  });

  test("erase with a failing check: rule_mismatch; mail, profile and tombstones stay; no dsr.erase audit row", async () => {
    const org = await seedAnna();
    const before = await state(org.ctx.orgId);
    expect(before.mails).toBeGreaterThan(0);
    expect(before.profiles).toBeGreaterThan(0);
    const result = await eraseSubjectData(db, {
      orgId: org.ctx.orgId,
      address: ADDRESS,
      confirm: ADDRESS,
      credentialsKey: KEY,
      ruleCheck: FAIL,
    });
    expect(result).toEqual({ kind: "rule_mismatch", codePoints: [0xa7ce] });
    expect(await state(org.ctx.orgId)).toEqual(before);
    expect(await auditCount(org.ctx.orgId, "dsr.erase")).toBe(0);
  });

  test("default check, an address with a divergent letter: find and erase refuse and change nothing", async () => {
    const letter = (await divergentCodePoints(db)).find(({ js }) => js !== "");
    if (letter === undefined) {
      process.stdout.write("rule check: no divergent letter on this database, the refusal assert is skipped\n");
      return;
    }
    const org = await seedAnna();
    const before = await state(org.ctx.orgId);
    const address = `${letter.js}x@x.test`;
    const base = { orgId: org.ctx.orgId, address, credentialsKey: KEY };
    const found = await findSubjectData(db, base);
    expect(found.kind).toBe("rule_mismatch");
    const erased = await eraseSubjectData(db, { ...base, confirm: address });
    expect(erased.kind).toBe("rule_mismatch");
    expect(await state(org.ctx.orgId)).toEqual(before);
    expect(await auditCount(org.ctx.orgId, "dsr.find")).toBe(0);
    expect(await auditCount(org.ctx.orgId, "dsr.erase")).toBe(0);
  });

  test("erase with the default check on the same data: erased", async () => {
    const org = await seedAnna();
    const result = await eraseSubjectData(db, {
      orgId: org.ctx.orgId,
      address: ADDRESS,
      confirm: ADDRESS,
      credentialsKey: KEY,
    });
    expect(result.kind).toBe("erased");
    expect(await auditCount(org.ctx.orgId, "dsr.erase")).toBe(1);
  });

  test("the input checks come first: a bad address and a confirm that differs are not rule_mismatch", async () => {
    const org = await seedAnna();
    const base = { orgId: org.ctx.orgId, credentialsKey: KEY, ruleCheck: FAIL };
    expect(await eraseSubjectData(db, { ...base, address: "bad", confirm: "bad" })).toEqual({ kind: "bad_address" });
    expect(await eraseSubjectData(db, { ...base, address: ADDRESS, confirm: "other@x.test" })).toEqual({
      kind: "confirm_mismatch",
    });
    expect(await findSubjectData(db, { ...base, address: "bad" })).toEqual({ kind: "bad_address" });
  });
});

// Order and cache of the check, and the CLI refusal path.
describe("the rule check: order, cache and CLI", () => {
  const FAIL = async () => ({ ok: false as const, codePoints: [0xa7ce] });

  test("an organization that does not exist: erase and find answer rule_mismatch, not not_found", async () => {
    const orgId = randomUUID();
    const erased = await eraseSubjectData(db, {
      orgId,
      address: "anna@x.test",
      confirm: "anna@x.test",
      credentialsKey: KEY,
      ruleCheck: FAIL,
    });
    expect(erased).toEqual({ kind: "rule_mismatch", codePoints: [0xa7ce] });
    const found = await findSubjectData(db, { orgId, address: "anna@x.test", credentialsKey: KEY, ruleCheck: FAIL });
    expect(found).toEqual({ kind: "rule_mismatch", codePoints: [0xa7ce] });
  });

  test("the erase and the find of an unknown organization still answer not_found when the check passes", async () => {
    const orgId = randomUUID();
    const ok = async () => ({ ok: true as const });
    const erased = await eraseSubjectData(db, {
      orgId,
      address: "anna@x.test",
      confirm: "anna@x.test",
      credentialsKey: KEY,
      ruleCheck: ok,
    });
    expect(erased).toEqual({ kind: "not_found" });
    const found = await findSubjectData(db, { orgId, address: "anna@x.test", credentialsKey: KEY, ruleCheck: ok });
    expect(found).toEqual({ kind: "not_found" });
  });

  test("a failed read of the divergent set is not cached; a good read is", async () => {
    // A connection whose executor cannot be taken: the first read of the set fails.
    const broken = new Proxy(db, {
      get(target, property, receiver) {
        if (property === "getExecutor") {
          return () => {
            throw new Error("broken connection");
          };
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    resetRuleCheckCache();
    try {
      await expect(checkAddressRule(broken, "anna@x.test")).rejects.toThrow("broken connection");
      // The failed promise is gone: the next call reads again on a good connection and succeeds.
      expect(await checkAddressRule(db, "anna@x.test")).toEqual({ ok: true });
      // The good read is kept: a broken connection is not used any more.
      expect(await checkAddressRule(broken, "anna@x.test")).toEqual({ ok: true });
    } finally {
      resetRuleCheckCache();
    }
  });

  test("CLI: a refusal exits 1, prints `rule mismatch <n>`, logs org_dsr_refused rule_mismatch and no address", async () => {
    const letter = (await divergentCodePoints(db)).find(({ js }) => js !== "");
    if (letter === undefined) {
      process.stdout.write("rule check: no divergent letter on this database, the CLI refusal test is skipped\n");
      return;
    }
    const local = `${letter.js}zq`;
    const address = `${local}@x.test`;
    const script = resolve(import.meta.dir, "../../src/scripts/org-dsr.ts");
    const run = async (args: string[]) => {
      const proc = Bun.spawn(["bun", script, ...args], {
        cwd: resolve(import.meta.dir, "../../../.."),
        env: { ...process.env, CREDENTIALS_KEY: process.env.CREDENTIALS_KEY ?? KEY },
        stdout: "pipe",
        stderr: "pipe",
      });
      const code = await proc.exited;
      return { code, stdout: await new Response(proc.stdout).text(), stderr: await new Response(proc.stderr).text() };
    };
    const orgId = randomUUID();
    const modes = [["--find"], ["--erase", "--confirm", address]];
    for (const mode of modes) {
      const result = await run(["--org-id", orgId, "--address", address, ...mode]);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("rule mismatch 1\n");
      expect(result.stderr).toContain("org_dsr_refused");
      expect(result.stderr).toContain("reason=rule_mismatch");
      for (const needle of [address, local, "zq", "x.test", String.fromCodePoint(letter.cp), letter.js]) {
        expect(result.stdout + result.stderr).not.toContain(needle);
      }
    }
  });
});
