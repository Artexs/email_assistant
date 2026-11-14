import { afterEach, describe, expect, test } from "bun:test";
import { securityEventKinds, type SecurityLogEntry } from "@ea/core/web";

import { en } from "../i18n/en";
import { setLocaleForTest, t } from "../i18n";
import { securityActorText, securityKindText, securityLineText } from "./security-log-text";

afterEach(() => setLocaleForTest("en"));

const timeZone = "Europe/Warsaw";

describe("security log text", () => {
  test("every event kind has an English text", () => {
    for (const kind of securityEventKinds) expect(Object.keys(en)).toContain(`sec_kind_${kind}`);
  });

  test("an unknown kind reads as other", () => {
    expect(securityKindText("future_kind")).toBe(t("sec_kind_other"));
    expect(securityKindText("sign_in")).toBe(t("sec_kind_sign_in"));
  });

  test("each actor kind has its text", () => {
    expect(securityActorText({ kind: "member", name: "Ala" })).toBe("Ala");
    expect(securityActorText({ kind: "former_member" })).toBe(t("sec_actor_former"));
    expect(securityActorText({ kind: "operator" })).toBe(t("sec_actor_operator"));
    expect(securityActorText({ kind: "system" })).toBe(t("sec_actor_system"));
  });

  test("a locked line shows the unlock time in the organization time zone", () => {
    const entry: SecurityLogEntry = {
      at: "2026-11-20T08:00:00Z",
      kind: "locked",
      actor: { kind: "member", name: "Ala" },
      lockedUntil: "2026-11-20T08:15:00Z",
    };
    const line = securityLineText(entry, timeZone);
    expect(line).toContain("09:15");
    expect(line).toContain(t("sec_kind_locked"));
    expect(line).toContain("Ala");
  });

  test("a line without a lock has no unlock part", () => {
    const entry: SecurityLogEntry = {
      at: "2026-11-20T08:00:00Z",
      kind: "sign_in",
      actor: { kind: "system" },
      lockedUntil: null,
    };
    expect(securityLineText(entry, timeZone)).not.toContain("(");
  });
});
