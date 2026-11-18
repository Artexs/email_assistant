import { describe, expect, test } from "bun:test";

import { onboardingOf } from "./onboarding";

const full = {
  mailboxCount: 1,
  telegramLinked: true,
  telegramAvailable: true,
  modeChosen: true,
  ruleCount: 0,
  trust: null,
};

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
      trust: null,
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

// F110 stage 14: with `trust_ladder` on the steps are mailbox, channel, report, rules. The mode step is gone.
describe("onboardingOf with the flag trust_ladder", () => {
  const flagged = { ...full, modeChosen: false, trust: { reportByMail: false, reportReady: false } };

  test("a mailbox and a link without a finished check are not done, even with a mode", () => {
    expect(onboardingOf(flagged).done).toBe(false);
    expect(onboardingOf({ ...flagged, modeChosen: true }).done).toBe(false);
    expect(onboardingOf(flagged)).toMatchObject({ trust: true, channel: true, report: false });
  });

  test("a finished check (done or no_result) closes it, with no mode chosen", () => {
    const state = onboardingOf({ ...flagged, trust: { reportByMail: false, reportReady: true } });
    expect(state.done).toBe(true);
    expect(state).toMatchObject({ report: true, mode: false });
  });

  test("the channel is Telegram or the mail report channel", () => {
    const ready = { reportByMail: false, reportReady: true };
    expect(onboardingOf({ ...flagged, telegramLinked: false, trust: ready }).done).toBe(false);
    const byMail = onboardingOf({ ...flagged, telegramLinked: false, trust: { ...ready, reportByMail: true } });
    expect(byMail).toMatchObject({ channel: true, telegram: false, done: true });
  });

  test("a server without a bot never blocks on the channel, and a missing mailbox always blocks", () => {
    const ready = { reportByMail: false, reportReady: true };
    expect(onboardingOf({ ...flagged, telegramLinked: false, telegramAvailable: false, trust: ready }).done).toBe(true);
    expect(onboardingOf({ ...flagged, mailboxCount: 0, trust: ready }).done).toBe(false);
  });

  test("the flag off keeps the old rule: the mode decides, a finished check does not count", () => {
    expect(onboardingOf({ ...full, modeChosen: false, trust: null }).done).toBe(false);
    const off = onboardingOf({ ...full, trust: null });
    expect(off).toMatchObject({ trust: false, report: false, done: true });
  });
});
