import type { WeekStats } from "@ea/core/web";

import { t } from "../../i18n";
import { statsHead, weekLabel } from "../../lib/stats-view";
import { ProgressRing } from "../patterns/ProgressRing";
import { StatTile } from "../patterns/StatTile";
import { Card, CardContent } from "../ui/card";

// The week at a glance: the handled share as a ring and three key numbers, all of the newest week.
export function StatsHead({ week, split }: { week: WeekStats; split: boolean }) {
  const { ring, tiles } = statsHead(week, split);
  return (
    <div data-part="stats-head" className="grid gap-4 lg:grid-cols-[auto_1fr] lg:items-center">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-5">
          <ProgressRing size="lg" value={ring.value} max={ring.max} label={t(ring.label)}>
            <span className="text-3xl">{ring.percent}</span>
          </ProgressRing>
          <div className="flex flex-col gap-1">
            <div className="text-lg font-bold">{t(ring.label)}</div>
            <div className="text-sm text-muted-foreground">
              {t("stats_week_of", { date: weekLabel(week.weekStart) })}
            </div>
          </div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-3">
        {tiles.map((tile) => (
          <StatTile key={tile.label} value={tile.value} label={t(tile.label)} />
        ))}
      </div>
    </div>
  );
}
