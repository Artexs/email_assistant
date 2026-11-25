import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { en } from "../../src/i18n/en";
import { expectNoA11yViolations } from "../a11y";
import { cspErrors, nextAddress, signInAs } from "../helpers";
import { readSeed } from "../seed";

// The paging, the error and the empty cases of the delegations page on fake lists of `GET /api/delegations`: the page reads no seeded row,
// so this spec changes no data and runs next to `delegations.spec.ts`, which moves the rows of the same organization.
test.describe.configure({ mode: "serial" });

const project = (): "mobile" | "desktop" => (test.info().project.name === "mobile" ? "mobile" : "desktop");

async function startSession(context: BrowserContext, page: Page) {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": nextAddress(project() === "mobile" ? 700 : 760) });
  const errors = await cspErrors(page);
  await signInAs(page, readSeed().delegationsOrgs[project()].owner);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return errors;
}

// The line of the result: the page announces the result here and moves the focus to it after an action.
const status = (page: Page) => page.locator('[role="status"][tabindex="-1"]');

// The columns of the page, by the title of their heading; the closed list is named like its heading too.
const COLUMN_TITLES = {
  overdue: en.dgn_col_overdue,
  drafted: en.dgn_col_drafted,
  sent: en.dgn_col_sent,
  answered: en.dgn_col_answered,
  closed: en.dgn_col_closed,
} as const;
type Group = keyof typeof COLUMN_TITLES;
const headingOf = (page: Page, group: Group) =>
  page.getByRole("heading", { level: 2, name: COLUMN_TITLES[group], exact: true });
const cardsOf = (page: Page, group: Group) =>
  page.getByRole("list", { name: COLUMN_TITLES[group], exact: true }).getByRole("listitem");
const closedButton = (page: Page) => page.getByRole("button", { name: en.dgn_closed_show });
async function showClosed(page: Page) {
  await closedButton(page).click();
  await expect(headingOf(page, "closed")).toBeVisible();
}

// A fake of `GET /api/delegations`: the answer of each list and cursor. A list or cursor that the table does not name answers an empty page.
interface FeedPage {
  items: ReturnType<typeof fakeItem>[];
  next: string | null;
}
type Feeds = Partial<Record<"open" | "overdue" | "answered" | "closed", Record<string, FeedPage>>>;
const fakeItem = (n: number, status: "drafted" | "sent" | "overdue" | "answered" | "done") => ({
  kind: "delegation",
  id: `0190f5a0-0000-7000-8000-${String(n).padStart(12, "0")}`,
  status,
  delegate: {
    id: "0190f5a0-0000-7000-8000-0000000000d1",
    name: `Paged ${n}`,
    email: `paged${n}@example.com`,
    active: true,
  },
  task: `Paged task ${n}`,
  subject: null,
  dueAt: null,
  sentAt: null,
  answeredAt: null,
  remindersSent: 0,
  reminderWaiting: false,
  sendId: null,
});
// The cursor of the first page is "".
async function fakeFeeds(page: Page, table: { current: Feeds }): Promise<string[]> {
  const requests: string[] = [];
  await page.route(/\/api\/delegations\?/, (route) => {
    const url = new URL(route.request().url());
    const filter = url.searchParams.get("filter") as keyof Feeds;
    const before = url.searchParams.get("before") ?? "";
    requests.push(`${filter}:${before}`);
    const answer = table.current[filter]?.[before] ?? { items: [], next: null };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(answer) });
  });
  return requests;
}
const columnBox = (page: Page, group: Group) =>
  page.locator('[data-slot="delegation-column"]').filter({ has: headingOf(page, group) });
const paged = (page: Page, group: Group, n: number) => cardsOf(page, group).filter({ hasText: `Paged task ${n}` });

test("Show more of the answered column and of the closed list loads the next page with the cursor and focuses the first new card", async ({
  context,
  page,
}) => {
  await startSession(context, page);
  const table = {
    current: {
      answered: {
        "": { items: [fakeItem(1, "answered"), fakeItem(2, "answered")], next: "cursor-2" },
        "cursor-2": { items: [fakeItem(3, "answered"), fakeItem(4, "answered")], next: null },
      },
      closed: {
        "": { items: [fakeItem(11, "done"), fakeItem(12, "done")], next: "cursor-c2" },
        "cursor-c2": { items: [fakeItem(13, "done")], next: null },
      },
    } as Feeds,
  };
  const requests = await fakeFeeds(page, table);
  await page.goto("/delegations");
  await expect(cardsOf(page, "answered")).toHaveCount(2);
  // The count shows `+` while the list has more pages; the other columns are empty and ended.
  await expect(columnBox(page, "answered")).toContainText("2+");
  await expect(columnBox(page, "sent")).toContainText(en.dgn_col_empty_sent);
  await columnBox(page, "answered").getByRole("button", { name: en.dgn_more }).click();
  await expect(cardsOf(page, "answered")).toHaveCount(4);
  await expect(columnBox(page, "answered").getByRole("button", { name: en.dgn_more })).toHaveCount(0);
  await expect(paged(page, "answered", 3)).toBeFocused();
  await expect(columnBox(page, "answered")).not.toContainText("+");
  // No subject and no due date show words.
  await expect(paged(page, "answered", 3)).toContainText(`${en.dgn_subject}: ${en.dgn_no_subject}`);
  await expect(paged(page, "answered", 3)).toContainText(en.dgn_no_due);
  expect(requests.filter((request) => request.startsWith("answered"))).toEqual(["answered:", "answered:cursor-2"]);
  // The closed list pages on its own cursor, and loads only after it opens.
  expect(requests.some((request) => request.startsWith("closed"))).toBe(false);
  await showClosed(page);
  await expect(cardsOf(page, "closed")).toHaveCount(2);
  await columnBox(page, "closed").getByRole("button", { name: en.dgn_more }).click();
  await expect(cardsOf(page, "closed")).toHaveCount(3);
  await expect(paged(page, "closed", 13)).toBeFocused();
  expect(requests.filter((request) => request.startsWith("closed"))).toEqual(["closed:", "closed:cursor-c2"]);
});

test("drafted and sent share one cursor: Show more loads on until its column gains a card, the end of the list or the page limit", async ({
  context,
  page,
}) => {
  await startSession(context, page);
  const table = { current: {} as Feeds };
  const requests = await fakeFeeds(page, table);
  const sentMore = () => columnBox(page, "sent").getByRole("button", { name: en.dgn_more });

  // The sent card is on the third page: two calls, then the focus is on it, and the drafted column kept what the first call loaded.
  table.current = {
    open: {
      "": { items: [fakeItem(1, "drafted"), fakeItem(2, "drafted")], next: "o2" },
      o2: { items: [fakeItem(3, "drafted")], next: "o3" },
      o3: { items: [fakeItem(4, "sent")], next: null },
    },
  };
  await page.goto("/delegations");
  await expect(cardsOf(page, "drafted")).toHaveCount(2);
  await expect(columnBox(page, "sent")).toContainText("0+");
  await sentMore().click();
  await expect(paged(page, "sent", 4)).toBeFocused();
  await expect(cardsOf(page, "drafted")).toHaveCount(3);
  expect(requests.filter((request) => request.startsWith("open:"))).toEqual(["open:", "open:o2", "open:o3"]);

  // Four pages with no sent card: the text says to press again, and the focus stays on the button.
  requests.length = 0;
  const pages: Record<string, FeedPage> = { "": { items: [fakeItem(21, "drafted")], next: "p2" } };
  for (let n = 2; n <= 6; n += 1) pages[`p${n}`] = { items: [fakeItem(20 + n, "drafted")], next: `p${n + 1}` };
  table.current = { open: pages };
  await page.goto("/delegations");
  await expect(cardsOf(page, "drafted")).toHaveCount(1);
  await sentMore().click();
  await expect(columnBox(page, "sent")).toContainText(en.dgn_col_capped);
  await expect(cardsOf(page, "drafted")).toHaveCount(5);
  await expect(sentMore()).toBeFocused();
  expect(requests.filter((request) => request.startsWith("open:p"))).toEqual([
    "open:p2",
    "open:p3",
    "open:p4",
    "open:p5",
  ]);

  // The list ends with no sent card: the status line says so and takes the focus.
  table.current = {
    open: {
      "": { items: [fakeItem(31, "drafted")], next: "q2" },
      q2: { items: [fakeItem(32, "drafted")], next: null },
    },
  };
  await page.goto("/delegations");
  await expect(cardsOf(page, "drafted")).toHaveCount(1);
  await sentMore().click();
  await expect(status(page)).toContainText(en.dgn_col_no_more);
  await expect(status(page)).toBeFocused();
  await expect(sentMore()).toHaveCount(0);
  await expect(columnBox(page, "sent")).toContainText(en.dgn_col_empty_sent);
});

test("a list that fails shows Retry in its own column only; the other columns keep their cards", async ({
  context,
  page,
}) => {
  await startSession(context, page);
  const table = {
    current: {
      open: { "": { items: [fakeItem(1, "sent")], next: null } },
      overdue: { "": { items: [fakeItem(2, "overdue"), fakeItem(3, "overdue")], next: null } },
      answered: { "": { items: [fakeItem(4, "answered")], next: null } },
    } as Feeds,
  };
  await fakeFeeds(page, table);
  let failing = true;
  // The route that was added last answers first; `fallback` hands the request on to the fake lists.
  await page.route(/\/api\/delegations\?.*filter=answered/, (route) =>
    failing
      ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "internal" }) })
      : route.fallback()
  );
  await page.goto("/delegations");
  await expect(paged(page, "sent", 1)).toBeVisible();
  await expect(cardsOf(page, "overdue")).toHaveCount(2);
  const retry = columnBox(page, "answered").getByRole("button", { name: en.retry });
  await expect(retry).toBeVisible();
  await expect(columnBox(page, "answered")).toContainText(en.dgn_load_error);
  await expect(page.getByRole("button", { name: en.retry })).toHaveCount(1);
  await expect(page.getByText(en.dgn_load_error)).toHaveCount(1);
  failing = false;
  await retry.click();
  await expect(paged(page, "answered", 4)).toBeVisible();
  await expect(page.getByRole("button", { name: en.retry })).toHaveCount(0);
});

test("no delegation in any column shows one empty state; the closed list still has its button", async ({
  context,
  page,
}) => {
  await startSession(context, page);
  await fakeFeeds(page, { current: {} });
  await page.goto("/delegations");
  await expect(page.getByRole("heading", { level: 2, name: en.dgn_none_title })).toBeVisible();
  await expect(page.getByText(en.dgn_none_text)).toBeVisible();
  await expect(headingOf(page, "sent")).toHaveCount(0);
  await expect(closedButton(page)).toBeVisible();
  await expectNoA11yViolations(page);
});
