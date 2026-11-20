import { describe, expect, test } from "bun:test";

import type { UserLocale } from "../tenancy";

import {
  renderSloAlert,
  renderTestAlert,
  SLO_TEST_FACTS as TEST_FACTS,
  SLO_TEST_IDS as TEST_IDS,
  type SloTextInput,
} from "./alert-text";
import { SLO_KINDS } from "./kinds";

// The alert text. Plain text, numbers and ids only.
const OPENED = new Date("2026-11-20T10:00:00Z");
const NOW = new Date("2026-11-20T16:05:00Z");
const id = (n: number): string => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

const text = (
  input: Partial<SloTextInput> & Pick<SloTextInput, "kind" | "phase"> & { locale?: UserLocale }
): string => {
  const { locale = "en", ...rest } = input;
  return renderSloAlert({ facts: {}, ids: [], openedAt: OPENED, now: NOW, ...rest }, locale);
};

describe("English", () => {
  test("line 1 of each phase", () => {
    const base = { kind: "slo_disk" as const, facts: TEST_FACTS.slo_disk };
    expect(text({ ...base, phase: "open" }).split("\n")[0]).toBe("ALERT slo_disk");
    expect(text({ ...base, phase: "repeat" }).split("\n")[0]).toBe(
      "STILL OPEN slo_disk (since 2026-11-20T10:00:00.000Z)"
    );
    expect(text({ ...base, phase: "resolved" }).split("\n")[0]).toBe("RESOLVED slo_disk (open 365 min)");
    expect(text({ ...base, phase: "test" }).split("\n")[0]).toBe("TEST slo_disk");
  });

  test("disk: facts in words, then the runbook line", () => {
    expect(text({ kind: "slo_disk", phase: "open", facts: { free_pct: 12.3, free_gb: 1.8 } })).toBe(
      "ALERT slo_disk\nFree 12.3 % (1.8 GB)\nRunbook: docs/known-alerts.md#slo_disk"
    );
  });

  test("sync lag: 2 mailboxes with ids, 1 mailbox in the singular", () => {
    const two = text({
      kind: "slo_sync_lag",
      phase: "open",
      facts: { mailboxes: 2, max_lag_min: 47 },
      ids: [id(1), id(2)],
    });
    expect(two.split("\n")).toEqual([
      "ALERT slo_sync_lag",
      "2 mailboxes, oldest sync 47 min ago",
      `Mailboxes: ${id(1)}, ${id(2)}`,
      "Runbook: docs/known-alerts.md#slo_sync_lag",
    ]);
    expect(text({ kind: "slo_sync_lag", phase: "open", facts: { mailboxes: 1, max_lag_min: 20 } })).toContain(
      "1 mailbox, oldest"
    );
  });

  test("10. seven mailbox ids show five ids and `+2 more`", () => {
    const ids = Array.from({ length: 7 }, (_, index) => id(index + 1));
    const lines = text({ kind: "slo_sync_lag", phase: "repeat", facts: { mailboxes: 7, max_lag_min: 90 }, ids }).split(
      "\n"
    );
    expect(lines[2]).toBe(`Mailboxes: ${ids.slice(0, 5).join(", ")} +2 more`);
    expect(lines[2]).not.toContain(id(6));
  });

  test("the reading holds five ids of a larger set: `+N more` comes from the count in the facts", () => {
    const ids = Array.from({ length: 5 }, (_, index) => id(index + 1));
    const lines = text({ kind: "slo_urgent_latency", phase: "open", facts: { mails: 9, max_wait_min: 30 }, ids }).split(
      "\n"
    );
    expect(lines[2]).toBe(`Mails: ${ids.join(", ")} +4 more`);
  });

  test("a resolved text has no id line", () => {
    const lines = text({
      kind: "slo_sync_lag",
      phase: "resolved",
      facts: { mailboxes: 0, max_lag_min: 0 },
      ids: [id(1)],
    }).split("\n");
    expect(lines).toEqual([
      "RESOLVED slo_sync_lag (open 365 min)",
      "No mailbox is late",
      "Runbook: docs/known-alerts.md#slo_sync_lag",
    ]);
  });

  test("LLM errors with and without a spent quota; backup age in each state", () => {
    expect(
      text({ kind: "slo_llm_errors", phase: "open", facts: { calls: 10, failed: 3, pct: 30, quota_orgs: 0 } })
    ).toContain("3 of 10 LLM calls failed (30.0 %)");
    const quota = text({
      kind: "slo_llm_errors",
      phase: "open",
      facts: { calls: 0, failed: 0, pct: 0, quota_orgs: 1 },
      ids: [id(1)],
    });
    expect(quota).toContain("No LLM calls in the window, 1 organization paused by a spent quota");
    expect(quota).toContain(`Organizations: ${id(1)}`);
    const backup = (facts: Record<string, number>): string =>
      text({ kind: "slo_backup_age", phase: "open", facts }).split("\n")[1] ?? "";
    expect(backup({ age_h: -1, failed: 0, missing: 1 })).toBe("No backup status file");
    expect(backup({ age_h: 30, failed: 0, missing: 0 })).toBe("Last good backup 30 h ago");
    expect(backup({ age_h: 30, failed: 1, missing: 0 })).toBe("Last backup run failed; last good backup 30 h ago");
    expect(backup({ age_h: -1, failed: 1, missing: 0 })).toBe("Last backup run failed; no good backup on record");
  });
});

describe("Polish", () => {
  const pl = (input: Parameters<typeof text>[0]): string => text({ ...input, locale: "pl" });

  test("line 1 of each phase", () => {
    const base = { kind: "slo_disk" as const, facts: TEST_FACTS.slo_disk };
    expect(pl({ ...base, phase: "open" }).split("\n")[0]).toBe("ALARM slo_disk");
    expect(pl({ ...base, phase: "repeat" }).split("\n")[0]).toBe("ALARM TRWA slo_disk (od 2026-11-20T10:00:00.000Z)");
    expect(pl({ ...base, phase: "resolved" }).split("\n")[0]).toBe("ALARM ZAKOŃCZONY slo_disk (trwał 365 min)");
    expect(pl({ ...base, phase: "test" }).split("\n")[0]).toBe("TEST slo_disk");
  });

  test("a Polish decimal comma and the Polish runbook word", () => {
    expect(pl({ kind: "slo_disk", phase: "open", facts: { free_pct: 12.3, free_gb: 1.8 } })).toBe(
      "ALARM slo_disk\nWolne miejsce: 12,3% (1,8 GB)\nInstrukcja: docs/known-alerts.md#slo_disk"
    );
  });

  test("each kind has a Polish facts line with Polish letters and no English word", () => {
    for (const kind of SLO_KINDS) {
      const lines = pl({ kind, phase: "open", facts: TEST_FACTS[kind], ids: TEST_IDS[kind] }).split("\n");
      expect(lines[1]).toMatch(/[a-ząćęłńóśźż]/);
      expect(lines[1]).not.toMatch(/\b(mailbox|mails|oldest|free|failed|calls|last)\b/i);
    }
    expect(
      pl({ kind: "slo_sync_lag", phase: "open", facts: TEST_FACTS.slo_sync_lag, ids: TEST_IDS.slo_sync_lag }).split(
        "\n"
      )
    ).toEqual([
      "ALARM slo_sync_lag",
      "Opóźnione skrzynki: 2; najstarsza synchronizacja sprzed 47 min",
      `Skrzynki: ${TEST_IDS.slo_sync_lag.join(", ")}`,
      "Instrukcja: docs/known-alerts.md#slo_sync_lag",
    ]);
    expect(
      pl({ kind: "slo_sync_lag", phase: "open", facts: { mailboxes: 7, max_lag_min: 5 }, ids: [id(1)] })
    ).toContain("+6 więcej");
  });

  test("backup age in Polish", () => {
    const backup = (facts: Record<string, number>): string =>
      pl({ kind: "slo_backup_age", phase: "open", facts }).split("\n")[1] ?? "";
    expect(backup({ age_h: -1, failed: 0, missing: 1 })).toBe("Brak pliku statusu kopii zapasowej");
    expect(backup({ age_h: 30, failed: 0, missing: 0 })).toBe("Ostatnia udana kopia sprzed 30 h");
    expect(backup({ age_h: 30, failed: 1, missing: 0 })).toBe(
      "Ostatnia kopia nie powiodła się; ostatnia udana kopia sprzed 30 h"
    );
  });
});

describe("what never goes out", () => {
  test("no kind, phase or locale makes a text with an address, a URL or a chat id", () => {
    for (const locale of ["en", "pl"] as UserLocale[]) {
      for (const kind of SLO_KINDS) {
        for (const phase of ["open", "repeat", "resolved", "test"] as const) {
          const out = text({ kind, phase, facts: TEST_FACTS[kind], ids: TEST_IDS[kind], locale });
          expect(out).not.toContain("@");
          expect(out).not.toContain("://");
          expect(out.length).toBeLessThan(600);
        }
      }
    }
  });
});

describe("renderTestAlert", () => {
  const AT = new Date("2026-11-18T10:00:00.000Z");

  test("an event kind gives `TEST <kind>` and the text of its sample event", () => {
    expect(renderTestAlert("send_limit", AT, "en")).toBe(
      "TEST send_limit\nMailbox 00000000-0000-4000-8000-000000000007 of org 00000000-0000-4000-8000-000000000006 hit the send limit mailbox_hour at 2026-11-18T10:00:00.000Z; its sends wait until 2026-11-18T11:00:00.000Z."
    );
  });

  test("the sample of trial_ending ends in three days, in Polish", () => {
    expect(renderTestAlert("trial_ending", AT, "pl")).toBe(
      "TEST trial_ending\nOkres próbny organizacji 00000000-0000-4000-8000-000000000006 kończy się 2026-11-21T10:00:00.000Z."
    );
  });

  test("an incident kind gives its test text", () => {
    expect(renderTestAlert("slo_disk", AT, "en")).toBe(
      renderSloAlert(
        { kind: "slo_disk", phase: "test", facts: TEST_FACTS.slo_disk, ids: [], openedAt: AT, now: AT },
        "en"
      )
    );
  });
});
