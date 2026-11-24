import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { categories } from "@ea/core";

const srcDir = join(import.meta.dir, "..");
const css = readFileSync(join(srcDir, "styles/global.css"), "utf8");

type Scheme = "light" | "dark";
type Tokens = Record<string, string>;

function declarations(block: string): Tokens {
  const out: Tokens = {};
  for (const [, name = "", value = ""] of block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
    out[name] = value.replace(/\s+/g, " ").trim();
  }
  return out;
}

// The `:root` blocks of the file: the first holds the light values, the one inside the dark media query overrides them.
function rawTokens(scheme: Scheme): Tokens {
  const rootBlocks = [...css.matchAll(/(^|\n)(@media[^{]*\{\s*)?:root\s*\{([^}]*)\}/g)];
  const light: Tokens = {};
  const dark: Tokens = {};
  for (const [, , media, body = ""] of rootBlocks)
    Object.assign(media === undefined ? light : dark, declarations(body));
  return scheme === "light" ? light : { ...light, ...dark };
}

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const digits = /^#([0-9a-f]{6})$/i.exec(hex)?.[1];
  if (digits === undefined) throw new Error(`not a six-digit hex colour: ${hex}`);
  const n = Number.parseInt(digits, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// The soft rule of the design: `color-mix(in srgb, <colour> N%, <surface>)`, mixed per channel in sRGB.
function resolve(name: string, tokens: Tokens): Rgb {
  const value = tokens[name];
  if (value === undefined) throw new Error(`token ${name} is not set`);
  const alias = /^var\((--[a-z0-9-]+)\)$/.exec(value);
  if (alias?.[1] !== undefined) return resolve(alias[1], tokens);
  const mix = /^color-mix\(in srgb, var\((--[a-z0-9-]+)\) (\d+)%, var\((--[a-z0-9-]+)\)\)$/.exec(value);
  if (mix?.[1] !== undefined && mix[3] !== undefined) {
    const share = Number(mix[2]) / 100;
    const [r1, g1, b1] = resolve(mix[1], tokens);
    const [r2, g2, b2] = resolve(mix[3], tokens);
    return [r1 * share + r2 * (1 - share), g1 * share + g2 * (1 - share), b1 * share + b2 * (1 - share)];
  }
  return hexToRgb(value);
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(scheme: Scheme, a: string, b: string): number {
  const tokens = rawTokens(scheme);
  const [x, y] = [luminance(resolve(a, tokens)), luminance(resolve(b, tokens))];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const expected: Record<Scheme, Tokens> = {
  light: {
    "--background": "#f3f6f5",
    "--foreground": "#13201d",
    "--card": "#ffffff",
    "--card-foreground": "var(--foreground)",
    "--popover": "#ffffff",
    "--popover-foreground": "var(--foreground)",
    "--muted": "#e8efed",
    "--secondary": "#e8efed",
    "--secondary-foreground": "var(--foreground)",
    "--muted-foreground": "#586b66",
    "--border": "#dbe5e2",
    "--input": "#6e968a",
    "--primary": "#0a7568",
    "--primary-foreground": "#ffffff",
    "--primary-soft": "#d5f0ea",
    "--accent": "#fff1e0",
    "--accent-foreground": "#8a4b00",
    "--destructive": "#af3434",
    "--destructive-foreground": "#ffffff",
    "--destructive-soft": "color-mix(in srgb, var(--destructive) 14%, var(--card))",
    "--ring": "var(--primary)",
    "--sidebar": "#ffffff",
    "--shadow-card": "0 1px 2px rgb(16 40 34 / 0.05), 0 12px 32px -8px rgb(16 40 34 / 0.12)",
    "--avatar-1": "#0a7568",
    "--avatar-2": "#7741c8",
    "--avatar-3": "#235ebf",
    "--avatar-4": "#a8500f",
    "--avatar-5": "#b3366b",
    "--avatar-foreground": "#ffffff",
    "--tabbar-height": "4rem",
    "--radius": "22px",
    "--cat-urgent": "#af3434",
    "--cat-needs-reply": "#235ebf",
    "--cat-delegation": "#7741c8",
    "--cat-info": "#4b5d73",
    "--cat-notification": "#096e61",
    "--cat-spam": "#87581b",
    "--cat-unsure": "#8f5400",
  },
  dark: {
    "--background": "#0d1513",
    "--foreground": "#e4efec",
    "--card": "#16211e",
    "--card-foreground": "var(--foreground)",
    "--popover": "#16211e",
    "--popover-foreground": "var(--foreground)",
    "--muted": "#1d2b27",
    "--secondary": "#1d2b27",
    "--secondary-foreground": "var(--foreground)",
    "--muted-foreground": "#95aba5",
    "--border": "#24332f",
    "--input": "#4f7067",
    "--primary": "#3fd1b9",
    "--primary-foreground": "#04201b",
    "--primary-soft": "#133b34",
    "--accent": "#3a2a14",
    "--accent-foreground": "#ffc983",
    "--destructive": "#ff7c7c",
    "--destructive-foreground": "#2b0707",
    "--destructive-soft": "color-mix(in srgb, var(--destructive) 14%, var(--card))",
    "--ring": "var(--primary)",
    "--sidebar": "#121c19",
    "--shadow-card": "0 1px 2px #0006, 0 12px 32px -8px #0008",
    "--avatar-1": "#3fd1b9",
    "--avatar-2": "#c3a0ff",
    "--avatar-3": "#7fb0ff",
    "--avatar-4": "#e0ad6b",
    "--avatar-5": "#ff9cc2",
    "--avatar-foreground": "#0d1513",
    "--tabbar-height": "4rem",
    "--radius": "22px",
    "--cat-urgent": "#ff7c7c",
    "--cat-needs-reply": "#7fb0ff",
    "--cat-delegation": "#c3a0ff",
    "--cat-info": "#a8b6c7",
    "--cat-notification": "#3fd1b9",
    "--cat-spam": "#e0ad6b",
    "--cat-unsure": "#ffc46b",
  },
};

const categoryToken = (category: string) => `--cat-${category.replaceAll("_", "-")}`;

describe("design tokens", () => {
  test.each(["light", "dark"] as const)("%s scheme holds every value of the design", (scheme) => {
    const tokens = rawTokens(scheme);
    const actual = Object.fromEntries(Object.keys(expected[scheme]).map((name) => [name, tokens[name]]));
    expect(actual).toEqual(expected[scheme]);
  });

  test("a soft token mixes its colour at 14 % with the card colour", () => {
    const tokens = rawTokens("light");
    const softRule = (colour: string) => `color-mix(in srgb, var(${colour}) 14%, var(--card))`;
    expect(tokens["--destructive-soft"]).toBe(softRule("--destructive"));
    for (const category of categories) {
      const name = categoryToken(category);
      expect(tokens[`${name}-soft`], name).toBe(softRule(name));
    }
  });

  test("the soft tokens resolve to the mix of the colour and the card", () => {
    // 14 % of #af3434 over white, per channel: 0.14 * 175 + 0.86 * 255 = 243.8 and 0.14 * 52 + 0.86 * 255 = 226.6
    expect(resolve("--destructive-soft", rawTokens("light")).map((c) => c.toFixed(1))).toEqual([
      "243.8",
      "226.6",
      "226.6",
    ]);
  });

  test("the removed chart and sidebar tokens are gone", () => {
    expect(css).not.toMatch(/--chart-/);
    expect(css.match(/--sidebar[a-z-]*:/g)).toEqual(["--sidebar:", "--sidebar:"]);
  });

  test("a colour token has a class in the theme", () => {
    const names = [...Object.keys(expected.light)].filter(
      (name) => !["--shadow-card", "--tabbar-height", "--radius", "--ring"].includes(name)
    );
    for (const name of [...names, "--ring"]) {
      expect(css, name).toContain(`--color-${name.slice(2)}: var(${name});`);
    }
    for (const category of categories) {
      const name = categoryToken(category);
      expect(css, name).toContain(`--color-${name.slice(2)}-soft: var(${name}-soft);`);
    }
  });

  test("the radius scale is fixed", () => {
    expect(css).toContain("--radius-sm: 10px;");
    expect(css).toContain("--radius-md: 16px;");
    expect(css).toContain("--radius-lg: var(--radius);");
    expect(css).toContain("--radius-xl: 28px;");
  });
});

describe("design token contrast", () => {
  const textPairs: [string, string][] = [
    ["--foreground", "--background"],
    ["--foreground", "--card"],
    ["--foreground", "--muted"],
    ["--muted-foreground", "--background"],
    ["--muted-foreground", "--card"],
    ["--muted-foreground", "--muted"],
    ["--primary-foreground", "--primary"],
    ["--primary", "--card"],
    ["--primary", "--background"],
    ["--primary", "--primary-soft"],
    ["--accent-foreground", "--accent"],
    ["--destructive", "--card"],
    ["--destructive", "--destructive-soft"],
    ["--destructive-foreground", "--destructive"],
    ...categories.flatMap((category): [string, string][] => [
      [categoryToken(category), `${categoryToken(category)}-soft`],
    ]),
    ...[1, 2, 3, 4, 5].map((n): [string, string] => ["--avatar-foreground", `--avatar-${n}`]),
  ];

  test.each(["light", "dark"] as const)("%s: every text pair is at least 4.5:1", (scheme) => {
    for (const [foreground, background] of textPairs) {
      expect(contrast(scheme, foreground, background), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test.each(["light", "dark"] as const)("%s: a field edge and the focus ring are at least 3:1", (scheme) => {
    const edgePairs: [string, string][] = [
      ["--input", "--card"],
      ["--input", "--background"],
      ["--ring", "--card"],
      ["--ring", "--background"],
    ];
    for (const [colour, surface] of edgePairs) {
      expect(contrast(scheme, colour, surface), `${colour} on ${surface}`).toBeGreaterThanOrEqual(3);
    }
  });

  test("three measured values of the design", () => {
    expect(contrast("light", "--primary", "--primary-soft").toFixed(2)).toBe("4.65");
    expect(contrast("light", "--ring", "--background").toFixed(2)).toBe("5.14");
    expect(contrast("dark", "--destructive-foreground", "--destructive").toFixed(2)).toBe("7.42");
  });
});

describe("classes that the token meanings no longer allow", () => {
  const banners = ["components/shell/AuthErrorBanner.tsx"];

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /\.(tsx?|astro|css)$/.test(entry) ? [path] : [];
    });
  }

  const scanned = sourceFiles(srcDir).filter((path) => !path.endsWith("tokens.test.ts"));
  const classPatterns: [string, RegExp][] = [
    ["a focus colour with opacity", /(?:ring|outline)-ring\//],
    ["an accent class", /\b(?:bg|text|border|ring|outline|fill|stroke|from|via|to|divide|shadow)-accent\b/],
  ];

  test("the scan reads the source tree", () => {
    expect(scanned.length).toBeGreaterThan(100);
  });

  test.each(classPatterns)("no file uses %s", (_name, pattern) => {
    const hits = scanned
      .filter((path) => pattern.test(readFileSync(path, "utf8")))
      .map((path) => path.slice(srcDir.length + 1))
      .filter((path) => !banners.includes(path));
    expect(hits).toEqual([]);
  });
});
