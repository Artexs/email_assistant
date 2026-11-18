// The screenshots of the docs (plan P5, D9, ADR 0030 point 4): CI makes them from the e2e seed (`bun run docs:shots`), nobody adds one by hand.
// A page names a screenshot with `<Shot page="settings" />` (`components/Shot.astro`); this file holds the list and the build rules.
// The panel text of the alt strings is plain: it states what the page of the panel is for, never behaviour behind a default-off flag (plan P2).
import { existsSync } from "node:fs";
import { join } from "node:path";

import { DOCS_BASE } from "@ea/core";

export type ShotLocale = "en" | "pl";
export type ShotViewport = "desktop" | "phone";

export interface ShotEntry {
  // `<page>-<locale>-<viewport>`: also the file name `<name>.png`.
  name: string;
  // A panel path.
  path: string;
  locale: ShotLocale;
  viewport: ShotViewport;
  alt: string;
}

export const SHOT_PAGES = ["onboarding", "mailboxes", "settings", "rules", "activity"] as const;
export type ShotPage = (typeof SHOT_PAGES)[number];

export const SHOT_LOCALES: readonly ShotLocale[] = ["en", "pl"];
export const SHOT_VIEWPORTS: readonly ShotViewport[] = ["desktop", "phone"];

// The desktop size of the shot run, and the file size below which a PNG is no screenshot (an empty page is a few KB).
export const SHOT_DESKTOP_SIZE = { width: 1280, height: 800 } as const;
export const SHOT_MIN_BYTES = 10 * 1024;
// The phone width of the page layout: a narrow screen takes the phone shot (`<picture>` source).
export const SHOT_PHONE_MEDIA = "(max-width: 600px)";

const ALT: Record<ShotPage, { path: string; en: string; pl: string }> = {
  onboarding: {
    path: "/onboarding",
    en: "The Onboarding page of the panel, with the first steps to set up the assistant.",
    pl: "Strona Pierwsze kroki w panelu, z pierwszymi krokami konfiguracji asystenta.",
  },
  mailboxes: {
    path: "/mailboxes",
    en: "The Mailboxes page of the panel, with the connected mailboxes and the form to connect one.",
    pl: "Strona Skrzynki w panelu, z podłączonymi skrzynkami i formularzem podłączenia.",
  },
  settings: {
    path: "/settings",
    en: "The Settings page of the panel, with the cards for the mailbox, the digest and the account.",
    pl: "Strona Ustawienia w panelu, z kartami skrzynki, podsumowania i konta.",
  },
  rules: {
    path: "/rules",
    en: "The Rules page of the panel, with the sender rules that sort mail.",
    pl: "Strona Reguły w panelu, z regułami nadawców, które sortują pocztę.",
  },
  activity: {
    path: "/activity",
    en: "The Activity page of the panel, with the list of mails that the assistant handled.",
    pl: "Strona Aktywność w panelu, z listą wiadomości, którymi zajął się asystent.",
  },
};

export const SHOTS: readonly ShotEntry[] = SHOT_PAGES.flatMap((page) =>
  SHOT_LOCALES.flatMap((locale) =>
    SHOT_VIEWPORTS.map((viewport) => ({
      name: `${page}-${locale}-${viewport}`,
      path: ALT[page].path,
      locale,
      viewport,
      alt: ALT[page][locale],
    }))
  )
);

export const SHOT_NAME_PATTERN = /^[a-z]+-(en|pl)-(desktop|phone)$/;

export function isShotPage(page: string): page is ShotPage {
  return (SHOT_PAGES as readonly string[]).includes(page);
}

// The language of a page: `pl` reads Polish, every other value (`root`, `en`, undefined) reads English (as `uiText`).
export function shotLocale(currentLocale: string | undefined): ShotLocale {
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
  options: { on: boolean; exists: (name: string) => boolean }
): ShotView {
  if (!isShotPage(page)) throw new Error(`shot_unknown_page ${page}`);
  const locale = shotLocale(currentLocale);
  const desktop = SHOTS.find((shot) => shot.name === `${page}-${locale}-desktop`);
  const phone = SHOTS.find((shot) => shot.name === `${page}-${locale}-phone`);
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
