import type { Category } from "../triage/categories";
import { relationOf, type SenderHistory, bulkSignals } from "../triage/sender-history";

import { largestRemainder, type Rng } from "./random";
import type { Scenario, SimPersona, SimPersonaGroup } from "./scenario";

type BulkSignal = (typeof bulkSignals)[number];
type Range = readonly [number, number];

interface Profile {
  received: Range;
  mix: Partial<Record<Category, number>>;
  // Share of the received mails that the user answered, in percent.
  answeredPct: Range;
  userMailsTo: Range;
  bulk: readonly BulkSignal[];
  delegationsTo?: Range;
  // Sender seen for the first time: the first sight is recent.
  fresh?: boolean;
}

// Group-typical sender history (D9): counts and flags that a real mailbox would hold after 90 days.
const profiles: Record<SimPersonaGroup, Profile> = {
  boss: {
    received: [40, 80],
    mix: { needs_reply: 45, urgent: 25, info: 20, delegation: 10 },
    answeredPct: [60, 90],
    userMailsTo: [25, 60],
    bulk: [],
  },
  team: {
    received: [30, 90],
    mix: { info: 40, needs_reply: 30, urgent: 10, delegation: 10, notification: 10 },
    answeredPct: [50, 80],
    userMailsTo: [15, 50],
    bulk: [],
  },
  delegate: {
    received: [20, 50],
    mix: { info: 40, needs_reply: 30, delegation: 15, notification: 15 },
    answeredPct: [60, 90],
    userMailsTo: [15, 40],
    bulk: [],
    delegationsTo: [5, 20],
  },
  client: {
    received: [10, 40],
    mix: { needs_reply: 50, info: 25, urgent: 15, delegation: 10 },
    answeredPct: [40, 80],
    userMailsTo: [8, 30],
    bulk: [],
  },
  partner: {
    received: [8, 30],
    mix: { needs_reply: 40, info: 35, urgent: 10, delegation: 15 },
    answeredPct: [40, 80],
    userMailsTo: [6, 25],
    bulk: [],
  },
  vendor: {
    received: [6, 25],
    mix: { info: 40, needs_reply: 35, notification: 15, delegation: 10 },
    answeredPct: [30, 70],
    userMailsTo: [3, 15],
    bulk: [],
  },
  newsletter: {
    received: [20, 60],
    mix: { notification: 85, info: 15 },
    answeredPct: [0, 0],
    userMailsTo: [0, 0],
    bulk: ["list_id", "list_unsubscribe"],
  },
  marketing: {
    received: [15, 50],
    mix: { spam: 60, notification: 40 },
    answeredPct: [0, 0],
    userMailsTo: [0, 0],
    bulk: ["list_id", "list_unsubscribe"],
  },
  system: {
    received: [50, 150],
    mix: { notification: 100 },
    answeredPct: [0, 0],
    userMailsTo: [0, 0],
    bulk: ["noreply", "auto_submitted"],
  },
  spammer: {
    received: [1, 15],
    mix: { spam: 100 },
    answeredPct: [0, 0],
    userMailsTo: [0, 0],
    bulk: ["list_unsubscribe"],
  },
  phishing: {
    received: [0, 2],
    mix: { spam: 100 },
    answeredPct: [0, 0],
    userMailsTo: [0, 0],
    bulk: [],
    fresh: true,
  },
};

// The ranges of `profiles` hold for a history of this many days; a shorter history scales the counts.
const PROFILE_DAYS = 90;

const PERSON_GROUPS: readonly SimPersonaGroup[] = ["boss", "team", "delegate", "client", "partner", "vendor"];

function between(rng: Rng, [low, high]: Range, scale = 1): number {
  const from = Math.round(low * scale);
  const to = Math.max(from, Math.round(high * scale));
  return from + rng.int(to - from + 1);
}

function replyHours(rng: Rng): number {
  return Math.round((0.5 + rng.next() * 47) * 10) / 10;
}

// The history of one sender over `days` days before the mail (D9, X3): counts and flags, never text.
export function senderHistoryFor(persona: SimPersona, scenario: Scenario, rng: Rng, days: number): SenderHistory {
  const profile = profiles[persona.group];
  const scale = days / PROFILE_DAYS;
  const received = between(rng, profile.received, scale);
  const categoryList = Object.keys(profile.mix) as Category[];
  const split = largestRemainder(
    categoryList.map((c) => profile.mix[c] as number),
    received
  );
  const byCategory: SenderHistory["byCategory"] = {};
  categoryList.forEach((category, index) => {
    if ((split[index] as number) > 0) byCategory[category] = split[index] as number;
  });

  const answered = Math.round((received * between(rng, profile.answeredPct)) / 100);
  const userMailsTo = received === 0 ? 0 : between(rng, profile.userMailsTo, scale);
  const delegationsTo = profile.delegationsTo ? between(rng, profile.delegationsTo, scale) : 0;
  const present = Object.keys(byCategory) as Category[];
  const corrections: SenderHistory["corrections"] = {};
  if (PERSON_GROUPS.includes(persona.group) && received >= 20 && rng.int(4) === 0) {
    corrections[rng.pick(present)] = 1;
  }
  const person = PERSON_GROUPS.includes(persona.group);

  let firstSeenDaysAgo: number | null = null;
  let lastSeenDaysAgo: number | null = null;
  if (received > 0) {
    const earliest = Math.round(30 * scale);
    firstSeenDaysAgo = profile.fresh
      ? rng.int(3)
      : Math.min(days, earliest + rng.int(Math.max(1, days - earliest + 1)));
    lastSeenDaysAgo = rng.int(Math.min(firstSeenDaysAgo, 14) + 1);
  }
  const bulkSignalList = received > 0 ? [...profile.bulk] : [];

  return {
    days,
    received,
    byCategory,
    corrections,
    movedBack: person ? rng.int(3) : 0,
    answered,
    flagged: person ? Math.min(received, rng.int(4)) : 0,
    unseen7d: Math.min(received, rng.int(5)),
    userMailsTo,
    lastUserMailDaysAgo: userMailsTo > 0 ? rng.int(Math.min(days, 30)) : null,
    delegationsTo,
    bulkSignals: bulkSignalList,
    firstSeenDaysAgo,
    lastSeenDaysAgo,
    medianUserReplyHours: answered >= 5 ? replyHours(rng) : null,
    medianTheirReplyHours: userMailsTo >= 5 ? replyHours(rng) : null,
    relation: relationOf({
      isDelegate: persona.group === "delegate" || scenario.delegates.some((d) => d.persona === persona.key),
      isVip: scenario.urgency.vip.includes(persona.key),
      received,
      bulkMails: bulkSignalList.length > 0 ? received : 0,
      answered,
      userMailsTo,
    }),
  };
}
