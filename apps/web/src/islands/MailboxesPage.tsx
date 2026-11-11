import { formatClock, mailboxListSchema } from "@ea/core/web";
import { useEffect, useState } from "react";

import { AppShell } from "../components/shell/AppShell";
import { useMe } from "../components/shell/MeProvider";
import { ConnectDialog } from "../components/mailboxes/ConnectDialog";
import { MailboxCard } from "../components/mailboxes/MailboxCard";
import { TelegramLink } from "../components/telegram/TelegramLink";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import { t } from "../i18n/en";
import { api } from "../lib/api";
import { useNow } from "../lib/use-now";
import { useResource } from "../lib/use-resource";

function Mailboxes() {
  const { me, reload: reloadMe } = useMe();
  const now = useNow();
  const [lastLoad, setLastLoad] = useState<Date | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const isOwner = me?.role === "owner";
  const { data, error, loading, reload } = useResource(async () => {
    const list = await api("/api/mailboxes", mailboxListSchema);
    setLastLoad(new Date());
    return list;
  });

  // `?connect=1` opens the dialog once; dropping the parameter keeps a reload from reopening it.
  useEffect(() => {
    if (!isOwner) return;
    const params = new URLSearchParams(location.search);
    if (params.get("connect") !== "1") return;
    setConnectOpen(true);
    params.delete("connect");
    const query = params.toString();
    history.replaceState(null, "", `${location.pathname}${query === "" ? "" : `?${query}`}${location.hash}`);
  }, [isOwner]);

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
    content = (
      <div className="flex flex-col items-start gap-3">
        <p className="text-muted-foreground">{t("mb_empty")}</p>
        {isOwner && <Button onClick={() => setConnectOpen(true)}>{t("mb_connect")}</Button>}
      </div>
    );
  } else {
    content = data.map((mailbox) => (
      <MailboxCard
        key={mailbox.id}
        mailbox={mailbox}
        isOwner={isOwner}
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
        <div className="flex gap-2">
          {isOwner && <Button onClick={() => setConnectOpen(true)}>{t("mb_connect")}</Button>}
          <Button variant="outline" onClick={reload}>
            {t("refresh")}
          </Button>
        </div>
      </div>
      {content}
      <Card>
        <CardHeader>
          <CardTitle>{t("tg_title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <TelegramLink timeZone={timeZone} onChange={reloadMe} />
        </CardContent>
      </Card>
      <p className="text-sm text-muted-foreground">{t("mb_scopes_note")}</p>
      {isOwner && <ConnectDialog open={connectOpen} onOpenChange={setConnectOpen} onConnected={onChanged} />}
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
