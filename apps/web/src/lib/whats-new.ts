// "What is new" card rules (F112 stage 14, plan P9). Pure: the panel UI (stage 15) reads and writes the storage.
import { type ChangelogRelease, compareSemver } from "@ea/core";

/** At most this many releases show in the card. */
export const WHATS_NEW_MAX = 5;

type SeenReader = Pick<Storage, "getItem">;
type SeenWriter = Pick<Storage, "setItem">;

function isVersion(value: string): boolean {
  try {
    compareSemver(value, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Which releases the card shows for a stored "seen" version.
 * - No stored version, or one that is not `x.y.z`: the newest release only.
 * - A stored version older than the newest release: every newer release, newest first.
 * - A stored version equal to or newer than the newest release: nothing.
 * `Unreleased` is ignored. A release with no "For users" item never shows. At most 5 show.
 * `newest` is the highest released version (also when it has no item), or null.
 */
export function whatsNew(
  releases: readonly ChangelogRelease[],
  stored: string | null
): { show: ChangelogRelease[]; newest: string | null } {
  const released = releases
    .filter((release) => isVersion(release.version)) // `Unreleased` is no `x.y.z`: it drops out here
    .toSorted((a, b) => compareSemver(b.version, a.version));
  const top = released[0];
  if (top === undefined) return { show: [], newest: null };
  const newest = top.version;
  const seen = stored !== null && isVersion(stored) ? stored : null;
  const candidates = seen === null ? [top] : released.filter((release) => compareSemver(release.version, seen) > 0);
  const show = candidates.filter((release) => release.forUsers.length > 0).slice(0, WHATS_NEW_MAX);
  return { show, newest };
}

/** The storage key of one member: two members in one browser each see the card. */
export function whatsNewKey(userId: string): string {
  return `ea.whatsNewSeen:${userId}`;
}

/** The stored version (not checked), `null` when none, `"unavailable"` when the storage throws. */
export function readSeen(storage: SeenReader, userId: string): string | null | "unavailable" {
  try {
    return storage.getItem(whatsNewKey(userId));
  } catch {
    return "unavailable";
  }
}

/** `false` when the storage throws. */
export function writeSeen(storage: SeenWriter, userId: string, version: string): boolean {
  try {
    storage.setItem(whatsNewKey(userId), version);
    return true;
  } catch {
    return false;
  }
}
