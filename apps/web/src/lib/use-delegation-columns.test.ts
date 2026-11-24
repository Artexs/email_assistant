import type { DelegationItem, DelegationList } from "@ea/core/web";
import { describe, expect, test } from "bun:test";

import type { DelegationStatus } from "./delegations-view";
import { loadUntilGain, reloadPlan, type FeedState } from "./use-delegation-columns";

const row = (id: string, status: DelegationStatus): DelegationItem => ({
  kind: "delegation",
  id,
  status,
  delegate: { id: "0190f5a0-0000-7000-8000-0000000000d1", name: "Anna", email: "anna@example.com", active: true },
  task: null,
  subject: null,
  dueAt: null,
  sentAt: null,
  answeredAt: null,
  remindersSent: 0,
  reminderWaiting: false,
  sendId: null,
});

const many = (prefix: string, status: DelegationStatus, count: number) =>
  Array.from({ length: count }, (_, n) => row(`${prefix}${n}`, status));

const feed = (over: Partial<FeedState> = {}): FeedState => ({ items: [], next: null, pages: 1, error: null, ...over });

// A fake server: the answer of each cursor, and the cursors that were asked.
function fakePages(answers: Record<string, DelegationList>) {
  const asked: string[] = [];
  return {
    asked,
    fetch: async (before: string): Promise<DelegationList> => {
      asked.push(before);
      return answers[before] ?? { items: [], next: null };
    },
  };
}

describe("loadUntilGain", () => {
  test("goes on past a page of the other column and stops at the page that adds a row of the clicked one", async () => {
    const server = fakePages({
      c1: { items: many("d", "drafted", 50), next: "c2" },
      c2: { items: many("s", "sent", 10), next: null },
    });
    const state = await loadUntilGain("sent", feed({ items: [row("first", "drafted")], next: "c1" }), server.fetch);
    expect(server.asked).toEqual(["c1", "c2"]);
    expect(state.items.filter((item) => item.status === "sent")).toHaveLength(10);
    expect(state.items).toHaveLength(61);
    expect(state.next).toBeNull();
    expect(state.pages).toBe(3);
  });

  test("stops after four pages when none adds a row of the clicked column", async () => {
    const server = fakePages({
      c1: { items: many("a", "drafted", 5), next: "c2" },
      c2: { items: many("b", "drafted", 5), next: "c3" },
      c3: { items: many("c", "drafted", 5), next: "c4" },
      c4: { items: many("d", "drafted", 5), next: "c5" },
      c5: { items: many("e", "drafted", 5), next: "c6" },
    });
    const state = await loadUntilGain("sent", feed({ next: "c1" }), server.fetch);
    expect(server.asked).toEqual(["c1", "c2", "c3", "c4"]);
    expect(state.next).toBe("c5");
  });

  test("asks nothing when the first page was the last", async () => {
    const server = fakePages({});
    const start = feed({ items: [row("x", "sent")], next: null });
    expect(await loadUntilGain("drafted", start, server.fetch)).toEqual(start);
    expect(server.asked).toEqual([]);
  });
});

describe("reloadPlan", () => {
  const feeds = {
    open: feed({ pages: 3 }),
    overdue: feed({ pages: 1 }),
    answered: feed({ pages: 2 }),
    closed: feed({ pages: 2 }),
  };

  test("reloads each feed as far as it was loaded and leaves closed out while its list is shut", () => {
    expect(reloadPlan(feeds, false)).toEqual([
      { filter: "open", pages: 3 },
      { filter: "overdue", pages: 1 },
      { filter: "answered", pages: 2 },
    ]);
  });

  test("adds closed while its list is open", () => {
    expect(reloadPlan(feeds, true)).toEqual([
      { filter: "open", pages: 3 },
      { filter: "overdue", pages: 1 },
      { filter: "answered", pages: 2 },
      { filter: "closed", pages: 2 },
    ]);
  });

  test("loads one page of each first feed when nothing was loaded", () => {
    expect(reloadPlan({}, false)).toEqual([
      { filter: "open", pages: 1 },
      { filter: "overdue", pages: 1 },
      { filter: "answered", pages: 1 },
    ]);
  });
});
