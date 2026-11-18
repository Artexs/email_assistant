import { z } from "./zod";

export const onboardingSchema = z.object({
  mailbox: z.boolean(),
  telegram: z.boolean(),
  telegramAvailable: z.boolean(),
  mode: z.boolean(),
  rules: z.number().int().min(0),
  /** F110 stage 14: the flag `trust_ladder` is on, so the steps are mailbox, channel, report, rules (no mode step). */
  trust: z.boolean(),
  /** A way to reach the user is set: Telegram linked, or the report channel is mail (set only with the flag on). */
  channel: z.boolean(),
  /** A history check of the organization has ended (`done` or `no_result`): the report page has something to show. */
  report: z.boolean(),
  done: z.boolean(),
});
export type Onboarding = z.infer<typeof onboardingSchema>;

export function onboardingOf(input: {
  mailboxCount: number;
  telegramLinked: boolean;
  telegramAvailable: boolean;
  modeChosen: boolean;
  ruleCount: number;
  /** `null`: the flag `trust_ladder` is off, the steps are as before F110. */
  trust: { reportByMail: boolean; reportReady: boolean } | null;
}): Onboarding {
  const mailbox = input.mailboxCount > 0;
  const channel = input.telegramLinked || (input.trust?.reportByMail ?? false);
  const report = input.trust?.reportReady ?? false;
  // A server without a bot never blocks on the channel step (as the Telegram item before F110).
  const reachable = channel || !input.telegramAvailable;
  const done = input.trust === null ? mailbox && reachable && input.modeChosen : mailbox && reachable && report;
  return {
    mailbox,
    telegram: input.telegramLinked,
    telegramAvailable: input.telegramAvailable,
    mode: input.modeChosen,
    rules: input.ruleCount,
    trust: input.trust !== null,
    channel,
    report,
    done,
  };
}
