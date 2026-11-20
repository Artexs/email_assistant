/**
 * Contract check for new migrations (`docs/code-patterns.md`: the contract statement rule). Pure: text in, findings out.
 * A release's migration must work with the code of the previous release (expand/contract).
 * A statement that breaks old code is a finding unless the file has a line `-- contract: v<x.y.z>`.
 */

/** The newest migration timestamp at the base of this check. Files at or before it are not checked. */
export const CONTRACT_CHECK_AFTER = "20261115160001";

export type MigrationRule =
  | "drop_table"
  | "drop_column"
  | "drop_type"
  | "drop_view"
  | "drop_schema"
  | "drop_sequence"
  | "drop_extension"
  | "drop_constraint"
  | "drop_index"
  | "drop_function"
  | "drop_trigger"
  | "drop_policy"
  | "rename"
  | "alter_column_type"
  | "set_not_null"
  | "truncate"
  | "revoke"
  | "add_constraint";

export interface MigrationFinding {
  line: number;
  rule: MigrationRule;
}

const contractLine = /^[ \t]*--[ \t]*contract:[ \t]*v\d+\.\d+\.\d+[ \t]*$/m;
const upMarker = /^[ \t]*--[ \t]*migrate:up\b.*$/m;
const downMarker = /^[ \t]*--[ \t]*migrate:down\b.*$/m;

/** True when the file has a line `-- contract: v<x.y.z>`. */
export function hasContractMark(sql: string): boolean {
  return contractLine.test(sql);
}

/** The text of the `-- migrate:up` part. Other lines become empty, so line numbers stay right. */
export function upPart(sql: string): string {
  const up = upMarker.exec(sql);
  const down = downMarker.exec(sql);
  const start = up ? up.index + up[0].length : 0;
  const end = down && down.index >= start ? down.index : sql.length;
  return `${sql.slice(0, start).replace(/[^\n]/g, "")}${sql.slice(start, end)}`;
}

/**
 * Replaces comments (`--`, block) and single-quoted strings with spaces. Newlines and all offsets stay.
 * A quoted identifier is kept. Dollar-quoted text is kept: a statement inside a function body is read too.
 */
export function blankCommentsAndStrings(sql: string): string {
  const out = sql.split("");
  let index = 0;
  const blank = (from: number, to: number) => {
    for (let at = from; at < to; at += 1) {
      if (out[at] !== "\n") out[at] = " ";
    }
  };
  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];
    if (char === "-" && next === "-") {
      const stop = sql.indexOf("\n", index);
      const end = stop === -1 ? sql.length : stop;
      blank(index, end);
      index = end;
    } else if (char === "/" && next === "*") {
      const stop = sql.indexOf("*/", index + 2);
      const end = stop === -1 ? sql.length : stop + 2;
      blank(index, end);
      index = end;
    } else if (char === "'") {
      let end = index + 1;
      while (end < sql.length && sql[end] !== "'") end += 1;
      end = Math.min(end + 1, sql.length);
      blank(index, end);
      index = end;
    } else if (char === '"') {
      const stop = sql.indexOf('"', index + 1);
      index = stop === -1 ? sql.length : stop + 1;
    } else {
      index += 1;
    }
  }
  return out.join("");
}

interface Piece {
  text: string;
  offset: number;
}

/** Splits at `sep` outside parentheses. */
function splitTopLevel(text: string, offset: number, sep: string): Piece[] {
  const pieces: Piece[] = [];
  let depth = 0;
  let from = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (char === sep && depth === 0) {
      pieces.push({ text: text.slice(from, index), offset: offset + from });
      from = index + 1;
    }
  }
  pieces.push({ text: text.slice(from), offset: offset + from });
  return pieces;
}

const ident = `(?:"[^"]+"|[\\w$]+)`;
const qualified = `${ident}(?:\\s*\\.\\s*${ident})*`;

/** Last part of a possibly qualified name, lower case, without quotes. */
function bareName(name: string): string {
  const parts = name.split(".");
  return (parts[parts.length - 1] ?? "").trim().replace(/^"|"$/g, "").toLowerCase();
}

function namesOf(text: string, pattern: RegExp): Set<string> {
  const names = new Set<string>();
  for (const match of text.matchAll(pattern)) names.add(bareName(match[1] ?? ""));
  return names;
}

interface Created {
  tables: Set<string>;
  constraints: Set<string>;
  indexes: Set<string>;
  functions: Set<string>;
  triggers: Set<string>;
  policies: Set<string>;
}

function createdIn(text: string): Created {
  return {
    tables: namesOf(
      text,
      new RegExp(
        `\\bCREATE\\s+(?:(?:GLOBAL\\s+|LOCAL\\s+)?(?:TEMP(?:ORARY)?\\s+|UNLOGGED\\s+))?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${qualified})`,
        "gi"
      )
    ),
    // `CONSTRAINT x` that is not part of `DROP CONSTRAINT [IF EXISTS] x`.
    constraints: namesOf(text, new RegExp(`(?<!\\bDROP\\s+)\\bCONSTRAINT\\s+(${ident})`, "gi")),
    indexes: namesOf(
      text,
      new RegExp(
        `\\bCREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?(${ident})`,
        "gi"
      )
    ),
    functions: namesOf(
      text,
      new RegExp(`\\bCREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:FUNCTION|PROCEDURE)\\s+(${qualified})`, "gi")
    ),
    triggers: namesOf(
      text,
      new RegExp(`\\bCREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:CONSTRAINT\\s+)?TRIGGER\\s+(${ident})`, "gi")
    ),
    policies: namesOf(text, new RegExp(`\\bCREATE\\s+POLICY\\s+(${ident})`, "gi")),
  };
}

/** Names that the file drops by `DROP CONSTRAINT [IF EXISTS] x`. */
function droppedConstraints(text: string): Set<string> {
  return namesOf(text, new RegExp(`\\bDROP\\s+CONSTRAINT\\s+(?:IF\\s+EXISTS\\s+)?(${ident})`, "gi"));
}

const simpleDrops: { pattern: string; rule: MigrationRule }[] = [
  { pattern: "TABLE", rule: "drop_table" },
  { pattern: "TYPE", rule: "drop_type" },
  { pattern: "(?:MATERIALIZED\\s+)?VIEW", rule: "drop_view" },
  { pattern: "SCHEMA", rule: "drop_schema" },
  { pattern: "SEQUENCE", rule: "drop_sequence" },
  { pattern: "EXTENSION", rule: "drop_extension" },
];

const replaceableDrops: { keyword: string; rule: MigrationRule; created: keyof Created }[] = [
  { keyword: "INDEX", rule: "drop_index", created: "indexes" },
  { keyword: "FUNCTION", rule: "drop_function", created: "functions" },
  { keyword: "PROCEDURE", rule: "drop_function", created: "functions" },
  { keyword: "TRIGGER", rule: "drop_trigger", created: "triggers" },
  { keyword: "POLICY", rule: "drop_policy", created: "policies" },
];

/** Findings for the text of one migration (the `up` part, comments already blanked). */
function scanStatements(text: string): { offset: number; rule: MigrationRule }[] {
  const created = createdIn(text);
  const droppedHere = droppedConstraints(text);
  const found: { offset: number; rule: MigrationRule }[] = [];
  const add = (offset: number, rule: MigrationRule) => found.push({ offset, rule });

  for (const statement of splitTopLevel(text, 0, ";")) {
    const body = statement.text;
    const at = (index: number) => statement.offset + index;

    for (const { pattern, rule } of simpleDrops) {
      for (const match of body.matchAll(new RegExp(`\\bDROP\\s+${pattern}\\b`, "gi"))) add(at(match.index), rule);
    }
    for (const { keyword, rule, created: kind } of replaceableDrops) {
      for (const match of body.matchAll(
        new RegExp(
          `\\bDROP\\s+${keyword}\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+EXISTS\\s+)?(${qualified}(?:\\s*,\\s*${qualified})*)`,
          "gi"
        )
      )) {
        const names = (match[1] ?? "").split(",").map(bareName);
        // Only INDEX lists several names; for the rest the first name is the only one.
        const checked = keyword === "INDEX" ? names : names.slice(0, 1);
        if (checked.some((name) => !created[kind].has(name))) add(at(match.index), rule);
      }
    }
    for (const match of body.matchAll(/\bRENAME\b/gi)) add(at(match.index), "rename");
    for (const match of body.matchAll(/\bTRUNCATE\b/gi)) add(at(match.index), "truncate");
    for (const match of body.matchAll(/\bREVOKE\b/gi)) add(at(match.index), "revoke");
    for (const match of body.matchAll(
      new RegExp(`\\bALTER\\s+(?:COLUMN\\s+)?${ident}\\s+(?:SET\\s+DATA\\s+)?TYPE\\b`, "gi")
    ))
      add(at(match.index), "alter_column_type");
    for (const match of body.matchAll(new RegExp(`\\bALTER\\s+(?:COLUMN\\s+)?${ident}\\s+SET\\s+NOT\\s+NULL\\b`, "gi")))
      add(at(match.index), "set_not_null");

    const alter = new RegExp(
      `^(\\s*ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?(${qualified})\\s*\\*?)`,
      "i"
    ).exec(body);
    if (alter) {
      const table = bareName(alter[2] ?? "");
      const actionsStart = alter[1]?.length ?? 0;
      for (const action of splitTopLevel(body.slice(actionsStart), at(actionsStart), ",")) {
        const lead = /^\s*/.exec(action.text)?.[0].length ?? 0;
        const actionAt = action.offset + lead;
        const trimmed = action.text.trimStart();
        // `DROP [COLUMN] x`: COLUMN is optional in PostgreSQL.
        if (/^DROP\s+(?!CONSTRAINT\b)/i.test(trimmed)) add(actionAt, "drop_column");
        const dropConstraint = new RegExp(`^DROP\\s+CONSTRAINT\\s+(?:IF\\s+EXISTS\\s+)?(${ident})`, "i").exec(trimmed);
        if (dropConstraint && !created.constraints.has(bareName(dropConstraint[1] ?? "")))
          add(actionAt, "drop_constraint");
        const addConstraint = new RegExp(
          `^ADD\\s+(?:CONSTRAINT\\s+(${ident})|(?:CHECK|UNIQUE|PRIMARY\\s+KEY|FOREIGN\\s+KEY|EXCLUDE)\\b)`,
          "i"
        ).exec(trimmed);
        if (addConstraint) {
          const name = addConstraint[1] === undefined ? undefined : bareName(addConstraint[1]);
          // A new table is free; a constraint that the file drops and adds again is a replace.
          const replace = name !== undefined && droppedHere.has(name);
          if (!created.tables.has(table) && !replace) add(actionAt, "add_constraint");
        }
      }
    }
  }
  return found;
}

/** Contract findings of one migration file. Empty when the file has a `-- contract:` mark. */
export function checkMigrationSql(sql: string): MigrationFinding[] {
  if (hasContractMark(sql)) return [];
  const text = blankCommentsAndStrings(upPart(sql));
  const lineOf = (offset: number) => text.slice(0, offset).split("\n").length;
  return scanStatements(text)
    .map(({ offset, rule }) => ({ line: lineOf(offset), rule }))
    .sort((left, right) => left.line - right.line);
}

/** Timestamp prefix of a migration file name, or null when the name has none. */
export function migrationTimestamp(fileName: string): string | null {
  const match = /^(\d{14})_.+\.sql$/.exec(fileName);
  return match?.[1] ?? null;
}
