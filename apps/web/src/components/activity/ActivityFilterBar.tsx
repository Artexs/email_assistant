import { activityRanges, categories } from "@ea/core/web";

import { t } from "../../i18n";
import { filtersToSearch, type ActivityFilters } from "../../lib/activity-filters";
import { FilterChips } from "../patterns/FilterChips";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

export interface ActivityFilterBarProps {
  filters: ActivityFilters;
  mailboxes: readonly { id: string; address: string }[]; // the Select shows only with 2 or more
  onChange(next: ActivityFilters): void;
}

const ALL = "all";
const NOT_RATED = "notRated";

export function ActivityFilterBar({ filters, mailboxes, onChange }: ActivityFilterBarProps) {
  const set = (patch: Partial<ActivityFilters>) => {
    const next = { ...filters, ...patch };
    if (filtersToSearch(next) !== filtersToSearch(filters)) onChange(next);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <FilterChips
          label={t("act_filter_range")}
          options={activityRanges.map((range) => ({ value: range, label: t(`act_range_${range}`) }))}
          value={[filters.range]}
          onChange={([range]) => range !== undefined && set({ range })}
          single
        />
        <FilterChips
          label={t("act_not_rated")}
          options={[{ value: NOT_RATED, label: t("act_not_rated") }]}
          value={filters.notRated ? [NOT_RATED] : []}
          onChange={(next) => set({ notRated: next.length > 0 })}
        />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {mailboxes.length >= 2 && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="act-filter-mailbox">{t("act_filter_mailbox")}</Label>
            <Select
              value={filters.mailboxId ?? ALL}
              onValueChange={(value) => set({ mailboxId: value === ALL ? null : value })}
            >
              <SelectTrigger id="act-filter-mailbox">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("act_all_mailboxes")}</SelectItem>
                {mailboxes.map((mailbox) => (
                  <SelectItem key={mailbox.id} value={mailbox.id}>
                    {mailbox.address}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="act-filter-category">{t("act_filter_category")}</Label>
          <Select
            value={filters.category}
            onValueChange={(value) => set({ category: value as ActivityFilters["category"] })}
          >
            <SelectTrigger id="act-filter-category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("act_all_categories")}</SelectItem>
              <SelectItem value="action">{t("act_needs_action")}</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category} value={category}>
                  {t(`act_cat_${category}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
