import type { DelegationItem } from "@ea/core/web";
import { afterEach, describe, expect, test } from "bun:test";

import { loadPages } from "./use-delegation-columns";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const item = (n: number): DelegationItem => ({
  kind: "delegation",
  id: `0190f5a0-0000-7000-8000-${String(n).padStart(12, "0")}`,
  status: "sent",
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

// A fake server of three pages: the cursor of page n is `c<n>`.
function fakeServer(): string[] {
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://x");
    urls.push(`${url.pathname}?${url.searchParams.toString()}`);
    const before = url.searchParams.get("before");
    const body =
      before === null
        ? { items: [item(1), item(2)], next: "c2" }
        : before === "c2"
          ? { items: [item(2), item(3)], next: "c3" }
          : { items: [item(4)], next: null };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return urls;
}

describe("loadPages", () => {
  test("one page asks once, with the filter and no cursor", async () => {
    const urls = fakeServer();
    const loaded = await loadPages("closed", 1);
    expect(urls).toEqual(["/api/delegations?filter=closed"]);
    expect(loaded.filter).toBe("closed");
    expect(loaded.items.map((x) => x.id.slice(-1))).toEqual(["1", "2"]);
    expect(loaded.next).toBe("c2");
  });

  test("the pages that the user loaded are loaded again in order, each with the cursor of the page before", async () => {
    const urls = fakeServer();
    const loaded = await loadPages("open", 2);
    expect(urls).toEqual(["/api/delegations?filter=open", "/api/delegations?filter=open&before=c2"]);
    // The delegation that sits on two pages shows once.
    expect(loaded.items.map((x) => x.id.slice(-1))).toEqual(["1", "2", "3"]);
    expect(loaded.next).toBe("c3");
  });

  test("it stops at the last page, however many pages it was asked for", async () => {
    const urls = fakeServer();
    const loaded = await loadPages("open", 9);
    expect(urls).toHaveLength(3);
    expect(loaded.next).toBeNull();
    expect(loaded.items).toHaveLength(4);
  });
});
