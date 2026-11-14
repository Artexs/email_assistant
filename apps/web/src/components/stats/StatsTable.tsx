import type { WeekStats } from "@ea/core/web";

import { t } from "../../i18n";
import { statsRows, weekLabel } from "../../lib/stats-view";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

export function StatsTable({ weeks }: { weeks: readonly WeekStats[] }) {
  const rows = statsRows(weeks);
  return (
    <Table>
      <TableCaption className="sr-only">{t("stats_caption")}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>{t("stats_metric_col")}</TableHead>
          {weeks.map((week) => (
            <TableHead key={week.weekStart} className="text-right">
              {weekLabel(week.weekStart)}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.label}>
            <TableHead scope="row" className="whitespace-normal font-normal">
              {t(row.label)}
            </TableHead>
            {row.cells.map((cell, index) => (
              <TableCell key={weeks[index]?.weekStart ?? index} className="text-right tabular-nums">
                {cell.text}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
