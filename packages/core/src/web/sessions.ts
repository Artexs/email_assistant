import { z } from "./zod";

export const browserCodes = ["edge", "opera", "firefox", "chrome", "safari", "unknown"] as const;
export const osCodes = ["android", "ios", "windows", "macos", "linux", "unknown"] as const;

export type BrowserCode = (typeof browserCodes)[number];
export type OsCode = (typeof osCodes)[number];

const BROWSERS: readonly (readonly [RegExp, BrowserCode])[] = [
  [/Edg\//, "edge"],
  [/OPR\/|Opera/, "opera"],
  [/Firefox\//, "firefox"],
  [/Chrome\//, "chrome"], // also matches `HeadlessChrome/`
  [/Safari\//, "safari"],
];

const SYSTEMS: readonly (readonly [RegExp, OsCode])[] = [
  [/Android/, "android"],
  [/iPhone|iPad|iPod/, "ios"],
  [/Windows/, "windows"],
  [/Mac OS X|Macintosh/, "macos"],
  [/Linux/, "linux"],
];

// L21: the first matching rule wins, so Edge and Opera (which also say "Chrome") come first.
export function deviceOf(userAgent: string | null): { browser: BrowserCode; os: OsCode } {
  const text = userAgent ?? "";
  return {
    browser: BROWSERS.find(([pattern]) => pattern.test(text))?.[1] ?? "unknown",
    os: SYSTEMS.find(([pattern]) => pattern.test(text))?.[1] ?? "unknown",
  };
}

export const sessionViewSchema = z.object({
  id: z.string(),
  current: z.boolean(),
  device: z.object({ browser: z.enum(browserCodes), os: z.enum(osCodes) }),
  address: z.string().nullable(),
  lastUsedAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export type SessionView = z.infer<typeof sessionViewSchema>;

export const sessionsSchema = z.object({ sessions: z.array(sessionViewSchema) });
export type Sessions = z.infer<typeof sessionsSchema>;
