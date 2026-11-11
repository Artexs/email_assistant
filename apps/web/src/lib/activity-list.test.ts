import { describe, expect, test } from "bun:test";
import type { ActivityItem, ActivityWebPage } from "@ea/core/web";

import {
  appendOlder,
  compareKey,
  firstPage,
  INITIAL_LIST,
  mergePolled,
  patchItem,
  startLoadMore,
} from "./activity-list";

const AT = new Date("2026-11-11T12:00:00.000Z");
const MAILBOX = "6f1d6f2e-8a3b-4c5d-9e7f-0123456789ab";

function id(n: string): string {
  return `00000000-0000-4000-8000-00000000000${n}`;
}

// `minute`: larger = newer.
function item(n: string, minute: number): ActivityItem {
  return {
    emailId: id(n),
    mailboxId: MAILBOX,
    receivedAt: new Date(Date.UTC(2026, 10, 11, 10, minute)).toISOString(),
    triagedAt: AT.toISOString(),
    from: null,
    subject: null,
    category: "info",
    confidence: 0.9,
    modelCategory: null,
    aiText: null,
    phrase: "stays in INBOX",
    actions: [],
    undoable: false,
    undoPending: false,
    feedback: null,
    delegation: null,
  };
}

function page(items: ActivityItem[], nextBefore: string | null = null): ActivityWebPage {
  return { items, nextBefore };
}

function ids(items: ActivityItem[]): string[] {
  return items.map((i) => i.emailId.slice(-1));
}

const A = item("1", 50);
const B = item("2", 40);
const C = item("3", 30);
const D = item("4", 20);
const E = item("5", 10);
const F = item("6", 5);
const N = item("7", 55);

// First page A..C, older D..F loaded.
const withOlder = appendOlder({ ...firstPage(page([A, B, C], "X"), AT) }, page([D, E, F]), "X");

describe("mergePolled", () => {
  test("without older pages it equals firstPage", () => {
    const state = firstPage(page([A, B, C], "X"), AT);
    const later = new Date(AT.getTime() + 30_000);
    expect(mergePolled(state, page([N, A, B], "Y"), later)).toEqual(firstPage(page([N, A, B], "Y"), later));
  });

  test("older pages: a new mail comes first and the dropped one stays", () => {
    expect(withOlder.olderLoaded).toBe(true);
    const merged = mergePolled(withOlder, page([N, A, B], "Y"), AT);
    expect(ids(merged.items)).toEqual(["7", "1", "2", "3", "4", "5", "6"]);
    expect(merged.nextBefore).toBe(withOlder.nextBefore);
  });

  test("a changed first-page item replaces the old one with no duplicate", () => {
    const changed = {
      ...A,
      feedback: { verdict: "right", trueCategory: "info", source: "web", at: AT.toISOString() },
    } as ActivityItem;
    const merged = mergePolled(withOlder, page([changed, B, C]), AT);
    expect(ids(merged.items)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(merged.items[0]?.feedback).not.toBeNull();
  });

  test("equal receivedAt sorts by id descending and keeps both once", () => {
    const a = { ...item("1", 50), emailId: id("a") };
    const b = { ...item("1", 50), emailId: id("b") };
    expect(compareKey(b, a)).toBeLessThan(0);
    const state = appendOlder(firstPage(page([b, a], "X"), AT), page([D]), "X");
    const merged = mergePolled(state, page([b, a]), AT);
    expect(merged.items.map((i) => i.emailId.slice(-1))).toEqual(["b", "a", "4"]);
  });

  test("an empty poll with older pages gives an empty first page", () => {
    const merged = mergePolled(withOlder, page([]), AT);
    expect(merged.items).toEqual([]);
    expect(merged.nextBefore).toBeNull();
    expect(merged.olderLoaded).toBe(false);
  });
});

describe("appendOlder and patchItem", () => {
  test("appendOlder skips an id that is in the list", () => {
    const state = firstPage(page([A, B], "X"), AT);
    const next = appendOlder(state, page([B, C]), "X");
    expect(ids(next.items)).toEqual(["1", "2", "3"]);
    expect(next.nextBefore).toBeNull();
  });

  test("patchItem changes only the target; an unknown id returns the same object", () => {
    const state = firstPage(page([A, B]), AT);
    const patched = patchItem(state, B.emailId, { undoable: true });
    expect(patched.items[0]).toBe(A);
    expect(patched.items[1]?.undoable).toBe(true);
    expect(patchItem(state, id("9"), { undoable: true })).toBe(state);
  });
});

describe("load more with a poll or a refresh", () => {
  test("a poll during load more keeps the cursor and the loading flag", () => {
    const started = startLoadMore(firstPage(page([A, B, C], "X"), AT));
    expect(started?.cursor).toBe("X");
    expect(started?.state.loadingMore).toBe(true);
    if (!started) throw new Error("unreachable");
    expect(startLoadMore(started.state)).toBeNull();
    const polled = mergePolled(started.state, page([N, A, B], "Y"), AT);
    expect(polled.nextBefore).toBe("X");
    expect(polled.loadingMore).toBe(true);
    expect(ids(polled.items)).toEqual(["7", "1", "2", "3"]);
    const done = appendOlder(polled, page([D, E, F]), "X");
    expect(ids(done.items)).toEqual(["7", "1", "2", "3", "4", "5", "6"]);
    expect(done.loadingMore).toBe(false);
  });

  test("a refresh during load more drops the older page", () => {
    const started = startLoadMore(firstPage(page([A, B, C], "X"), AT));
    if (!started) throw new Error("unreachable");
    const refreshed = { ...firstPage(page([N, A], "Y"), AT), loadingMore: true };
    const done = appendOlder(refreshed, page([D, E]), "X");
    expect(ids(done.items)).toEqual(["7", "1"]);
    expect(done.loadingMore).toBe(false);
    expect(done.nextBefore).toBe("Y");
  });

  test("nothing to load without a cursor", () => {
    expect(startLoadMore(INITIAL_LIST)).toBeNull();
  });
});
