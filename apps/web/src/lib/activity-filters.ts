import {
  activityRangeMs,
  activityRanges,
  ACTIVITY_DEFAULT_RANGE,
  categories,
  NEEDS_ACTION_CATEGORIES,
  type ActivityRange,
  type Category,
} from "@ea/core/web";

export interface ActivityFilters {
  mailboxId: string | null;
  category: "all" | "action" | Category;
  range: ActivityRange;
  notRated: boolean;
}

export const DEFAULT_FILTERS: ActivityFilters = {
  mailboxId: null,
  category: "all",
  range: ACTIVITY_DEFAULT_RANGE,
  notRated: false,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isCategoryFilter(value: string): value is ActivityFilters["category"] {
  return value === "all" || value === "action" || (categories as readonly string[]).includes(value);
}

function isRange(value: string): value is ActivityRange {
  return (activityRanges as readonly string[]).includes(value);
}

export function filtersFromSearch(search: string): ActivityFilters {
  const params = new URLSearchParams(search);
  const mailbox = params.get("mailbox");
  const category = params.get("category");
  const range = params.get("range");
  return {
    mailboxId: mailbox !== null && UUID.test(mailbox) ? mailbox : DEFAULT_FILTERS.mailboxId,
    category: category !== null && isCategoryFilter(category) ? category : DEFAULT_FILTERS.category,
    range: range !== null && isRange(range) ? range : DEFAULT_FILTERS.range,
    notRated: params.get("notRated") === "1",
  };
}

export function filtersToSearch(filters: ActivityFilters): string {
  const params = new URLSearchParams();
  if (filters.mailboxId !== null) params.set("mailbox", filters.mailboxId);
  if (filters.category !== DEFAULT_FILTERS.category) params.set("category", filters.category);
  if (filters.range !== DEFAULT_FILTERS.range) params.set("range", filters.range);
  if (filters.notRated) params.set("notRated", "1");
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

export function activityQueryString(filters: ActivityFilters, now: Date, before?: string): string {
  const params = new URLSearchParams();
  params.set("since", new Date(now.getTime() - activityRangeMs[filters.range]).toISOString());
  if (filters.mailboxId !== null) params.set("mailboxId", filters.mailboxId);
  if (filters.category === "action") params.set("categories", NEEDS_ACTION_CATEGORIES.join(","));
  else if (filters.category !== "all") params.set("categories", filters.category);
  if (filters.notRated) params.set("notRated", "true");
  if (before !== undefined) params.set("before", before);
  return `?${params.toString()}`;
}
