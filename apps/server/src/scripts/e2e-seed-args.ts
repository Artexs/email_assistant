import { Client } from "pg";

export const E2E_ORG_NAME = "E2E";
export const E2E_OWNER_EMAIL = "e2e-owner@x.test";
// A test value, not a secret.
export const E2E_OWNER_PASSWORD = "e2e-correct-horse-battery";
export const E2E_PROJECTS = ["mobile", "desktop"] as const;

export type E2eProject = (typeof E2E_PROJECTS)[number];

export const E2E_ASSISTANT_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-assistant-mobile@x.test",
  desktop: "e2e-assistant-desktop@x.test",
};

export const E2E_MEMBER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-member-mobile@x.test",
  desktop: "e2e-member-desktop@x.test",
};

// A test value, not a secret.
export const E2E_MEMBER_PASSWORD = "e2e-member-passphrase-one";

export const E2E_OTHER_ORG_NAME = "E2E Other";
export const E2E_OTHER_OWNER_EMAIL = "e2e-other-owner@x.test";

export const E2E_ACTIVITY_MEMBER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-activity-mobile@x.test",
  desktop: "e2e-activity-desktop@x.test",
};

// The mails of the activity rows (S5d B12). The Playwright runner imports these; this file imports only `pg`.
export const ACTIVITY_SUBJECTS = {
  moved: "E2E moved notification",
  reply: "E2E reply needed",
  unsure: "E2E unsure mail",
  delegated: "E2E delegated task",
} as const;
export const activityFillerSubject = (n: number): string => `E2E filler ${n}`;
export const ACTIVITY_FILLERS = 52;

export interface SeedFile {
  orgId: string;
  owner: { userId: string; email: string; password: string };
  assistants: Record<E2eProject, { userId: string; email: string; setupUrl: string }>;
  members: Record<E2eProject, { userId: string; email: string; password: string }>;
  otherOrg: { orgId: string; emailId: string };
  activityMembers: Record<E2eProject, { userId: string; email: string; password: string }>;
}

// Reads the name the way `pg` does, so the guard and the connection agree. No connection is opened.
export function databaseNameOf(url: string): string | null {
  try {
    const { protocol } = new URL(url);
    if (protocol !== "postgres:" && protocol !== "postgresql:") return null;
    return new Client({ connectionString: url }).database ?? null;
  } catch {
    return null;
  }
}

export function isE2eDatabaseName(name: string | null): boolean {
  return name !== null && /^[A-Za-z0-9_]+_e2e$/.test(name);
}

export function seedTargetOk(
  appUrl: string,
  migratorUrl: string
): { ok: true; database: string } | { ok: false; reason: string } {
  const appName = databaseNameOf(appUrl);
  const migratorName = databaseNameOf(migratorUrl);
  if (!isE2eDatabaseName(appName)) {
    return { ok: false, reason: `DATABASE_URL is not an e2e database (${appName ?? "unparsable"})` };
  }
  if (!isE2eDatabaseName(migratorName)) {
    return { ok: false, reason: `MIGRATOR_DATABASE_URL is not an e2e database (${migratorName ?? "unparsable"})` };
  }
  if (appName !== migratorName) {
    return { ok: false, reason: `the two URLs name different databases (${appName}, ${migratorName})` };
  }
  return { ok: true, database: appName as string };
}

export function seedFilePath(repoRoot: string): string {
  return `${repoRoot}/apps/web/e2e/.seed.json`;
}
