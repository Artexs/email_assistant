import { mailboxListSchema, settingsViewSchema, type MailboxView, type SettingsWebChange } from "@ea/core/web";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "../components/shell/AppShell";
import { useMe } from "../components/shell/MeProvider";
import { ScopeBadges } from "../components/mailboxes/ScopeBadges";
import { StatusBadge } from "../components/mailboxes/StatusBadge";
import { MailboxSelector } from "../components/settings/MailboxSelector";
import { CategoriesCard } from "../components/settings/CategoriesCard";
import { ModeCard } from "../components/settings/ModeCard";
import { SyncFoldersCard } from "../components/settings/SyncFoldersCard";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { t, type TextKey } from "../i18n/en";
import { api, ApiError } from "../lib/api";
import { selectedMailboxId, settingsPath } from "../lib/settings-api";
import { useResource } from "../lib/use-resource";

interface MailboxSettingsProps {
  mailbox: MailboxView;
  isOwner: boolean;
  reloadMailboxes(): void;
  reloadMe(): void;
}

function MailboxSettings({ mailbox, isOwner, reloadMailboxes, reloadMe }: MailboxSettingsProps) {
  const { data, error, loading, reload, mutate } = useResource(() => api(settingsPath(mailbox.id), settingsViewSchema));

  // A 404 on the settings means the mailbox is gone (removed in another tab): the list decides what is selected.
  const missing = error instanceof ApiError && error.status === 404;
  useEffect(() => {
    if (missing) reloadMailboxes();
  }, [missing, reloadMailboxes]);

  if (data === null) {
    return error === null || loading || missing ? (
      <div aria-busy="true" className="flex flex-col gap-3">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    ) : (
      <div className="flex flex-col items-start gap-3">
        <p>{t("set_load_error")}</p>
        <Button onClick={reload}>{t("retry")}</Button>
      </div>
    );
  }

  const onChanged = (change: SettingsWebChange, toastKey: TextKey, vars?: Record<string, string | number>) => {
    mutate(change.settings);
    if (change.settings.mode !== data.mode) reloadMe();
    reloadMailboxes();
    const suffix = change.expired > 0 ? ` ${t("expired_suffix", { count: change.expired })}` : "";
    toast.success(`${t(toastKey, vars)}${suffix}`);
  };

  return (
    <>
      <ModeCard mailbox={mailbox} settings={data} isOwner={isOwner} onChanged={onChanged} onMissing={reloadMailboxes} />
      <CategoriesCard settings={data} isOwner={isOwner} onChanged={onChanged} onMissing={reloadMailboxes} />
      <SyncFoldersCard settings={data} isOwner={isOwner} onChanged={onChanged} onMissing={reloadMailboxes} />
    </>
  );
}

function Settings() {
  const { me, reload: reloadMe } = useMe();
  const [selected, setSelected] = useState<string | null>(null);
  const { data, error, loading, reload } = useResource(() => api("/api/mailboxes", mailboxListSchema));
  const isOwner = me?.role === "owner";

  // After each list load the selection must be a listed id (the first load reads `?mailbox=`).
  useEffect(() => {
    if (data === null) return;
    const query = selected === null ? new URLSearchParams(location.search).get("mailbox") : selected;
    const next = selectedMailboxId(data, query);
    if (next === selected) return;
    setSelected(next);
    const params = new URLSearchParams(location.search);
    if (next === null) params.delete("mailbox");
    else params.set("mailbox", next);
    const search = params.toString();
    history.replaceState(null, "", `${location.pathname}${search === "" ? "" : `?${search}`}${location.hash}`);
  }, [data, selected]);

  if (me === null) return null;

  const choose = (id: string) => {
    setSelected(id);
    const params = new URLSearchParams(location.search);
    params.set("mailbox", id);
    history.replaceState(null, "", `${location.pathname}?${params.toString()}${location.hash}`);
  };

  const mailbox = data?.find((item) => item.id === selected) ?? null;

  let content;
  if (data === null) {
    content =
      error === null || loading ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <p>{t("set_load_error")}</p>
          <Button onClick={reload}>{t("retry")}</Button>
        </div>
      );
  } else if (mailbox === null) {
    content = (
      <div className="flex flex-col items-start gap-3">
        <p className="text-muted-foreground">{t("set_no_mailbox")}</p>
        <Button asChild variant="outline">
          <a href="/mailboxes">{t("set_open_mailboxes")}</a>
        </Button>
      </div>
    );
  } else {
    content = (
      <>
        {!isOwner && <p className="text-sm text-muted-foreground">{t("set_owner_only")}</p>}
        <MailboxSelector mailboxes={data} value={mailbox.id} onChange={choose} />
        <div className="flex flex-wrap items-start gap-2">
          <StatusBadge status={mailbox.status} />
          <ScopeBadges scopes={mailbox.scopes} />
        </div>
        <MailboxSettings
          key={mailbox.id}
          mailbox={mailbox}
          isOwner={isOwner}
          reloadMailboxes={reload}
          reloadMe={reloadMe}
        />
      </>
    );
  }

  return <div className="flex max-w-3xl flex-col gap-4">{content}</div>;
}

export default function SettingsPage() {
  return (
    <AppShell active="settings" title="title_settings">
      <Settings />
    </AppShell>
  );
}
