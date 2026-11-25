import { localDateTime, type ActivityItem } from "@ea/core/web";

export interface DayGroup {
  day: string; // YYYY-MM-DD, the local date of `receivedAt`
  label: "today" | "yesterday" | "date";
  items: ActivityItem[];
}

// The day before a local date, from the date parts (never `now` minus 24 hours: a change of the clock makes that day 23 or 25 hours long).
function previousLocalDate(date: string): string {
  const [year, month, day] = [Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10))];
  const before = new Date(Date.UTC(year, month - 1, day - 1));
  return before.toISOString().slice(0, 10);
}

// Groups the items by the local day of the mail. The order of the items does not change: a group starts where the day changes.
export function dayGroups(items: readonly ActivityItem[], timeZone: string, now: Date): DayGroup[] {
  const today = localDateTime(now, timeZone).date;
  const yesterday = previousLocalDate(today);
  const groups: DayGroup[] = [];
  for (const item of items) {
    const day = localDateTime(new Date(item.receivedAt), timeZone).date;
    const last = groups[groups.length - 1];
    if (last !== undefined && last.day === day) {
      last.items.push(item);
      continue;
    }
    groups.push({ day, label: day === today ? "today" : day === yesterday ? "yesterday" : "date", items: [item] });
  }
  return groups;
}
