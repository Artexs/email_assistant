import { describe, expect, test } from "bun:test";

import { parseOpsAlertsArgs, parseOpsAlertTestArgs } from "./ops-alerts-args";

describe("parseOpsAlertsArgs", () => {
  test("no argument gives 7 days; --days takes 1 to 365", () => {
    expect(parseOpsAlertsArgs([])).toEqual({ days: 7 });
    expect(parseOpsAlertsArgs(["--days", "30"])).toEqual({ days: 30 });
    expect(parseOpsAlertsArgs(["--days", "1"])).toEqual({ days: 1 });
    expect(parseOpsAlertsArgs(["--days", "365"])).toEqual({ days: 365 });
  });

  test("refuses 0, 366, a decimal, a word, a missing value, a stray word and an unknown flag", () => {
    for (const bad of [
      ["--days", "0"],
      ["--days", "366"],
      ["--days", "1.5"],
      ["--days", "x"],
      ["--days"],
      ["7"],
      ["--all"],
    ]) {
      expect(parseOpsAlertsArgs(bad)).toBeNull();
    }
  });
});

describe("parseOpsAlertTestArgs", () => {
  test("--kind takes one kind; --all takes the five", () => {
    expect(parseOpsAlertTestArgs(["--kind", "slo_disk"])).toEqual({ kinds: ["slo_disk"] });
    expect(parseOpsAlertTestArgs(["--all"])?.kinds).toEqual([
      "slo_sync_lag",
      "slo_urgent_latency",
      "slo_llm_errors",
      "slo_disk",
      "slo_backup_age",
    ]);
  });

  test("refuses neither, both, an unknown kind and a stray word", () => {
    for (const bad of [[], ["--all", "--kind", "slo_disk"], ["--kind", "slo_x"], ["--kind"], ["slo_disk"]]) {
      expect(parseOpsAlertTestArgs(bad)).toBeNull();
    }
  });
});
