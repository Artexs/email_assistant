import { afterEach, describe, expect, test } from "bun:test";
import { securityEventKinds, type SecurityLogEntry } from "@ea/core/web";

import { en } from "../i18n/en";
import { pl } from "../i18n/pl";
import { setLocaleForTest, t } from "../i18n";
import { securityActorText, securityKindText, securityEntryParts } from "./security-log-text";

afterEach(() => setLocaleForTest("en"));

const timeZone = "Europe/Warsaw";

describe("security log text", () => {
  test("every event kind has an English text", () => {
    for (const kind of securityEventKinds) expect(Object.keys(en)).toContain(`sec_kind_${kind}`);
  });

  test("every event kind has a Polish text that differs from the English one, with at most one colon", () => {
    const polish: Record<string, string> = pl;
    const english: Record<string, string> = en;
    for (const kind of securityEventKinds) {
      const key = `sec_kind_${kind}`;
      expect(Object.keys(polish)).toContain(key);
      expect(polish[key]).not.toBe(english[key]);
      expect((polish[key] ?? "").split(":").length - 1).toBeLessThanOrEqual(1);
    }
  });

  test("the company sign-in kinds read right in Polish and English", () => {
    const expected = {
      sso_sign_in: ["Signed in with the company account", "Zalogowano kontem firmowym"],
      sso_refused: ["Company sign-in refused", "Odmowa logowania kontem firmowym"],
      sso_provider_set: ["Company sign-in set up or changed", "Ustawiono lub zmieniono logowanie kontem firmowym"],
      sso_provider_removed: ["Company sign-in removed", "Usunięto logowanie kontem firmowym"],
      sso_domain_verified: ["Domain proved by DNS", "Domenę potwierdzono przez DNS"],
      sso_domain_attested: ["Domain attested by the operator", "Domenę potwierdził operator"],
      sso_required_changed: ['Setting "SSO required" changed', "Zmieniono ustawienie „Wymagane SSO”"],
      sso_unlinked: ["Company account unlinked", "Odłączono konto firmowe"],
      member_added: ["Member added", "Dodano członka"],
      member_sessions_ended: ["A member's sessions ended", "Zakończono sesje członka"],
    } as const;
    for (const [kind, [english, polish]] of Object.entries(expected)) {
      setLocaleForTest("en");
      expect(securityKindText(kind)).toBe(english);
      setLocaleForTest("pl");
      expect(securityKindText(kind)).toBe(polish);
    }
    expect(en.sec_help).toContain("company sign-in changes");
    expect(pl.sec_help).toContain("zmiany logowania kontem firmowym");
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

  test("a locked entry shows the unlock time in the organization time zone", () => {
    const entry: SecurityLogEntry = {
      at: "2026-11-20T08:00:00Z",
      kind: "locked",
      actor: { kind: "member", name: "Ala" },
      lockedUntil: "2026-11-20T08:15:00Z",
    };
    expect(securityEntryParts(entry, timeZone)).toEqual({
      when: "20 Nov 2026, 09:00",
      what: t("sec_kind_locked"),
      who: "Ala (locked until 09:15)",
    });
  });

  test("an entry without a lock has no unlock part", () => {
    const entry: SecurityLogEntry = {
      at: "2026-11-20T08:00:00Z",
      kind: "sign_in",
      actor: { kind: "system" },
      lockedUntil: null,
    };
    expect(securityEntryParts(entry, timeZone)).toEqual({
      when: "20 Nov 2026, 09:00",
      what: t("sec_kind_sign_in"),
      who: t("sec_actor_system"),
    });
  });
});
