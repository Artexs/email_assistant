import { type PolicyDecision, actionStatusFor, actionTypes } from "@ea/core";
import { describe, expect, test } from "bun:test";

import {
  ACTION_EDGES,
  ACTION_ENTRIES,
  ACTION_STATUSES,
  LATENT_EDGES,
  PAIR_RULES,
  TERMINAL_STATUSES,
  WRITER_GUARDS,
  nextStatuses,
} from "./transitions";

const DECISIONS = ["apply", "await_approval", "log_only"] as const satisfies readonly PolicyDecision[];

const statusSet: ReadonlySet<string> = new Set(ACTION_STATUSES);
const typeSet: ReadonlySet<string> = new Set(actionTypes);
const terminal: ReadonlySet<string> = new Set(TERMINAL_STATUSES);

// One key per (writer, type, from, to).
const key = (writer: string, type: string, from: string, to: string) => `${writer} ${type}: ${from} -> ${to}`;

function guardKeys(): Set<string> {
  const keys = new Set<string>();
  for (const guard of WRITER_GUARDS) {
    for (const [type, froms] of Object.entries(guard.from)) {
      for (const from of froms ?? []) {
        for (const to of guard.to) {
          keys.add(key(guard.writer, type, from, to));
        }
      }
    }
  }
  return keys;
}

function mapKeys(): Set<string> {
  const keys = new Set<string>();
  for (const edge of [...ACTION_EDGES, ...LATENT_EDGES]) {
    for (const type of edge.types) {
      keys.add(key(edge.writer, type, edge.from, edge.to));
    }
  }
  return keys;
}

describe("transitions map", () => {
  test("(a) every status in an edge, entry, latent edge or guard is a known status", () => {
    const used: string[] = [];
    for (const edge of ACTION_EDGES) used.push(edge.from, edge.to);
    for (const edge of LATENT_EDGES) used.push(edge.from, edge.to);
    for (const entry of ACTION_ENTRIES) used.push(entry.status);
    for (const guard of WRITER_GUARDS) {
      used.push(...guard.to);
      for (const froms of Object.values(guard.from)) used.push(...(froms ?? []));
    }
    expect(used.filter((status) => !statusSet.has(status))).toEqual([]);
    expect(ACTION_STATUSES.length).toBe(10);
  });

  test("(b) no edge leaves a terminal status, and `logged` has no edge", () => {
    const leaving = [...ACTION_EDGES, ...LATENT_EDGES].filter((edge) => terminal.has(edge.from));
    expect(leaving).toEqual([]);
    const guardLeaving = WRITER_GUARDS.filter((guard) =>
      Object.values(guard.from).some((froms) => (froms ?? []).some((from) => terminal.has(from)))
    );
    expect(guardLeaving).toEqual([]);
    const logged = [...ACTION_EDGES, ...LATENT_EDGES].filter((edge) => edge.from === "logged" || edge.to === "logged");
    expect(logged).toEqual([]);
  });

  test("(c) every non-terminal status has an outgoing edge", () => {
    for (const status of ACTION_STATUSES) {
      if (terminal.has(status)) continue;
      const out = ACTION_EDGES.filter((edge) => edge.from === status && edge.from !== edge.to);
      expect({ status, hasEdge: out.length > 0 }).toEqual({ status, hasEdge: true });
    }
  });

  test("(d) every status is reachable from an entry", () => {
    const reached = new Set<string>(ACTION_ENTRIES.map((entry) => entry.status));
    const queue = [...reached];
    while (queue.length > 0) {
      const from = queue.pop();
      for (const edge of ACTION_EDGES) {
        if (edge.from === from && !reached.has(edge.to)) {
          reached.add(edge.to);
          queue.push(edge.to);
        }
      }
    }
    expect(ACTION_STATUSES.filter((status) => !reached.has(status))).toEqual([]);
  });

  test("(e) the statuses of `actionStatusFor` are entry statuses of `createPlanned`", () => {
    const planned = new Set<string>(
      ACTION_ENTRIES.filter((entry) => entry.writer === "createPlanned").map((entry) => entry.status)
    );
    for (const decision of DECISIONS) {
      expect({ decision, ok: planned.has(actionStatusFor(decision)) }).toEqual({ decision, ok: true });
    }
  });

  test("(f) the edges that the guards admit equal the edges plus the latent edges, per writer and type", () => {
    const guards = guardKeys();
    const map = mapKeys();
    expect([...guards].filter((k) => !map.has(k)).sort()).toEqual([]);
    expect([...map].filter((k) => !guards.has(k)).sort()).toEqual([]);
  });

  test("(f) no latent edge repeats an edge that callers use", () => {
    const used = new Set<string>();
    for (const edge of ACTION_EDGES) {
      for (const type of edge.types) used.add(key(edge.writer, type, edge.from, edge.to));
    }
    const repeated: string[] = [];
    for (const edge of LATENT_EDGES) {
      for (const type of edge.types) {
        const k = key(edge.writer, type, edge.from, edge.to);
        if (used.has(k)) repeated.push(k);
      }
    }
    expect(repeated).toEqual([]);
  });

  test("(g) no send edge goes to `ready` (mirror of actions_send_never_ready_check)", () => {
    const bad = [...ACTION_EDGES, ...LATENT_EDGES].filter((edge) => edge.to === "ready" && edge.types.includes("send"));
    expect(bad).toEqual([]);
    expect(nextStatuses("approved", "send")).not.toContain("ready");
    for (const guard of WRITER_GUARDS) {
      if (guard.to.includes("ready")) expect(guard.from.send).toBeUndefined();
    }
    const entries = ACTION_ENTRIES.filter((entry) => entry.status === "ready" && entry.types.includes("send"));
    expect(entries).toEqual([]);
  });

  test("(h) every type in an edge, entry, latent edge or guard is an action type", () => {
    const used: string[] = [];
    for (const edge of [...ACTION_EDGES, ...LATENT_EDGES, ...ACTION_ENTRIES]) used.push(...edge.types);
    for (const guard of WRITER_GUARDS) used.push(...Object.keys(guard.from));
    expect(used.filter((type) => !typeSet.has(type))).toEqual([]);
  });

  test("edge ids are unique and every edge has a caller", () => {
    const ids = ACTION_EDGES.map((edge) => edge.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ACTION_EDGES.filter((edge) => edge.callers.length === 0)).toEqual([]);
  });

  test("a retry edge is written by `releaseAction`", () => {
    for (const edge of ACTION_EDGES) {
      if (edge.retry) expect(edge.writer).toBe("releaseAction");
    }
  });

  test("pair rules P1-P7 each name a test as `<file> › <title>`", () => {
    expect(PAIR_RULES.map((rule) => rule.id)).toEqual(["P1", "P2", "P3", "P4", "P5", "P6", "P7"]);
    for (const rule of PAIR_RULES) {
      expect(rule.test.trim(), rule.id).not.toBe("");
      expect(rule.test.toLowerCase(), rule.id).not.toContain("none");
      // A title can hold `;`, so split only before the next file name.
      for (const part of rule.test.split(/; (?=[\w-]+\.test\.ts › )/)) {
        expect(part, `${rule.id}: ${part}`).toMatch(/^[\w-]+\.test\.ts › \S/);
      }
    }
  });

  test("nextStatuses follows the edges that callers use", () => {
    expect(nextStatuses("awaiting_approval", "send").sort()).toEqual(["approved", "expired", "rejected"]);
    expect(nextStatuses("applied", "move")).toEqual(["undone"]);
    expect(nextStatuses("failed", "send")).toEqual([]);
  });
});
