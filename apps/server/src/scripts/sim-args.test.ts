import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseSimArgs, usage } from "./sim-args";

describe("parseSimArgs", () => {
  test("an unknown flag is a usage error", () => {
    expect(() => parseSimArgs(["--no-such-flag"])).toThrow(UsageError);
    expect(() => parseSimArgs(["plan", "lab-01", "--no-such-flag"])).toThrow(UsageError);
  });

  test("plan and status", () => {
    expect(parseSimArgs(["plan", "lab-01"])).toEqual({ kind: "plan", scenario: "lab-01", force: false });
    expect(parseSimArgs(["plan", "lab-01", "--force", "--root", "/tmp/x"])).toEqual({
      kind: "plan",
      scenario: "lab-01",
      root: "/tmp/x",
      force: true,
    });
    expect(parseSimArgs(["status", "lab-01"])).toEqual({ kind: "status", scenario: "lab-01" });
  });

  test("4 an unknown command, a missing scenario or a missing --root value gives undefined", () => {
    expect(() => parseSimArgs(["frobnicate", "lab-01"])).toThrow(UsageError);
    expect(() => parseSimArgs([])).toThrow(UsageError);
    expect(() => parseSimArgs(["plan"])).toThrow(UsageError);
    expect(() => parseSimArgs(["plan", "lab-01", "--root"])).toThrow(UsageError);
    expect(() => parseSimArgs(["plan", "lab-01", "--root", ""])).toThrow(UsageError);
    expect(usage).toContain("bun run sim plan");
  });

  test("a scenario id is a plain folder name", () => {
    expect(() => parseSimArgs(["status", "../etc"])).toThrow(UsageError);
    expect(() => parseSimArgs(["status", "Lab_01"])).toThrow(UsageError);
  });

  test("brief, label-import and the range commands", () => {
    expect(parseSimArgs(["brief", "lab-01", "--part", "dev", "--batch", "003"])).toEqual({
      kind: "brief",
      scenario: "lab-01",
      part: "dev",
      batch: 3,
    });
    expect(parseSimArgs(["check", "lab-01"])).toEqual({ kind: "check", scenario: "lab-01" });
    expect(parseSimArgs(["check", "lab-01", "--part", "week", "--batches", "001-004"])).toEqual({
      kind: "check",
      scenario: "lab-01",
      part: "week",
      range: { from: 1, to: 4 },
    });
    expect(parseSimArgs(["stale", "lab-01", "--part", "dev", "--batches", "2-2"])).toMatchObject({
      kind: "stale",
      range: { from: 2, to: 2 },
    });
    expect(
      parseSimArgs([
        "label-import",
        "lab-01",
        "--part",
        "dev",
        "--batch",
        "1",
        "--checker",
        "claude-haiku-5-5",
        "--file",
        "/tmp/f097-s19/labels-001.json",
      ])
    ).toMatchObject({ kind: "label-import", checker: "claude-haiku-5-5", file: "/tmp/f097-s19/labels-001.json" });
  });

  test("a flag of another command, a bad part or a bad range gives undefined", () => {
    expect(() => parseSimArgs(["plan", "lab-01", "--part", "dev"])).toThrow(UsageError);
    expect(() => parseSimArgs(["brief", "lab-01", "--part", "nope", "--batch", "1"])).toThrow(UsageError);
    expect(() => parseSimArgs(["brief", "lab-01", "--part", "dev"])).toThrow(UsageError);
    expect(() => parseSimArgs(["reconcile", "lab-01", "--part", "dev", "--batches", "3-1"])).toThrow(UsageError);
    expect(() => parseSimArgs(["reconcile", "lab-01", "--part", "dev"])).toThrow(UsageError);
    expect(() => parseSimArgs(["blind-export", "lab-01", "--part", "dev", "--batches", "0-2"])).toThrow(UsageError);
    expect(() => parseSimArgs(["label-import", "lab-01", "--part", "dev", "--batch", "1", "--checker", "m"])).toThrow(
      UsageError
    );
  });

  test("freeze, audit-list and audit-apply need a version and (freeze, apply) a real date", () => {
    expect(parseSimArgs(["freeze", "lab-01", "--version", "1", "--date", "2026-11-14"])).toEqual({
      kind: "freeze",
      scenario: "lab-01",
      version: "1",
      date: "2026-11-14",
      minDev: 50,
      minHoldout: 200,
    });
    expect(
      parseSimArgs([
        "freeze",
        "lab-01",
        "--version",
        "1.1",
        "--date",
        "2026-11-14",
        "--min-dev",
        "5",
        "--min-holdout",
        "20",
      ])
    ).toMatchObject({ version: "1.1", minDev: 5, minHoldout: 20 });
    expect(parseSimArgs(["audit-list", "lab-01", "--version", "1"])).toEqual({
      kind: "audit-list",
      scenario: "lab-01",
      version: "1",
    });
    expect(parseSimArgs(["audit-apply", "lab-01", "--version", "1", "--date", "2026-11-14"])).toMatchObject({
      kind: "audit-apply",
      date: "2026-11-14",
    });
    expect(() => parseSimArgs(["freeze", "lab-01", "--version", "1"])).toThrow(UsageError);
    expect(() => parseSimArgs(["freeze", "lab-01", "--version", "v1", "--date", "2026-11-14"])).toThrow(UsageError);
    expect(() => parseSimArgs(["freeze", "lab-01", "--version", "1", "--date", "2026-13-40"])).toThrow(UsageError);
    expect(() => parseSimArgs(["audit-list", "lab-01", "--version", "1", "--date", "2026-11-14"])).toThrow(UsageError);
    expect(() => parseSimArgs(["audit-apply", "lab-01", "--date", "2026-11-14"])).toThrow(UsageError);
  });

  test("--bank sent selects the sent plan and the sent freeze; incoming commands carry no bank field", () => {
    expect(parseSimArgs(["plan", "lab-01", "--bank", "sent"])).toEqual({
      kind: "plan",
      scenario: "lab-01",
      bank: "sent",
      force: false,
    });
    expect(parseSimArgs(["plan", "lab-01", "--bank", "sent", "--force"])).toMatchObject({ bank: "sent", force: true });
    expect(parseSimArgs(["plan", "lab-01", "--bank", "incoming"])).toEqual({
      kind: "plan",
      scenario: "lab-01",
      force: false,
    });
    expect(parseSimArgs(["plan", "lab-01"])).not.toHaveProperty("bank");
    expect(parseSimArgs(["freeze", "lab-01", "--bank", "sent"])).toEqual({
      kind: "freeze",
      scenario: "lab-01",
      bank: "sent",
      minDev: 49,
      minHoldout: 245,
    });
    expect(
      parseSimArgs([
        "freeze",
        "lab-01",
        "--bank",
        "sent",
        "--date",
        "2026-11-15",
        "--min-dev",
        "3",
        "--min-holdout",
        "9",
      ])
    ).toMatchObject({ date: "2026-11-15", minDev: 3, minHoldout: 9 });
  });

  test("a bad bank value, or --bank on another command, gives undefined", () => {
    expect(() => parseSimArgs(["plan", "lab-01", "--bank", "other"])).toThrow(UsageError);
    expect(() => parseSimArgs(["check", "lab-01", "--bank", "sent"])).toThrow(UsageError);
    expect(() => parseSimArgs(["status", "lab-01", "--bank", "sent"])).toThrow(UsageError);
    // The sent freeze has no version; the incoming flags do not mix in.
    expect(() => parseSimArgs(["freeze", "lab-01", "--bank", "sent", "--version", "1"])).toThrow(UsageError);
    expect(() => parseSimArgs(["freeze", "lab-01", "--bank", "sent", "--part", "sent-dev"])).toThrow(UsageError);
    expect(() => parseSimArgs(["freeze", "lab-01", "--bank", "sent", "--date", "2026-13-40"])).toThrow(UsageError);
    expect(() => parseSimArgs(["freeze", "lab-01", "--bank", "incoming", "--date", "2026-11-14"])).toThrow(UsageError);
  });

  test("a sent part selects the sent form of the commands that take a part", () => {
    expect(parseSimArgs(["brief", "lab-01", "--part", "sent-dev", "--batch", "2"])).toEqual({
      kind: "brief",
      scenario: "lab-01",
      bank: "sent",
      part: "sent-dev",
      batch: 2,
    });
    expect(parseSimArgs(["check", "lab-01", "--part", "sent-holdout", "--batches", "1-10"])).toEqual({
      kind: "check",
      scenario: "lab-01",
      bank: "sent",
      part: "sent-holdout",
      range: { from: 1, to: 10 },
    });
    expect(parseSimArgs(["status", "lab-01", "--part", "sent-dev"])).toMatchObject({ bank: "sent", kind: "status" });
    expect(parseSimArgs(["blind-export", "lab-01", "--part", "sent-dev", "--batches", "1-2"])).toMatchObject({
      bank: "sent",
      kind: "blind-export",
    });
    expect(parseSimArgs(["stale", "lab-01", "--part", "sent-dev", "--batches", "1-2"])).toMatchObject({ bank: "sent" });
    expect(parseSimArgs(["reconcile", "lab-01", "--part", "sent-dev", "--batches", "1-2"])).toMatchObject({
      bank: "sent",
    });
    expect(
      parseSimArgs([
        "label-import",
        "lab-01",
        "--part",
        "sent-dev",
        "--batch",
        "1",
        "--checker",
        "m",
        "--file",
        "/tmp/x.json",
      ])
    ).toMatchObject({ bank: "sent", kind: "label-import", part: "sent-dev" });
    // Incoming parts keep their form and carry no bank field.
    expect(parseSimArgs(["check", "lab-01", "--part", "dev"])).not.toHaveProperty("bank");
    expect(parseSimArgs(["status", "lab-01"])).toEqual({ kind: "status", scenario: "lab-01" });
  });

  test("a sent part with a missing flag, or a part on a command that has none, gives undefined", () => {
    expect(() => parseSimArgs(["brief", "lab-01", "--part", "sent-dev"])).toThrow(UsageError);
    expect(() => parseSimArgs(["reconcile", "lab-01", "--part", "sent-dev"])).toThrow(UsageError);
    expect(() => parseSimArgs(["audit-list", "lab-01", "--part", "sent-dev", "--version", "1"])).toThrow(UsageError);
    expect(() =>
      parseSimArgs(["freeze", "lab-01", "--part", "sent-dev", "--version", "1", "--date", "2026-11-15"])
    ).toThrow(UsageError);
    // A part status is for the sent parts only.
    expect(() => parseSimArgs(["status", "lab-01", "--part", "dev"])).toThrow(UsageError);
    expect(usage).toContain("--bank sent");
  });
});
