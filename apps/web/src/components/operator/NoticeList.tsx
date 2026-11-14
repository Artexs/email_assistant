import type { OperatorNotices } from "@ea/core/web";

import { dateLocale, t } from "../../i18n";
import { shortId, sortNotices } from "../../lib/operator-view";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

export const noticeDays = [1, 7, 30] as const;
export type NoticeDays = (typeof noticeDays)[number];

const dayTexts = { 1: "op_days_1", 7: "op_days_7", 30: "op_days_30" } as const;

export interface NoticeListProps {
  notices: OperatorNotices["notices"];
  days: NoticeDays;
  onDays(days: NoticeDays): void;
}

export function NoticeList({ notices, days, onDays }: NoticeListProps) {
  const format = new Intl.DateTimeFormat(dateLocale(), { dateStyle: "short", timeStyle: "medium", timeZone: "UTC" });
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-3">
        <CardTitle>{t("op_notices_title")}</CardTitle>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="op-notice-days">{t("op_days_label")}</Label>
          <Select
            value={String(days)}
            onValueChange={(value) => {
              const next = noticeDays.find((day) => String(day) === value);
              if (next !== undefined) onDays(next);
            }}
          >
            <SelectTrigger id="op-notice-days">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {noticeDays.map((day) => (
                <SelectItem key={day} value={String(day)}>
                  {t(dayTexts[day])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {notices.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("op_notices_empty")}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {sortNotices(notices).map((notice) => (
              <li key={`${notice.at}:${notice.orgId}:${notice.key}`} className="font-mono">
                {t("op_notice_line", {
                  when: format.format(new Date(notice.at)),
                  org: shortId(notice.orgId),
                  kind: notice.kind,
                  key: notice.key,
                })}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
