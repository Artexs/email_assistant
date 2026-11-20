import { describe, expect, test } from "bun:test";

import type { OpsAlertRow } from "../../modules/operator";

import { alertLine } from "./ops-alerts-lines";

const row: OpsAlertRow = {
  id: "1",
  kind: "slo_disk",
  openedAt: new Date("2026-11-20T10:00:00Z"),
  openSentAt: new Date("2026-11-20T10:00:30Z"),
  lastSentAt: new Date("2026-11-20T16:00:30Z"),
  noticeCount: 2,
  resolvedAt: null,
  resolvedSentAt: null,
  facts: { free_pct: 12.3, free_gb: 1.8 },
};

describe("alertLine", () => {
  test("an open incident shows `open`", () => {
    expect(alertLine(row)).toBe("slo_disk opened=2026-11-20T10:00:00.000Z notices=2 open free_pct=12.3 free_gb=1.8");
  });

  test("a resolved incident shows the resolve time; empty facts add nothing", () => {
    const line = alertLine({ ...row, resolvedAt: new Date("2026-11-20T16:05:00Z"), facts: {} });
    expect(line).toBe("slo_disk opened=2026-11-20T10:00:00.000Z notices=2 resolved=2026-11-20T16:05:00.000Z");
  });
});
