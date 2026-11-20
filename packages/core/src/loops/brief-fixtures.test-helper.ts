import type { DigestInput, DigestItem, DigestMailbox } from "../digest/digest";
import { textTables } from "../texts";
import { DAY_MS, HOUR_MS, MINUTE_MS } from "../time";

import type { BriefInput, BriefLoop, BriefMail } from "./brief";

// Fri 2026-11-20 08:00 in Warsaw (UTC+1).
export const NOW = new Date("2026-11-20T07:00:00Z");
export const ZONE = "Europe/Warsaw";

export const uuid = (n: number): string => `0190a1b2-c3d4-7e5f-8a9b-${n.toString(16).padStart(12, "0")}`;

export const mail = (n: number, over: Partial<BriefMail> = {}): BriefMail => ({
  emailId: uuid(n),
  from: `Jan Kowalski ${n} <jan${n}@firma.test>`,
  subject: `Oferta Q${n}`,
  receivedAt: new Date(NOW.getTime() - n * DAY_MS),
  ...over,
});

export const loop = (n: number, over: Partial<BriefLoop> = {}): BriefLoop => ({
  id: uuid(100 + n),
  kind: "waiting",
  counterpart: "anna@example.test",
  subject: "Offer for Q1",
  text: null,
  dueAt: new Date("2026-11-13T09:00:00Z"),
  sinceAt: new Date("2026-11-10T09:00:00Z"),
  autoReplyOnly: false,
  usualReplyDays: null,
  laterCount: 0,
  canDraft: true,
  followUp: null,
  ...over,
});

const none = { rows: [], total: 0 } as const;

export function briefInput(over: Partial<BriefInput> = {}): BriefInput {
  return {
    now: NOW,
    timeZone: ZONE,
    consent: true,
    urgent: none,
    reply: none,
    waitingLoops: none,
    waitingDelegations: none,
    promised: none,
    stale: none,
    ...over,
  };
}

export const part = <T>(rows: readonly T[], total = rows.length) => ({ rows, total });

export const digestMailbox: DigestMailbox = {
  id: "m1",
  address: "boss@firma.test",
  status: "active",
  lastSyncedAt: new Date(NOW.getTime() - 5 * MINUTE_MS),
  statusChangedAt: new Date("2026-11-01T00:00:00Z"),
  mode: "assist",
};

export function digestItem(n: number, category: DigestItem["category"], over: Partial<DigestItem> = {}): DigestItem {
  return {
    emailId: uuid(n),
    category,
    from: `Ann${n} <ann${n}@firma.test>`,
    subject: `Subject ${n}`,
    receivedAt: new Date(NOW.getTime() - n * MINUTE_MS),
    synthetic: false,
    folderTag: null,
    aiText: null,
    wouldDo: "would flag",
    undoable: false,
    ...over,
  };
}

export function digestInput(over: Partial<DigestInput> = {}): DigestInput {
  return {
    kind: "scheduled",
    now: NOW,
    timeZone: ZONE,
    slot: { date: "2026-11-20", time: "08:00", late: false },
    periodStart: new Date(NOW.getTime() - 16 * HOUR_MS),
    mailboxes: [digestMailbox],
    counts: {},
    items: [],
    skippedTooOld: 0,
    skippedBacklog: 0,
    waiting: 0,
    ...over,
  };
}

export { textTables };
