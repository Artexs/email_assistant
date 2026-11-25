import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { en } from "@ea/web/i18n/en";
import { pl } from "@ea/web/i18n/pl";

import { flaggedTextProblems } from "./flagged-text";
import {
  isShotPage,
  SHOT_LOCALES,
  SHOT_PAGES,
  SHOT_VIEWPORTS,
  shotFileExists,
  shotFilesProblem,
  shotLocale,
  SHOT_MIN_BYTES,
  SHOT_TEXT_ALLOW,
  DEMO_SHOTS,
  SHOTS,
  shotFeaturesProblem,
  shotsDir,
  shotsOn,
  shotTextProblem,
  shotUrl,
  shotView,
} from "./shots";

const SHOT_NAME_PATTERN = /^[a-z]+-(en|pl)-(desktop|phone)$/;
const ROOT = join(import.meta.dir, "../../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("SHOTS (T1)", () => {
  test("names are unique and match <page>-<locale>-<viewport>", () => {
    const names = SHOTS.map((shot) => shot.name);
    expect(new Set(names).size).toBe(names.length);
    for (const shot of SHOTS) {
      expect(shot.name).toMatch(SHOT_NAME_PATTERN);
      expect(shot.name).toBe(`${shot.name.split("-")[0]}-${shot.locale}-${shot.viewport}`);
    }
  });
  test("each page has an English and a Polish shot for both viewports: 5 pages make 20 shots", () => {
    expect(SHOT_PAGES).toEqual(["onboarding", "mailboxes", "settings", "rules", "activity"]);
    expect(SHOTS.length).toBe(20);
    for (const page of SHOT_PAGES)
      for (const locale of SHOT_LOCALES)
        for (const viewport of SHOT_VIEWPORTS)
          expect(SHOTS.filter((shot) => shot.name === `${page}-${locale}-${viewport}`).length).toBe(1);
  });
  test("each shot has a panel path and a text alternative in its own language", () => {
    for (const shot of SHOTS) {
      expect(shot.path).toBe(`/${shot.name.split("-")[0]}`);
      expect(shot.alt.length).toBeGreaterThan(20);
    }
    for (const page of SHOT_PAGES) {
      const en = SHOTS.find((shot) => shot.name === `${page}-en-desktop`)?.alt;
      const pl = SHOTS.find((shot) => shot.name === `${page}-pl-desktop`)?.alt;
      expect(en).not.toBe(pl);
      expect(SHOTS.find((shot) => shot.name === `${page}-en-phone`)?.alt).toBe(en);
      expect(SHOTS.find((shot) => shot.name === `${page}-pl-phone`)?.alt).toBe(pl);
    }
  });
});

describe("SHOT_TEXT_ALLOW", () => {
  test("each allowed text has a reason and still stands in a text of the panel", () => {
    const panelText = [...Object.values(en), ...Object.values(pl)].join("\n");
    expect(SHOT_TEXT_ALLOW.length).toBeGreaterThan(0);
    for (const entry of SHOT_TEXT_ALLOW) {
      expect(entry.reason.length).toBeGreaterThan(10);
      expect(panelText).toContain(entry.text);
    }
  });
});

describe("shot helpers", () => {
  test("shotLocale: pl reads Polish, every other value reads English", () => {
    expect(shotLocale("pl")).toBe("pl");
    for (const value of ["en", "root", undefined, "de"]) expect(shotLocale(value)).toBe("en");
  });
  test("shotsOn: only the value on turns it on", () => {
    expect(shotsOn({ DOCS_SHOTS: "on" })).toBe(true);
    for (const value of [undefined, "", "off", "1", "ON", "true"]) expect(shotsOn({ DOCS_SHOTS: value })).toBe(false);
  });
  test("a PNG file below 10 KB is no screenshot", () => {
    expect(SHOT_MIN_BYTES).toBe(10 * 1024);
  });
  test("shotUrl is under the site base", () => {
    expect(shotUrl("settings-en-desktop")).toBe("/email_assistant/shots/settings-en-desktop.png");
  });
  test("isShotPage knows the five pages only", () => {
    for (const page of SHOT_PAGES) expect(isShotPage(page)).toBe(true);
    for (const page of ["", "login", "settings-en", "toString", "constructor"]) expect(isShotPage(page)).toBe(false);
  });
  test("shotsDir needs the folder from the integration", () => {
    expect(shotsDir({ EA_DOCS_SHOTS_DIR: "/x/shots" })).toBe("/x/shots");
    expect(() => shotsDir({})).toThrow("shots_dir_unset");
    expect(() => shotsDir({ EA_DOCS_SHOTS_DIR: "" })).toThrow("shots_dir_unset");
  });
  test("shotFileExists looks for <name>.png", () => {
    const dir = mkdtempSync(join(tmpdir(), "docs-shots-"));
    try {
      expect(shotFileExists("a-en-desktop", dir)).toBe(false);
      mkdirSync(join(dir, "sub"));
      writeFileSync(join(dir, "a-en-desktop.png"), "x");
      expect(shotFileExists("a-en-desktop", dir)).toBe(true);
      expect(shotFileExists("a-en-phone", dir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("alt texts per source (stage 07)", () => {
  test("the demo list has the names and paths of the e2e list and its own alt text in each language", () => {
    expect(DEMO_SHOTS.map((shot) => [shot.name, shot.path])).toEqual(SHOTS.map((shot) => [shot.name, shot.path]));
    for (const [index, shot] of DEMO_SHOTS.entries()) {
      expect(shot.alt).not.toBe(SHOTS[index]?.alt);
      expect(shot.alt).toContain("demo");
    }
  });
  test("each alt text of both sources passes the public-content check and names no default-off feature", () => {
    for (const shot of [...SHOTS, ...DEMO_SHOTS]) {
      expect(shotTextProblem(shot.alt, shot.name)).toBeNull();
      expect(flaggedTextProblems(shot.alt)).toEqual([]);
    }
  });
  test("shotView gives the alt text of its source; no source is the e2e text", () => {
    const options = { on: false, exists: () => true };
    expect(shotView("mailboxes", "en", options).desktop.alt).toContain("no mailbox yet");
    expect(shotView("mailboxes", "en", { ...options, source: "e2e" }).desktop.alt).toContain("no mailbox yet");
    expect(shotView("mailboxes", "en", { ...options, source: "demo" }).desktop.alt).toContain("paused demo mailbox");
  });
});

describe("shotView", () => {
  const all = { on: true, exists: () => true };
  const none = { on: true, exists: () => false };

  test("shots on, files there: the images of the page language, desktop and phone", () => {
    const view = shotView("settings", "pl", all);
    expect(view.kind).toBe("images");
    expect(view.desktop.name).toBe("settings-pl-desktop");
    expect(view.phone.name).toBe("settings-pl-phone");
    expect(shotView("rules", "root", all).desktop.name).toBe("rules-en-desktop");
    expect(shotView("rules", undefined, all).phone.name).toBe("rules-en-phone");
  });
  test("shots on, a file missing: shot_missing with its name, desktop first", () => {
    expect(() => shotView("settings", undefined, none)).toThrow("shot_missing settings-en-desktop");
    expect(() => shotView("settings", "pl", { on: true, exists: (name) => name.endsWith("-desktop") })).toThrow(
      "shot_missing settings-pl-phone"
    );
  });
  test("shots off: a box, and no file is looked up", () => {
    const view = shotView("activity", "pl", {
      on: false,
      exists: () => {
        throw new Error("looked up");
      },
    });
    expect(view.kind).toBe("box");
    expect(view.desktop.alt).toContain("Aktywność");
  });
  test("an unknown page fails with the shots on and off", () => {
    for (const options of [all, none, { on: false, exists: () => false }]) {
      expect(() => shotView("nope", "en", options)).toThrow("shot_unknown_page nope");
      expect(() => shotView("toString", "en", options)).toThrow("shot_unknown_page toString");
    }
  });
});

describe("wiring", () => {
  test("Shot.astro asks shotView with the mode and the files, and shows a box or the picture", () => {
    const component = read("apps/docs/src/components/Shot.astro");
    expect(component).toContain("shotView(page, Astro.currentLocale, {");
    expect(component).toContain("exists: (name) => shotFileExists(name)");
    expect(component).toContain("source: shotSourceKind()");
    expect(component).toContain("const on = shotsOn();");
    expect(component).toContain("<picture>");
    expect(component).toContain("<source media={SHOT_PHONE_MEDIA} srcset={shotUrl(view.phone.name)} />");
    expect(component).toContain("src={shotUrl(view.desktop.name)}");
    expect(component).toContain("alt={view.desktop.alt}");
    expect(component).toContain('class="shot-off"');
  });
  test("the PNG files are ignored by git", () => {
    expect(read(".gitignore").split("\n")).toContain("apps/docs/public/shots/");
  });
});

describe("the checks of the shot run", () => {
  test("shotFeaturesProblem: an empty list passes, a flag on or no list fails (plan P2)", () => {
    expect(shotFeaturesProblem([])).toBeNull();
    expect(shotFeaturesProblem(["docs_links"])).toBe("shot_features_on docs_links");
    expect(shotFeaturesProblem(["stats_page", "docs_links"])).toBe("shot_features_on stats_page,docs_links");
    for (const value of [undefined, null, "docs_links", {}])
      expect(shotFeaturesProblem(value)).toBe("shot_features_unknown");
  });

  test("shotTextProblem: the rules of the public-content check stop a page, with the rule and the shot name", () => {
    expect(shotTextProblem("Settings\nDigest times 08:00", "settings-en-desktop")).toBeNull();
    expect(shotTextProblem("owner e2e-owner@x.test and 198.51.100.200", "a-en-desktop")).toBeNull();
    expect(shotTextProblem("write to jan.kowalski@gmail.com", "rules-en-phone")).toBe(
      "public_content R2 jan.kowalski@gmail.com in shot rules-en-phone"
    );
    expect(shotTextProblem("from 198.18.0.61", "settings-en-desktop")).toBe(
      "public_content R3 198.18.0.61 in shot settings-en-desktop"
    );
    expect(shotTextProblem("host bob.corp-net.ts.net", "x-pl-phone")).toContain("public_content R1");
  });

  test("shotTextProblem: only the allowed texts of SHOT_TEXT_ALLOW pass", () => {
    expect(shotTextProblem("An address (anna@firma.pl) or a domain", "rules-en-desktop")).toBeNull();
    expect(shotTextProblem("An address (anna@firma.com.pl)", "rules-en-desktop")).toContain("public_content R2");
    expect(shotTextProblem("write to ewa@firma.pl", "rules-en-desktop")).toBe(
      "public_content R2 ewa@firma.pl in shot rules-en-desktop"
    );
  });

  describe("shotFilesProblem", () => {
    const two = [
      { name: "a-en-desktop", path: "/a", locale: "en", viewport: "desktop", alt: "x" },
      { name: "a-en-phone", path: "/a", locale: "en", viewport: "phone", alt: "x" },
    ] as const;
    const withDir = (run: (dir: string) => void) => {
      const dir = mkdtempSync(join(tmpdir(), "docs-shot-files-"));
      try {
        run(dir);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };
    const big = "x".repeat(SHOT_MIN_BYTES + 1);

    test("exactly the files, each above 10 KB, passes", () => {
      withDir((dir) => {
        writeFileSync(join(dir, "a-en-desktop.png"), big);
        writeFileSync(join(dir, "a-en-phone.png"), big);
        expect(shotFilesProblem(dir, two)).toBeNull();
      });
    });
    test("a missing file, an extra file, a small file and a missing folder fail", () => {
      withDir((dir) => {
        writeFileSync(join(dir, "a-en-desktop.png"), big);
        expect(shotFilesProblem(dir, two)).toBe("shot_files_missing a-en-phone.png");
        writeFileSync(join(dir, "a-en-phone.png"), big);
        writeFileSync(join(dir, "old-en-phone.png"), big);
        expect(shotFilesProblem(dir, two)).toBe("shot_files_extra old-en-phone.png");
        rmSync(join(dir, "old-en-phone.png"));
        writeFileSync(join(dir, "a-en-phone.png"), "x".repeat(SHOT_MIN_BYTES));
        expect(shotFilesProblem(dir, two)).toBe("shot_file_small a-en-phone.png");
        expect(shotFilesProblem(join(dir, "none"), two)).toBe("shot_files_missing a-en-desktop.png,a-en-phone.png");
      });
    });
    test("the default list is SHOTS: 20 files", () => {
      withDir((dir) => {
        for (const shot of SHOTS) writeFileSync(join(dir, `${shot.name}.png`), big);
        expect(shotFilesProblem(dir)).toBeNull();
        rmSync(join(dir, "rules-pl-phone.png"));
        expect(shotFilesProblem(dir)).toBe("shot_files_missing rules-pl-phone.png");
      });
    });
  });
});
