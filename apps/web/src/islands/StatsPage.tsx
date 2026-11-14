import { mailboxListSchema, statsResponseSchema, type WeekStats } from "@ea/core/web";
import { useEffect, useState } from "react";

import { AppShell } from "../components/shell/AppShell";
import { StatsTable } from "../components/stats/StatsTable";
import { Card, CardContent } from "../components/ui/card";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Skeleton } from "../components/ui/skeleton";
import { t, useLocale } from "../i18n";
import { api, ApiError } from "../lib/api";
import { useReloadOn } from "../lib/use-reload-on";
import { useResource } from "../lib/use-resource";

const ALL = "all";

// `weeks` is null when the API answered 404 for a mailbox id (the mailbox is gone or is not the user's).
interface Loaded {
  mailboxId: string | null;
  weeks: readonly WeekStats[] | null;
}

async function loadStats(mailboxId: string | null): Promise<Loaded> {
  try {
    const answer = await api(
      `/api/stats?weeks=8${mailboxId === null ? "" : `&mailboxId=${mailboxId}`}`,
      statsResponseSchema
    );
    return { mailboxId, weeks: answer.weeks };
  } catch (error) {
    if (mailboxId !== null && error instanceof ApiError && error.status === 404) return { mailboxId, weeks: null };
    throw error;
  }
}

function Loading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
    </div>
  );
}

function Stats() {
  const [mailboxId, setMailboxId] = useState<string | null>(null);
  const [mailboxGone, setMailboxGone] = useState(false);
  const mailboxes = useResource(() => api("/api/mailboxes", mailboxListSchema), { pollMs: 0 });
  // The numbers change once a week: one load per choice, no polling.
  const stats = useResource(() => loadStats(mailboxId), { pollMs: 0 });
  useReloadOn(mailboxId, stats.reload);

  // The loaded numbers count only for the mailbox that is chosen now.
  const loaded = stats.data !== null && stats.data.mailboxId === mailboxId ? stats.data : null;
  const gone = loaded !== null && loaded.weeks === null;
  useEffect(() => {
    if (!gone) return;
    setMailboxId(null);
    setMailboxGone(true);
  }, [gone]);

  // The flag is off: the API answers like for an unknown path.
  if (!stats.loading && stats.error instanceof ApiError && stats.error.status === 404) {
    return (
      <Card>
        <CardContent>
          <p className="text-muted-foreground">{t("stats_off")}</p>
        </CardContent>
      </Card>
    );
  }

  const list = mailboxes.data ?? [];
  let content;
  if (loaded !== null && loaded.weeks !== null) {
    content =
      loaded.weeks.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("stats_empty")}</p>
      ) : (
        <StatsTable weeks={loaded.weeks} />
      );
  } else if (!stats.loading && !gone && stats.error !== null) {
    content = <p>{t("stats_load_error")}</p>;
  } else {
    content = <Loading />;
  }

  const onChoose = (value: string) => {
    setMailboxGone(false);
    setMailboxId(value === ALL ? null : value);
  };

  return (
    <div className="flex flex-col gap-4">
      {list.length >= 2 && (
        <div className="flex max-w-xs flex-col gap-1.5">
          <Label htmlFor="stats-mailbox">{t("stats_mailbox_label")}</Label>
          <Select value={mailboxId ?? ALL} onValueChange={onChoose}>
            <SelectTrigger id="stats-mailbox">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("stats_all_mailboxes")}</SelectItem>
              {list.map((mailbox) => (
                <SelectItem key={mailbox.id} value={mailbox.id}>
                  {mailbox.address}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {mailboxGone && <p className="text-sm">{t("stats_mailbox_gone")}</p>}
      {content}
      <p className="text-sm text-muted-foreground">{t("stats_note")}</p>
    </div>
  );
}

export default function StatsPage() {
  useLocale();
  return (
    <AppShell active="stats" title="title_stats">
      <Stats />
    </AppShell>
  );
}
