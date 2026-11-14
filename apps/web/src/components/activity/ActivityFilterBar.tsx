import { activityRanges, categories } from "@ea/core/web";

import { t } from "../../i18n";
import { filtersToSearch, type ActivityFilters } from "../../lib/activity-filters";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";

export interface ActivityFilterBarProps {
  filters: ActivityFilters;
  mailboxes: readonly { id: string; address: string }[]; // the Select shows only with 2 or more
  onChange(next: ActivityFilters): void;
}

const ALL = "all";

export function ActivityFilterBar({ filters, mailboxes, onChange }: ActivityFilterBarProps) {
  const set = (patch: Partial<ActivityFilters>) => {
    const next = { ...filters, ...patch };
    if (filtersToSearch(next) !== filtersToSearch(filters)) onChange(next);
  };

  return (
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
                {t(`act_tag_${category}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="act-filter-range">{t("act_filter_range")}</Label>
        <Select value={filters.range} onValueChange={(value) => set({ range: value as ActivityFilters["range"] })}>
          <SelectTrigger id="act-filter-range">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {activityRanges.map((range) => (
              <SelectItem key={range} value={range}>
                {t(`act_range_${range}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2 pb-2">
        <Switch id="act-filter-not-rated" checked={filters.notRated} onCheckedChange={(on) => set({ notRated: on })} />
        <Label htmlFor="act-filter-not-rated">{t("act_not_rated")}</Label>
      </div>
    </div>
  );
}
