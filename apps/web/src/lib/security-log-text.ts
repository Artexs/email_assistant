import { securityEventKinds, type SecurityLogEntry } from "@ea/core/web";

import { dateLocale, t, type TextKey } from "../i18n";

const kinds: readonly string[] = securityEventKinds;

// A kind that this build does not know reads as "other", so an older web build never breaks on a new kind.
export function securityKindText(kind: string): string {
  return kinds.includes(kind) ? t(`sec_kind_${kind}` as TextKey) : t("sec_kind_other");
}

export function securityActorText(actor: SecurityLogEntry["actor"]): string {
  switch (actor.kind) {
    case "member":
      return actor.name;
    case "former_member":
      return t("sec_actor_former");
    case "operator":
      return t("sec_actor_operator");
    case "system":
      return t("sec_actor_system");
  }
}

// The line holds the date and time in the organization's time zone, so it matches the digest times.
export function securityLineText(entry: SecurityLogEntry, timeZone: string): string {
  const when = new Intl.DateTimeFormat(dateLocale(), { timeZone, dateStyle: "medium", timeStyle: "short" }).format(
    new Date(entry.at)
  );
  const line = t("sec_line", { when, what: securityKindText(entry.kind), who: securityActorText(entry.actor) });
  if (entry.lockedUntil === null) return line;
  const time = new Intl.DateTimeFormat(dateLocale(), { timeZone, timeStyle: "short" }).format(
    new Date(entry.lockedUntil)
  );
  return `${line} ${t("sec_locked_until", { time })}`;
}
