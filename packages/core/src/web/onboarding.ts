import { z } from "./zod";

export const onboardingSchema = z.object({
  mailbox: z.boolean(),
  telegram: z.boolean(),
  telegramAvailable: z.boolean(),
  mode: z.boolean(),
  rules: z.number().int().min(0),
  done: z.boolean(),
});
export type Onboarding = z.infer<typeof onboardingSchema>;

export function onboardingOf(input: {
  mailboxCount: number;
  telegramLinked: boolean;
  telegramAvailable: boolean;
  modeChosen: boolean;
  ruleCount: number;
}): Onboarding {
  const mailbox = input.mailboxCount > 0;
  return {
    mailbox,
    telegram: input.telegramLinked,
    telegramAvailable: input.telegramAvailable,
    mode: input.modeChosen,
    rules: input.ruleCount,
    done: mailbox && (input.telegramLinked || !input.telegramAvailable) && input.modeChosen,
  };
}
