import type { TextKey } from "../../src/i18n/en";

// Who signs in for a row. `public` has no session; every other name is an organization of the e2e seed (`apps/server/src/scripts/e2e-seed`):
// `main` is the owner of the main organization (no flag, no mailbox); each other state is an organization with the flags its page needs.
export const SHEET_STATES = [
  "public",
  "main",
  "trial",
  "paused",
  "stats",
  "approvals",
  "delegates",
  "delegations",
  "loops",
  "review",
  "replyStyle",
  "urgency",
  "trust",
  "newsletters",
  "replyPanel",
] as const;

export type SheetState = (typeof SHEET_STATES)[number];

export interface SheetRoute {
  // The file name stem of the pictures and the value of `UI_SHEET_ROUTES`. Unique over the table.
  name: string;
  // The URL path. `{waitingSendId}`-style placeholders are filled from the seed of the state (`resolveSheetPath`).
  path: string;
  state: SheetState;
  // The key of the heading the shot waits for (in the language of the shot). `null`: a static page whose language does not follow the shot.
  ready: TextKey | null;
  // The key of a button to click before the shot, so the picture shows its dialog. `null`: the page as it is.
  open: TextKey | null;
}

function row(
  name: string,
  state: SheetState,
  path: string,
  ready: TextKey | null,
  open: TextKey | null = null
): SheetRoute {
  return { name, path, state, ready, open };
}

const LEGAL_DOCS = ["privacy", "terms", "dpa"] as const;

export const SHEET_ROUTES: readonly SheetRoute[] = [
  // No session.
  row("login", "public", "/login", "title_login"),
  row("setup", "public", "/setup", "title_setup"),
  row("forgot", "public", "/forgot", "title_forgot"),
  ...(["en", "pl"] as const).flatMap((lang) =>
    LEGAL_DOCS.map((doc) => row(`legal-${lang}-${doc}`, "public", `/legal/${lang}/${doc}`, null))
  ),
  row("not-found", "public", "/404.html", null),
  row("offline", "public", "/offline.html", null),

  // The main organization: no flag, no mailbox. The pages of a flag show their "off" text here.
  row("onboarding", "main", "/onboarding", "title_onboarding"),
  row("mailboxes-empty", "main", "/mailboxes", "title_mailboxes"),
  row("mailboxes-connect", "main", "/mailboxes", "title_mailboxes", "mb_connect"),
  row("settings", "main", "/settings", "title_settings"),
  row("rules", "main", "/rules", "title_rules"),
  row("activity-empty", "main", "/activity", "title_activity"),
  row("approvals-off", "main", "/approvals", "title_approvals"),
  row("delegates-off", "main", "/delegates", "title_delegates"),
  row("delegations-off", "main", "/delegations", "title_delegations"),
  row("stats-off", "main", "/stats", "title_stats"),
  row("review-off", "main", "/review", "title_review"),
  row("report-off", "main", "/report", "title_report"),

  // An organization on a trial, and one that is paused.
  row("settings-trial", "trial", "/settings", "title_settings"),
  row("mailboxes-paused", "paused", "/mailboxes", "title_mailboxes"),
  row("settings-paused", "paused", "/settings", "title_settings"),

  row("stats", "stats", "/stats", "title_stats"),

  row("approvals", "approvals", "/approvals", "title_approvals"),
  row("approval-detail", "approvals", "/approvals?id={waitingSendId}", "title_approvals"),
  row("approval-edit", "approvals", "/approvals?id={waitingSendId}", "title_approvals", "appr_edit"),
  row("activity", "approvals", "/activity", "title_activity"),

  row("delegates", "delegates", "/delegates", "title_delegates"),
  row("delegations", "delegations", "/delegations", "title_delegations"),
  row("open-loops", "loops", "/delegations", "title_open_loops"),

  row("review", "review", "/review", "title_review"),
  row("settings-review", "review", "/settings", "title_settings"),

  row("settings-reply-style", "replyStyle", "/settings", "title_settings"),
  row("mailboxes-reply-style", "replyStyle", "/mailboxes", "title_mailboxes"),
  row("rules-urgency", "urgency", "/rules", "title_rules"),
  row("settings-trust", "trust", "/settings", "title_settings"),
  row("report", "trust", "/report", "title_report"),
  row("rules-newsletters", "newsletters", "/rules", "title_rules"),
  row("approval-reply-panel", "replyPanel", "/approvals?id={gapSendId}", "title_approvals"),
];

// A page file that has no row. The reason is the text of the problem report.
export const SHEET_SKIP: Readonly<Record<string, string>> = {
  "/": "the server redirects the home path to the home page of the user",
  "/operator": "the e2e server has no operator user",
};

// The URL path of a page file under `src/pages`: `activity.astro` is `/activity`, `legal/[lang]/[doc].astro` is `/legal`.
function pagePath(file: string): string {
  const stem = file
    .replace(/^.*\/pages\//, "")
    .replace(/\.astro$/, "")
    .replace(/\.html$/, "");
  const fixed = stem.split("/").filter((part) => !part.startsWith("["));
  const path = `/${fixed.join("/")}`;
  return path === "/index" ? "/" : path;
}

function rowPath(route: SheetRoute): string {
  const bare = route.path.split("?")[0].replace(/\.html$/, "");
  return bare;
}

// One line for each page file with no row and no skip entry: `no sheet row: /new`.
export function sheetRowProblems(
  files: readonly string[],
  routes: readonly SheetRoute[] = SHEET_ROUTES,
  skip: Readonly<Record<string, string>> = SHEET_SKIP
): string[] {
  const covered = routes.map(rowPath);
  return files
    .map(pagePath)
    .filter((path) => !(path in skip) && !covered.some((row) => row === path || row.startsWith(`${path}/`)))
    .map((path) => `no sheet row: ${path}`);
}

// The names that appear twice in the table.
export function duplicateSheetNames(routes: readonly SheetRoute[] = SHEET_ROUTES): string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const route of routes) {
    if (seen.has(route.name)) twice.add(route.name);
    seen.add(route.name);
  }
  return [...twice];
}

// Fills `{name}` placeholders of a path from the ids of the seed. A missing id throws: the shot must not open a wrong page.
export function resolveSheetPath(path: string, ids: Readonly<Record<string, string>>): string {
  return path.replace(/\{(\w+)\}/g, (_, key: string) => {
    const id = ids[key];
    if (id === undefined) throw new Error(`sheet_path_id_missing ${key}`);
    return id;
  });
}
