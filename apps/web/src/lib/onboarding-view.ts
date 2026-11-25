import type { Onboarding } from "@ea/core/web";

export type StepKey = "mailbox" | "channel" | "report" | "telegram" | "mode";

export interface OnboardingProgress {
  done: number;
  total: number;
  /** The first required step that is not done; `null` when all are done. */
  current: StepKey | null;
}

// The required steps follow `trust`. A step with no state (Telegram is off on this server) is left out of both counts;
// the optional rules step never counts.
export function onboardingProgress(onboarding: Onboarding): OnboardingProgress {
  const steps: { key: StepKey; done: boolean | null }[] = onboarding.trust
    ? [
        { key: "mailbox", done: onboarding.mailbox },
        { key: "channel", done: onboarding.telegramAvailable ? onboarding.channel : null },
        { key: "report", done: onboarding.report },
      ]
    : [
        { key: "mailbox", done: onboarding.mailbox },
        { key: "telegram", done: onboarding.telegramAvailable ? onboarding.telegram : null },
        { key: "mode", done: onboarding.mode },
      ];
  const counted = steps.filter((step) => step.done !== null);
  return {
    done: counted.filter((step) => step.done === true).length,
    total: counted.length,
    current: counted.find((step) => step.done === false)?.key ?? null,
  };
}
