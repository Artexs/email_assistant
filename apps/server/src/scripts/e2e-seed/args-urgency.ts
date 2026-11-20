import { DAY_MS } from "@ea/core";

import { greenMailAddress, type E2eProject } from "./args-core";

// One organization per project for the urgency editor spec (it saves and clears profiles, so each project needs its
// own). The flag `urgency_editor` is on. Two mailboxes: `seeded` holds a profile with one topic, a deadline of yesterday and one in
// ten days; `empty` holds none. The two names are the labels of the deadlines the spec looks for.
export const E2E_URGENCY_OWNER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-urgency-owner-mobile@x.test",
  desktop: "e2e-urgency-owner-desktop@x.test",
};
export const E2E_URGENCY_MEMBER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-urgency-member-mobile@x.test",
  desktop: "e2e-urgency-member-desktop@x.test",
};
export const e2eUrgencyOrgName = (project: E2eProject): string => `E2E Urgency ${project}`;
export const e2eUrgencyMailbox = (project: E2eProject, which: "seeded" | "empty"): string =>
  greenMailAddress(`e2e-urgency-${which}-${project}@e2e.test`);
export const E2E_URGENCY_SEEDED = {
  topic: { label: "Annual audit", keywords: ["audit", "auditor"] },
  endedLabel: "Tax filing",
  futureLabel: "Board pack",
} as const;
export const E2E_TIMEZONE = "Europe/Warsaw";
// The seeded profile at the seed time `now`: the ended deadline is due the day before the local date of the organization, the future one in ten days.
export function e2eUrgencyProfile(now: Date): {
  topics: { label: string; keywords: string[] }[];
  deadlines: { label: string; due: string }[];
} {
  const localDate = (at: Date): string => new Intl.DateTimeFormat("en-CA", { timeZone: E2E_TIMEZONE }).format(at);
  return {
    topics: [{ label: E2E_URGENCY_SEEDED.topic.label, keywords: [...E2E_URGENCY_SEEDED.topic.keywords] }],
    deadlines: [
      { label: E2E_URGENCY_SEEDED.endedLabel, due: localDate(new Date(now.getTime() - DAY_MS)) },
      { label: E2E_URGENCY_SEEDED.futureLabel, due: localDate(new Date(now.getTime() + 10 * DAY_MS)) },
    ],
  };
}
