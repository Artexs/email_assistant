import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// The docs theme: the teal accent and the font of the panel, on top of Starlight's own grays.
const CSS_FILE = join(import.meta.dirname, "styles/custom.css");
const GLOBAL_CSS_FILE = join(import.meta.dirname, "../../web/src/styles/global.css");
const FONT_DIR = join(import.meta.dirname, "../../web/src/assets/fonts");
const PROPS_FILE = join(import.meta.dirname, "../../../node_modules/@astrojs/starlight/dist/style/props.css");

type Rgb = [number, number, number];

// The text of every block whose selector is exactly `selector`, joined.
function block(css: string, selector: string): string {
  const pattern = new RegExp(`(?:^|\\n)${selector.replace(/[[\]'.]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "g");
  const bodies = [...css.matchAll(pattern)].map((match) => match[1] ?? "");
  if (bodies.length === 0) throw new Error(`no block for ${selector}`);
  return bodies.join("\n");
}

function variable(css: string, selector: string, name: string): string {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(block(css, selector));
  if (!match?.[1]) throw new Error(`${name} is not set in ${selector}`);
  return match[1].trim();
}

// Each channel rounds to 8 bits before the WCAG formula.
function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const channel = (n: number): number => {
    const k = (n + hue / 30) % 12;
    return Math.round((l - (chroma / 2) * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255);
  };
  return [channel(0), channel(8), channel(4)];
}

function parseColor(value: string): Rgb {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex?.[1]) {
    const n = Number.parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const hsl = /^hsl\(\s*(\d+),\s*(\d+)%,\s*(\d+)%\s*\)$/.exec(value);
  if (hsl) return hslToRgb(Number(hsl[1]), Number(hsl[2]), Number(hsl[3]));
  throw new Error(`unknown colour ${value}`);
}

function luminance([r, g, b]: Rgb): number {
  const [lr, lg, lb] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(parseColor(a)), luminance(parseColor(b))];
  const ratio = (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  return Math.round(ratio * 100) / 100;
}

const DARK = ":root";
const LIGHT = ":root[data-theme='light']";
const ACCENT_VARIABLES = ["--sl-color-accent-low", "--sl-color-accent", "--sl-color-accent-high"] as const;

const EXPECTED_ACCENT = {
  [DARK]: { "--sl-color-accent-low": "#133b34", "--sl-color-accent": "#1fa892", "--sl-color-accent-high": "#3fd1b9" },
  [LIGHT]: { "--sl-color-accent-low": "#d5f0ea", "--sl-color-accent": "#0a7568", "--sl-color-accent-high": "#05453e" },
};

const custom = (): string => readFileSync(CSS_FILE, "utf8");
const props = (): string => readFileSync(PROPS_FILE, "utf8");

// Starlight's grays of one scheme: the first block of `props.css` is dark, the one with the light selector is light.
function starlight(scheme: typeof DARK | typeof LIGHT, name: string): string {
  const text = props();
  const from = scheme === LIGHT ? text.indexOf(":root[data-theme='light']") : 0;
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(text.slice(from));
  if (!match?.[1]) throw new Error(`${name} is not in props.css`);
  return match[1].trim();
}

function lightAccentContrasts(css: string): { name: string; ratio: number; expected: number }[] {
  const accent = variable(css, LIGHT, "--sl-color-accent");
  const high = variable(css, LIGHT, "--sl-color-accent-high");
  const low = variable(css, LIGHT, "--sl-color-accent-low");
  const white = starlight(LIGHT, "--sl-color-black");
  const gray6 = starlight(LIGHT, "--sl-color-gray-6");
  return [
    { name: "light accent on white", ratio: contrast(accent, white), expected: 5.59 },
    { name: "light accent on light gray-6", ratio: contrast(accent, gray6), expected: 4.82 },
    { name: "white on light accent", ratio: contrast(white, accent), expected: 5.59 },
    { name: "light accent-high on light accent-low", ratio: contrast(high, low), expected: 9.07 },
  ];
}

function darkAccentContrasts(css: string): { name: string; ratio: number; expected: number }[] {
  const high = variable(css, DARK, "--sl-color-accent-high");
  const low = variable(css, DARK, "--sl-color-accent-low");
  const black = starlight(DARK, "--sl-color-black");
  const gray6 = starlight(DARK, "--sl-color-gray-6");
  return [
    { name: "dark accent-high on dark black", ratio: contrast(high, black), expected: 9.32 },
    { name: "dark accent-high on dark gray-6", ratio: contrast(high, gray6), expected: 7.94 },
    { name: "dark accent-low on dark accent-high", ratio: contrast(low, high), expected: 6.48 },
  ];
}

describe("docs accent", () => {
  test.each([DARK, LIGHT] as const)("the three accent values of %s are the teal of the panel", (scheme) => {
    const actual = Object.fromEntries(ACCENT_VARIABLES.map((name) => [name, variable(custom(), scheme, name)]));
    expect(actual).toEqual(EXPECTED_ACCENT[scheme]);
  });

  test("each accent text pair has its exact contrast ratio and at least 4.5", () => {
    const pairs = [...lightAccentContrasts(custom()), ...darkAccentContrasts(custom())];
    expect(pairs.map(({ name, ratio }) => `${name} ${ratio}`)).toEqual(
      pairs.map(({ name, expected }) => `${name} ${expected}`)
    );
    expect(pairs.filter(({ ratio }) => ratio < 4.5).map(({ name }) => name)).toEqual([]);
  });
});

describe("docs font", () => {
  const fontFaces = (css: string): string[] => css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
  const fileOf = (face: string): string => /url\("([^"]+)"\)/.exec(face)?.[1] ?? "";
  const rangeOf = (face: string): string =>
    (/unicode-range:([^;]+);/.exec(face)?.[1] ?? "").replace(/\s+/g, " ").trim();

  test("each font file resolves to an existing file of the panel, and both files are used", () => {
    const urls = fontFaces(custom()).map(fileOf);
    const resolved = urls.map((url) => resolve(dirname(CSS_FILE), url));
    expect(resolved.map((path) => existsSync(path))).toEqual([true, true]);
    expect(resolved.map((path) => dirname(path)).every((dir) => dir === FONT_DIR)).toBe(true);
    expect(urls.map((url) => url.split("/").pop()).sort()).toEqual([
      "nunito-latin-ext-wght-normal.woff2",
      "nunito-latin-wght-normal.woff2",
    ]);
  });

  test("each rule has the unicode range of the panel rule for the same file", () => {
    const panel = new Map(
      fontFaces(readFileSync(GLOBAL_CSS_FILE, "utf8")).map((face) => [fileOf(face).split("/").pop(), rangeOf(face)])
    );
    const docs = fontFaces(custom()).map((face) => [fileOf(face).split("/").pop(), rangeOf(face)]);
    expect(docs).toEqual([...panel].sort(([a], [b]) => String(a).localeCompare(String(b))));
  });

  test("`--sl-font` begins with the Nunito family", () => {
    expect(variable(custom(), ":root", "--sl-font").startsWith('"Nunito Variable"')).toBe(true);
  });
});
