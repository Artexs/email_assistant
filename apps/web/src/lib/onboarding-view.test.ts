import type { Onboarding } from "@ea/core/web";
import { describe, expect, test } from "bun:test";

import { onboardingProgress, type OnboardingProgress } from "./onboarding-view";

const base: Onboarding = {
  mailbox: false,
  telegram: false,
  telegramAvailable: true,
  mode: false,
  rules: 0,
  trust: false,
  channel: false,
  report: false,
  done: false,
};

describe("onboardingProgress", () => {
  test.each<[string, Partial<Onboarding>, OnboardingProgress]>([
    ["mode path: the mailbox is done, Telegram is next", { mailbox: true }, { done: 1, total: 3, current: "telegram" }],
    [
      "mode path: no Telegram on this server leaves its step out",
      { mailbox: true, telegramAvailable: false },
      { done: 1, total: 2, current: "mode" },
    ],
    [
      "trust path: the report is next",
      { trust: true, mailbox: true, channel: true },
      { done: 2, total: 3, current: "report" },
    ],
    [
      "trust path: no Telegram on this server leaves the channel step out",
      { trust: true, mailbox: true, telegramAvailable: false },
      { done: 1, total: 2, current: "report" },
    ],
    [
      "everything required is done; the rules step does not count",
      { mailbox: true, telegram: true, mode: true, rules: 0, done: true },
      { done: 3, total: 3, current: null },
    ],
  ])("%s", (_name, change, expected) => {
    expect(onboardingProgress({ ...base, ...change })).toEqual(expected);
  });
});
