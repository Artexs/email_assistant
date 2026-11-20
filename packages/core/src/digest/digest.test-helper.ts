import { textTables, type CoreTexts } from "../texts";
import type { Category } from "../triage/categories";

import { renderDigestWithBrief, type DigestInput, type DigestItem, type DigestMailbox } from "./digest";
import { type OutMessage } from "./message";

export const timeZone = "Europe/Warsaw";

export const now = new Date("2026-11-06T07:00:00Z");

export const slot = { date: "2026-11-06", time: "08:00", late: false };

export const mailbox: DigestMailbox = {
  id: "m1",
  address: "boss@firma.test",
  status: "active",
  lastSyncedAt: new Date("2026-11-06T06:55:00Z"),
  statusChangedAt: new Date("2026-11-01T00:00:00Z"),
  mode: "shadow",
};

export function uuid(n: number): string {
  return `0190a1b2-c3d4-7e5f-8a9b-${n.toString(16).padStart(12, "0")}`;
}

export function item(n: number, category: Category, extra: Partial<DigestItem> = {}): DigestItem {
  return {
    emailId: uuid(n),
    category,
    from: `Ann${n} <ann${n}@firma.test>`,
    subject: `Subject ${n}`,
    receivedAt: new Date(Date.UTC(2026, 10, 6, 5, n)),
    synthetic: false,
    folderTag: null,
    aiText: `AI text ${n}`,
    wouldDo: "would flag",
    undoable: false,
    ...extra,
  };
}

export function input(extra: Partial<DigestInput> = {}): DigestInput {
  return {
    kind: "scheduled",
    now,
    timeZone,
    slot,
    periodStart: new Date("2026-11-05T15:00:00Z"),
    mailboxes: [mailbox],
    counts: {},
    items: [],
    skippedTooOld: 0,
    skippedBacklog: 0,
    waiting: 0,
    ...extra,
  };
}

// The old cases render with the English texts; the Polish cases pass `textTables.pl`.
export const render = (digest: DigestInput, texts: CoreTexts = textTables.en): OutMessage =>
  renderDigestWithBrief(digest, texts).message;

export const blockStarts = (text: string): string[] => text.split("\n").filter((line) => /^\d+\. /.test(line));
