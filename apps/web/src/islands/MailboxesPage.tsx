import { formatClock, mailboxListSchema } from "@ea/core/web";
import { Inbox, Plus, Send } from "lucide-react";
import { useEffect, useState } from "react";

import { AppShell } from "../components/shell/AppShell";
import { useMe } from "../components/shell/MeProvider";
import { ConnectDialog } from "../components/mailboxes/ConnectDialog";
import { OAuthResultBanner } from "../components/mailboxes/OAuthBanner";
import { MailboxCard } from "../components/mailboxes/MailboxCard";
import { EmptyState } from "../components/patterns/EmptyState";
import { FactBox } from "../components/patterns/FactBox";
import { SectionCard } from "../components/patterns/SectionCard";
import { TelegramLink } from "../components/telegram/TelegramLink";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { getLocale, t, useLocale } from "../i18n";
import { api } from "../lib/api";
import { canWrite } from "../lib/can-write";
import { takeOAuthBanner, type OAuthBanner } from "../lib/mail-oauth";
import { useNow } from "../lib/use-now";
import { useResource } from "../lib/use-resource";

// Edit right: the owner of an organization that is not paused. No text here depends on the role alone.
function useIsOwner(): boolean {
  const { me } = useMe();
  return me?.role === "owner" && canWrite(me);
}

// The one action of the page head: the shell renders it inside its own provider, so it reads the role itself.
function ConnectAction({ onOpen }: { onOpen: () => void }) {
  if (!useIsOwner()) return null;
  return (
    <Button onClick={onOpen}>
      <Plus aria-hidden="true" />
      {t("mb_connect")}
    </Button>
  );
}

interface MailboxesProps {
  connectOpen: boolean;
  setConnectOpen: (open: boolean) => void;
}

function Mailboxes({ connectOpen, setConnectOpen }: MailboxesProps) {
  const { me, reload: reloadMe } = useMe();
  const now = useNow();
  const [lastLoad, setLastLoad] = useState<Date | null>(null);
  const [banner, setBanner] = useState<OAuthBanner | null>(null);
  const isOwner = useIsOwner();
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
  }, [isOwner, setConnectOpen]);

  // `?oauth=<code>` is the result of a sign-in (the callback redirect). Read it once, show it, then drop `oauth`, `mailbox` and
  // `provider` from the address so a reload shows no banner again. The list reloads on its own: this page loads it after the redirect.
  useEffect(() => {
    const found = takeOAuthBanner({ location, history });
    if (found !== null) setBanner(found);
  }, []);

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
        <div aria-busy="true" className="grid gap-3 lg:grid-cols-2">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <p>{t("mb_load_error")}</p>
          <Button onClick={reload}>{t("retry")}</Button>
        </div>
      );
  } else if (data.length === 0) {
    content = (
      <EmptyState icon={Inbox} title={t("mb_empty")}>
        {isOwner && <Button onClick={() => setConnectOpen(true)}>{t("mb_connect")}</Button>}
      </EmptyState>
    );
  } else {
    content = (
      <div className="grid gap-3 lg:grid-cols-2">
        {data.map((mailbox) => (
          <MailboxCard
            key={mailbox.id}
            mailbox={mailbox}
            isOwner={isOwner}
            timeZone={timeZone}
            now={now}
            onChanged={onChanged}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {lastLoad !== null && t("updated_at", { time: formatClock(lastLoad, timeZone, now, getLocale()) })}
        </p>
        <Button variant="outline" onClick={reload}>
          {t("refresh")}
        </Button>
      </div>
      {banner !== null && <OAuthResultBanner banner={banner} onClose={() => setBanner(null)} />}
      {content}
      <SectionCard icon={Send} title={t("tg_title")}>
        <TelegramLink timeZone={timeZone} onChange={reloadMe} />
      </SectionCard>
      <FactBox>
        <p className="text-sm">{t("mb_scopes_note")}</p>
      </FactBox>
      {isOwner && (
        <ConnectDialog
          open={connectOpen}
          onOpenChange={setConnectOpen}
          onConnected={onChanged}
          sentSyncLine={me.features.includes("sent_sync")}
        />
      )}
    </div>
  );
}

export default function MailboxesPage() {
  useLocale();
  // The dialog opens from the page head (inside the shell) and from the empty state: its state lives above both.
  const [connectOpen, setConnectOpen] = useState(false);
  return (
    <AppShell
      active="mailboxes"
      title="title_mailboxes"
      lead="mb_lead"
      action={<ConnectAction onOpen={() => setConnectOpen(true)} />}
    >
      <Mailboxes connectOpen={connectOpen} setConnectOpen={setConnectOpen} />
    </AppShell>
  );
}
