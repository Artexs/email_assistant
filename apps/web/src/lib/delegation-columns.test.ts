import { compile } from "@tailwindcss/node";
import { delegationStatuses, type DelegationItem } from "@ea/core/web";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { en } from "../i18n/en";
import { pl } from "../i18n/pl";
import {
  COLUMN_LOOK,
  DELEGATION_COLUMNS,
  DELEGATION_GROUP_OF,
  GROUP_FEED,
  focusAfterReload,
  placeRows,
  type DelegationGroup,
} from "./delegation-columns";
import type { DelegationStatus } from "./delegations-view";

const stylesDir = join(import.meta.dir, "../styles");

const row = (id: string, status: DelegationStatus): DelegationItem => ({
  kind: "delegation",
  id,
  status,
  delegate: { id: "0190f5a0-0000-7000-8000-0000000000d1", name: "Anna", email: "anna@example.com", active: true },
  task: null,
  subject: null,
  dueAt: null,
  sentAt: null,
  answeredAt: null,
  remindersSent: 0,
  reminderWaiting: false,
  sendId: null,
});

const ids = (items: readonly DelegationItem[]) => items.map((x) => x.id);

describe("DELEGATION_GROUP_OF", () => {
  test("has one group for each value of the status enum", () => {
    expect(Object.keys(DELEGATION_GROUP_OF).sort()).toEqual([...delegationStatuses].sort());
  });

  // The filter that the server answers each status with: open holds drafted and sent, closed holds done and cancelled.
  test.each([
    ["drafted", "open"],
    ["sent", "open"],
    ["overdue", "overdue"],
    ["answered", "answered"],
    ["done", "closed"],
    ["cancelled", "closed"],
  ] as const)("the feed of %s is %s", (status, filter) => {
    expect(GROUP_FEED[DELEGATION_GROUP_OF[status]]).toBe(filter);
  });
});

describe("placeRows", () => {
  test("splits the open feed by status and keeps the server order", () => {
    const groups = placeRows({ open: [row("d1", "drafted"), row("s1", "sent"), row("d2", "drafted")] });
    expect(ids(groups.drafted)).toEqual(["d1", "d2"]);
    expect(ids(groups.sent)).toEqual(["s1"]);
    expect([groups.overdue, groups.answered, groups.closed]).toEqual([[], [], []]);
  });

  test("places a row that two feeds hold once, in the first group of the page order", () => {
    const groups = placeRows({ overdue: [row("x", "overdue")], open: [row("x", "sent")] });
    expect(ids(groups.overdue)).toEqual(["x"]);
    expect(groups.sent).toEqual([]);
  });

  test("puts done and cancelled rows in the closed group", () => {
    const groups = placeRows({ closed: [row("a", "done"), row("b", "cancelled")] });
    expect(ids(groups.closed)).toEqual(["a", "b"]);
  });
});

describe("focusAfterReload", () => {
  const groups = (): Record<DelegationGroup, DelegationItem[]> => ({
    overdue: [],
    drafted: [],
    sent: [row("y", "sent")],
    answered: [row("x", "answered")],
    closed: [],
  });

  test.each([
    ["x", "row"],
    ["gone", "status"],
    [null, null],
  ] as const)("a focus on %p gives %p", (focused, expected) => {
    expect(focusAfterReload(focused, groups())).toBe(expected);
  });
});

describe("COLUMN_LOOK", () => {
  test("has a row for each column of the page", () => {
    expect(Object.keys(COLUMN_LOOK).sort()).toEqual([...DELEGATION_COLUMNS].sort());
  });

  test("every title and empty line has an en and a pl text", () => {
    const keys = Object.values(COLUMN_LOOK).flatMap((look) => [look.title, look.empty]);
    expect(keys).toHaveLength(DELEGATION_COLUMNS.length * 2);
    expect(keys.filter((key) => !en[key] || !pl[key])).toEqual([]);
  });

  test("every tone is a class of the built CSS", async () => {
    const compiler = await compile(readFileSync(join(stylesDir, "global.css"), "utf8"), {
      base: stylesDir,
      onDependency: () => undefined,
    });
    const tones = Object.values(COLUMN_LOOK).map((look) => look.tone);
    const built = compiler.build(tones);
    expect(tones.filter((tone) => !built.includes(`.${tone}`))).toEqual([]);
  });
});
