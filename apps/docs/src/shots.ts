// The screenshots of the docs (ADR 0030 point 4): CI makes them from the e2e seed (`bun run docs:shots`), nobody adds one by hand.
// A page names a screenshot with `<Shot page="settings" />` (`components/Shot.astro`); this file holds the list and the build rules.
// The panel text of the alt strings is plain: it states what the page of the panel is for, never behaviour behind a default-off flag.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { DOCS_BASE, type UserLocale } from "@ea/core";
import { publicContentProblems } from "@ea/core/web";

import { shotSource } from "../../web/e2e/lib/shot-source";

export type ShotViewport = "desktop" | "phone";

export interface ShotEntry {
  // `<page>-<locale>-<viewport>`: also the file name `<name>.png`.
  name: string;
  // A panel path.
  path: string;
  locale: UserLocale;
  viewport: ShotViewport;
  alt: string;
}

export const SHOT_PAGES = ["onboarding", "mailboxes", "settings", "rules", "activity"] as const;
export type ShotPage = (typeof SHOT_PAGES)[number];

export const SHOT_LOCALES: readonly UserLocale[] = ["en", "pl"];
export const SHOT_VIEWPORTS: readonly ShotViewport[] = ["desktop", "phone"];

// The desktop size of the shot run, and the file size below which a PNG is no screenshot (an empty page is a few KB).
export const SHOT_DESKTOP_SIZE = { width: 1280, height: 800 } as const;
export const SHOT_MIN_BYTES = 10 * 1024;
// The phone width of the page layout: a narrow screen takes the phone shot (`<picture>` source).
export const SHOT_PHONE_MEDIA = "(max-width: 600px)";

const E2E_ALT: Record<ShotPage, { path: string; en: string; pl: string }> = {
  onboarding: {
    path: "/onboarding",
    en: "The Onboarding page of the panel, with the steps to connect a mailbox, link Telegram and choose the mode.",
    pl: "Strona Start w panelu, z krokami: podłącz skrzynkę, połącz Telegram i wybierz tryb.",
  },
  mailboxes: {
    path: "/mailboxes",
    en: "The Mailboxes page of the panel, with no mailbox yet, the Connect mailbox button and the Telegram card.",
    pl: "Strona Skrzynki w panelu, jeszcze bez skrzynki, z przyciskiem podłączenia skrzynki i kartą Telegram.",
  },
  settings: {
    path: "/settings",
    en: "The Settings page of the panel, with the digest times and the signature of the assistant's messages.",
    pl: "Strona Ustawienia w panelu, z godzinami podsumowań i podpisem wiadomości asystenta.",
  },
  rules: {
    path: "/rules",
    en: "The Rules page of the panel, with the form to add a sender rule and the rule lists.",
    pl: "Strona Reguły w panelu, z formularzem dodania reguły nadawcy i listami reguł.",
  },
  activity: {
    path: "/activity",
    en: "The Activity page of the panel, with its filters and no mail yet, before a mailbox is connected.",
    pl: "Strona Aktywność w panelu, z filtrami i bez wiadomości, zanim podłączono skrzynkę.",
  },
};

// The demo organization (`DEMO_SEED_FILE`) has one paused mailbox and the triaged mail of the seed: the alt texts say what the
// picture shows, so they differ from the e2e organization's, which has no mailbox and no mail.
const DEMO_ALT: Record<ShotPage, { path: string; en: string; pl: string }> = {
  onboarding: {
    path: "/onboarding",
    en: "The Onboarding page of the panel in a demo organization, with one mailbox connected and the steps to link Telegram and choose the mode.",
    pl: "Strona Start w panelu organizacji demo, z jedną podłączoną skrzynką i krokami: połącz Telegram i wybierz tryb.",
  },
  mailboxes: {
    path: "/mailboxes",
    en: "The Mailboxes page of the panel in a demo organization, with one paused demo mailbox and the Telegram card.",
    pl: "Strona Skrzynki w panelu organizacji demo, z jedną wstrzymaną skrzynką demo i kartą Telegram.",
  },
  settings: {
    path: "/settings",
    en: "The Settings page of the panel in a demo organization, with the digest times and the signature of the assistant's messages.",
    pl: "Strona Ustawienia w panelu organizacji demo, z godzinami podsumowań i podpisem wiadomości asystenta.",
  },
  rules: {
    path: "/rules",
    en: "The Rules page of the panel in a demo organization, with the form to add a sender rule and the rule lists.",
    pl: "Strona Reguły w panelu organizacji demo, z formularzem dodania reguły nadawcy i listami reguł.",
  },
  activity: {
    path: "/activity",
    en: "The Activity page of the panel in a demo organization, with its filters and the demo mail that the assistant sorted.",
    pl: "Strona Aktywność w panelu organizacji demo, z filtrami i pocztą demo, którą asystent posortował.",
  },
};

export type ShotSourceKind = "demo" | "e2e";

function shotsOf(source: ShotSourceKind): readonly ShotEntry[] {
  const table = source === "demo" ? DEMO_ALT : E2E_ALT;
  return SHOT_PAGES.flatMap((page) =>
    SHOT_LOCALES.flatMap((locale) =>
      SHOT_VIEWPORTS.map((viewport) => ({
        name: `${page}-${locale}-${viewport}`,
        path: table[page].path,
        locale,
        viewport,
        alt: table[page][locale],
      }))
    )
  );
}

// The shots of the e2e source. The demo source has the same names and paths, and its own alt texts.
export const SHOTS: readonly ShotEntry[] = shotsOf("e2e");
export const DEMO_SHOTS: readonly ShotEntry[] = shotsOf("demo");

// The source that the build and the shot run use: `shotSource()` of the e2e lib (`DEMO_SEED_FILE`, else the default seed file).
export function shotSourceKind(): ShotSourceKind {
  return shotSource().kind;
}

// Texts of the panel that the public-content check of the shot run (`publicContentProblems`) accepts, each with its reason. The run has no
// other allowance: a mail address of a real-looking domain on a page stops it. `shots.test.ts` checks each text still stands in the panel text.
export const SHOT_TEXT_ALLOW: readonly { text: string; reason: string }[] = [
  {
    text: "anna@firma.pl",
    reason:
      "the example address in the help text of a sender rule (`rules_pattern_help`), a fixed text of the panel, no person",
  },
];

export function isShotPage(page: string): page is ShotPage {
  return (SHOT_PAGES as readonly string[]).includes(page);
}

// The language of a page: `pl` reads Polish, every other value (`root`, `en`, undefined) reads English (as `uiText`).
export function shotLocale(currentLocale: string | undefined): UserLocale {
  return currentLocale === "pl" ? "pl" : "en";
}

// `on`: a missing file fails the build. Any other value (also unset): a box with the alt text.
export function shotsOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.DOCS_SHOTS === "on";
}

export function shotUrl(name: string): string {
  return `${DOCS_BASE}/shots/${name}.png`;
}

// `EA_DOCS_SHOTS_DIR` points the build at another folder (tests only); the integration `ea-shots` sets the real one.
export function shotsDir(env: Record<string, string | undefined> = process.env): string {
  const dir = env.EA_DOCS_SHOTS_DIR;
  if (dir === undefined || dir === "") throw new Error("shots_dir_unset");
  return dir;
}

export interface ShotView {
  kind: "images" | "box";
  desktop: ShotEntry;
  phone: ShotEntry;
}

// What `<Shot page locale />` shows. Throws `shot_unknown_page <page>` for a page that is not in the list (also with the shots off),
// and with the shots on `shot_missing <name>` for the first file that does not exist.
export function shotView(
  page: string,
  currentLocale: string | undefined,
  options: { on: boolean; exists: (name: string) => boolean; source?: ShotSourceKind }
): ShotView {
  const shots = options.source === "demo" ? DEMO_SHOTS : SHOTS;
  const locale = shotLocale(currentLocale);
  // A page that is not in the list has no shot of its name: this is the check, also for names like `toString`.
  const desktop = isShotPage(page) ? shots.find((shot) => shot.name === `${page}-${locale}-desktop`) : undefined;
  const phone = isShotPage(page) ? shots.find((shot) => shot.name === `${page}-${locale}-phone`) : undefined;
  if (desktop === undefined || phone === undefined) throw new Error(`shot_unknown_page ${page}`);
  if (!options.on) return { kind: "box", desktop, phone };
  for (const shot of [desktop, phone]) {
    if (!options.exists(shot.name)) throw new Error(`shot_missing ${shot.name}`);
  }
  return { kind: "images", desktop, phone };
}

export function shotFileExists(name: string, dir: string = shotsDir()): boolean {
  return existsSync(join(dir, `${name}.png`));
}

// The checks of the shot run (`apps/web/e2e/docs-shots/shots.spec.ts`). Each returns the first problem as text, or null.

// The enabled feature list of the organization (`/api/me` `features`) must be empty, so no shot shows a default-off feature.
export function shotFeaturesProblem(features: unknown): string | null {
  if (!Array.isArray(features)) return "shot_features_unknown";
  return features.length === 0 ? null : `shot_features_on ${features.join(",")}`;
}

// The text of a page, before its shot, passes the public-content check (rules R1 to R7) with `SHOT_TEXT_ALLOW` as the allow list.
export function shotTextProblem(text: string, name: string): string | null {
  const [first] = publicContentProblems(
    text,
    SHOT_TEXT_ALLOW.map((entry) => entry.text)
  );
  return first === undefined ? null : `public_content ${first.rule} ${first.match} in shot ${name}`;
}

// The folder holds exactly the PNG files of `SHOTS`, each larger than `SHOT_MIN_BYTES`.
export function shotFilesProblem(dir: string, shots: readonly ShotEntry[] = SHOTS): string | null {
  const files = existsSync(dir) ? readdirSync(dir) : [];
  const wanted = new Set(shots.map((shot) => `${shot.name}.png`));
  const missing = [...wanted].filter((file) => !files.includes(file)).sort();
  if (missing.length > 0) return `shot_files_missing ${missing.join(",")}`;
  const extra = files.filter((file) => !wanted.has(file)).sort();
  if (extra.length > 0) return `shot_files_extra ${extra.join(",")}`;
  const small = [...wanted].sort().find((file) => statSync(join(dir, file)).size <= SHOT_MIN_BYTES);
  return small === undefined ? null : `shot_file_small ${small}`;
}
