import { describe, expect, test } from "bun:test";

import { onboardingOf } from "./onboarding";

const full = { mailboxCount: 1, telegramLinked: true, telegramAvailable: true, modeChosen: true, ruleCount: 0 };

describe("onboardingOf", () => {
  test("is done with a mailbox, a link and a mode", () => {
    expect(onboardingOf(full).done).toBe(true);
  });

  test("is open without a mailbox, a link or a mode", () => {
    expect(onboardingOf({ ...full, mailboxCount: 0 }).done).toBe(false);
    expect(onboardingOf({ ...full, telegramLinked: false }).done).toBe(false);
    expect(onboardingOf({ ...full, modeChosen: false }).done).toBe(false);
  });

  test("rules never block but are counted", () => {
    const state = onboardingOf({
      mailboxCount: 0,
      telegramLinked: false,
      telegramAvailable: true,
      modeChosen: false,
      ruleCount: 3,
    });
    expect(state.rules).toBe(3);
    expect(state.done).toBe(false);
  });

  test("a server without a bot never blocks", () => {
    const state = onboardingOf({ ...full, telegramLinked: false, telegramAvailable: false });
    expect(state.done).toBe(true);
    expect(state.telegram).toBe(false);
  });
});
