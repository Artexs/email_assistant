import { describe, expect, test } from "bun:test";

import { deviceOf, sessionsSchema } from "./sessions";

const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0";
const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const EDGE_WINDOWS = `${CHROME_WINDOWS} Edg/130.0.0.0`;
const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const OPERA_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0";
const HEADLESS =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36";

describe("deviceOf", () => {
  test("reads the browser and the system of common user agents", () => {
    expect(deviceOf(FIREFOX_LINUX)).toEqual({ browser: "firefox", os: "linux" });
    expect(deviceOf(CHROME_WINDOWS)).toEqual({ browser: "chrome", os: "windows" });
    expect(deviceOf(SAFARI_IPHONE)).toEqual({ browser: "safari", os: "ios" });
    expect(deviceOf(EDGE_WINDOWS)).toEqual({ browser: "edge", os: "windows" });
    expect(deviceOf(CHROME_ANDROID)).toEqual({ browser: "chrome", os: "android" });
    expect(deviceOf(OPERA_MAC)).toEqual({ browser: "opera", os: "macos" });
    expect(deviceOf(HEADLESS)).toEqual({ browser: "chrome", os: "linux" });
  });

  test("answers unknown for a missing or empty user agent", () => {
    expect(deviceOf(null)).toEqual({ browser: "unknown", os: "unknown" });
    expect(deviceOf("")).toEqual({ browser: "unknown", os: "unknown" });
    expect(deviceOf("curl/8.0")).toEqual({ browser: "unknown", os: "unknown" });
  });
});

describe("sessionsSchema", () => {
  test("accepts a list and refuses a bad date", () => {
    const row = {
      id: "s1",
      current: true,
      device: { browser: "firefox", os: "linux" },
      address: null,
      lastUsedAt: "2026-11-13T10:00:00.000Z",
      createdAt: "2026-11-12T10:00:00.000Z",
    };
    expect(sessionsSchema.safeParse({ sessions: [row] }).success).toBe(true);
    expect(sessionsSchema.safeParse({ sessions: [{ ...row, lastUsedAt: "yesterday" }] }).success).toBe(false);
  });
});
