import { formatClock, mailboxListSchema } from "@ea/core/web";
import { useState } from "react";

import { AppShell } from "../components/shell/AppShell";
import { useMe } from "../components/shell/MeProvider";
import { MailboxCard } from "../components/mailboxes/MailboxCard";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { t } from "../i18n/en";
import { api } from "../lib/api";
import { useNow } from "../lib/use-now";
import { useResource } from "../lib/use-resource";

function Mailboxes() {
  const { me, reload: reloadMe } = useMe();
  const now = useNow();
  const [lastLoad, setLastLoad] = useState<Date | null>(null);
  const { data, error, loading, reload } = useResource(async () => {
    const list = await api("/api/mailboxes", mailboxListSchema);
    setLastLoad(new Date());
    return list;
  });

  if (me === null) return null;
  const timeZone = me.organization.timezone;

  const onChanged = () => {
    reload();
    reloadMe();
  };

  let content;
  if (data === null) {
    content =
      error === null || loading ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <p>{t("mb_load_error")}</p>
          <Button onClick={reload}>{t("retry")}</Button>
        </div>
      );
  } else if (data.length === 0) {
    content = <p className="text-muted-foreground">{t("mb_empty")}</p>;
  } else {
    content = data.map((mailbox) => (
      <MailboxCard
        key={mailbox.id}
        mailbox={mailbox}
        isOwner={me.role === "owner"}
        timeZone={timeZone}
        now={now}
        onChanged={onChanged}
      />
    ));
  }

  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {lastLoad !== null && t("updated_at", { time: formatClock(lastLoad, timeZone, now) })}
        </p>
        <Button variant="outline" onClick={reload}>
          {t("refresh")}
        </Button>
      </div>
      {content}
    </div>
  );
}

export default function MailboxesPage() {
  return (
    <AppShell active="mailboxes" title="title_mailboxes">
      <Mailboxes />
    </AppShell>
  );
}
