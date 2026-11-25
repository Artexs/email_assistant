import {
  mailboxListSchema,
  organizationSettingsSchema,
  settingsViewSchema,
  type MailboxView,
  type OrganizationView,
  type SettingsWebChange,
} from "@ea/core/web";
import { Inbox } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "../components/patterns/EmptyState";
import { AppShell } from "../components/shell/AppShell";
import { useMe } from "../components/shell/MeProvider";
import { ScopeBadges } from "../components/mailboxes/ScopeBadges";
import { StatusBadge } from "../components/mailboxes/StatusBadge";
import { MailboxSelector } from "../components/settings/MailboxSelector";
import { AccountCard } from "../components/settings/AccountCard";
import { CategoriesCard } from "../components/settings/CategoriesCard";
import { DigestTimesCard } from "../components/settings/DigestTimesCard";
import { NotifySection } from "../components/settings/NotifyCards";
import { PushDevicesCard } from "../components/settings/PushDevicesCard";
import { LoopSettingsCard } from "../components/settings/LoopSettingsCard";
import { ModeCard } from "../components/settings/ModeCard";
import { SettingsGroup, SettingsNav } from "../components/settings/SettingsNav";
import { ReplyStyleCard } from "../components/settings/ReplyStyleCard";
import { SentMailCard } from "../components/settings/SentMailCard";
import { TelegramLockCard } from "../components/settings/TelegramLockCard";
import { SyncFoldersCard } from "../components/settings/SyncFoldersCard";
import { TimezoneCard } from "../components/settings/TimezoneCard";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { t, tp, type TextKey, useLocale } from "../i18n";
import { api, ApiError } from "../lib/api";
import { canWrite } from "../lib/can-write";
import { selectedMailboxId, settingsPath } from "../lib/settings-api";
import { groupIdFromHash } from "../lib/settings-groups";
import { loadTrustView } from "../lib/trust-api";
import { useResource } from "../lib/use-resource";

interface MailboxSettingsProps {
  mailbox: MailboxView;
  isOwner: boolean;
  timeZone: string;
  listLoading: boolean;
  reloadMailboxes(): void;
  reloadMe(): void;
  // Called once the settings have loaded or have failed for good: the height above the other groups is final.
  onSettled(): void;
}

function MailboxSettings({
  mailbox,
  isOwner,
  timeZone,
  listLoading,
  reloadMailboxes,
  reloadMe,
  onSettled,
}: MailboxSettingsProps) {
  const { data, error, loading, reload, mutate } = useResource(() => api(settingsPath(mailbox.id), settingsViewSchema));
  // With the flag `trust_ladder` on, the card also reads the trust view. Flag off: no request, the card is as before.
  const { me } = useMe();
  const trustOn = me?.features.includes("trust_ladder") === true;
  // The style card always shows the name and the signature (every draft kind); the writing style and Preview need the flag.
  const replyDraftsOn = me?.features.includes("reply_drafts") === true;
  const styleFromSentOn = me?.features.includes("style_from_sent") === true;
  const trust = useResource(() => (trustOn ? loadTrustView(mailbox.id) : Promise.resolve(null)));

  // A 404 on the settings means the mailbox is gone (removed in another tab): the list decides what is selected.
  const missing = error instanceof ApiError && error.status === 404;
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    if (!missing || asked) return;
    setAsked(true);
    reloadMailboxes();
  }, [missing, asked, reloadMailboxes]);
  // The list reload is done and still holds this mailbox: show the error, not a skeleton for ever.
  const waitingForList = missing && (!asked || listLoading);
  const settled = data !== null || (error !== null && !loading && !waitingForList);
  useEffect(() => {
    if (settled) onSettled();
  }, [settled, onSettled]);

  if (data === null) {
    return error === null || loading || waitingForList ? (
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
    if (trustOn) trust.reload();
    if (change.settings.mode !== data.mode) reloadMe();
    reloadMailboxes();
    const suffix = change.expired > 0 ? ` ${tp("expired_suffix", change.expired)}` : "";
    toast.success(`${t(toastKey, vars)}${suffix}`);
  };

  return (
    <>
      <ModeCard mailbox={mailbox} settings={data} isOwner={isOwner} onChanged={onChanged} onMissing={reloadMailboxes} />
      <CategoriesCard
        settings={data}
        trust={trust.data}
        isOwner={isOwner}
        onChanged={onChanged}
        onMissing={reloadMailboxes}
      />
      <SyncFoldersCard settings={data} isOwner={isOwner} onChanged={onChanged} onMissing={reloadMailboxes} />
      {data.sentSync !== null && (
        <SentMailCard
          settings={data}
          isOwner={isOwner}
          timeZone={timeZone}
          onChanged={onChanged}
          onMissing={reloadMailboxes}
        />
      )}
      <LoopSettingsCard settings={data} isOwner={isOwner} onChanged={onChanged} onMissing={reloadMailboxes} />
      <ReplyStyleCard
        mailbox={mailbox}
        isOwner={isOwner}
        replyDraftsOn={replyDraftsOn}
        styleFromSentOn={styleFromSentOn}
        sentTracking={data.sentTracking}
      />
    </>
  );
}

function NoticesGroup() {
  const { me, reload: reloadMe } = useMe();
  return (
    <SettingsGroup id="notices">
      {me !== null && <DigestTimesCard times={me.digestTimes} timeZone={me.organization.timezone} onSaved={reloadMe} />}
      {me !== null && <NotifySection features={me.features} timeZone={me.organization.timezone} />}
      {me?.features.includes("web_push") === true && <PushDevicesCard />}
    </SettingsGroup>
  );
}

function OrganizationGroup({ isOwner, isOwnerRole }: { isOwner: boolean; isOwnerRole: boolean }) {
  const { reload: reloadMe } = useMe();
  const { data, error, loading, reload, mutate } = useResource(() =>
    api("/api/organization", organizationSettingsSchema)
  );

  let content;
  if (data === null) {
    content =
      error === null || loading ? (
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
  } else {
    // The PATCH answer goes into the resource at once, so a poll that started before the save cannot bring the old value back.
    const saved = (view: OrganizationView) => {
      mutate({ ...data, ...view });
      reloadMe();
    };
    content = (
      <>
        <TimezoneCard organization={data} isOwner={isOwner} onSaved={saved} />
        {data.telegramMinimalLocked !== undefined && (
          <TelegramLockCard
            locked={data.telegramMinimalLocked}
            isOwnerRole={isOwnerRole}
            onSaved={(locked) => mutate({ ...data, telegramMinimalLocked: locked })}
          />
        )}
      </>
    );
  }
  return <SettingsGroup id="organization">{content}</SettingsGroup>;
}

// After the first load the page scrolls to the group that the hash names, once. The page grows while it loads, so
// the scroll waits for the mailbox group to settle. `?two_factor=required` scrolls to the two-factor section instead
// of a group (the section scrolls once when it mounts, but the cards above it are still loading then and push it away).
function useScrollToGroup(ready: boolean) {
  const done = useRef(false);
  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    if (new URLSearchParams(location.search).get("two_factor") === "required") {
      document.getElementById("two-factor")?.scrollIntoView();
      return;
    }
    const id = groupIdFromHash(location.hash);
    if (id !== null) document.getElementById(id)?.scrollIntoView();
  }, [ready]);
}

function Settings() {
  const { me, reload: reloadMe } = useMe();
  const [selected, setSelected] = useState<string | null>(null);
  const { data, error, loading, reload } = useResource(() => api("/api/mailboxes", mailboxListSchema));
  const isOwner = me?.role === "owner" && canWrite(me);
  const isOwnerRole = me?.role === "owner";
  const [mailboxSettled, setMailboxSettled] = useState(false);
  const onSettled = useCallback(() => setMailboxSettled(true), []);

  // The selection is derived in render, so no frame shows "no mailbox" for a listed one (the first load reads `?mailbox=`).
  const current =
    data === null ? null : selectedMailboxId(data, selected ?? new URLSearchParams(location.search).get("mailbox"));

  // Sync the state and the URL with the derived selection.
  useEffect(() => {
    if (data === null) return;
    const next = current;
    if (next === selected) return;
    setSelected(next);
    const params = new URLSearchParams(location.search);
    if (next === null) params.delete("mailbox");
    else params.set("mailbox", next);
    const search = params.toString();
    history.replaceState(null, "", `${location.pathname}${search === "" ? "" : `?${search}`}${location.hash}`);
  }, [data, current, selected]);

  // With no mailbox (or a failed list) no settings card will load, so the list answer alone settles the group.
  const listSettled = data !== null || (error !== null && !loading);
  const noCards = listSettled && (data === null || current === null);
  useScrollToGroup(me !== null && listSettled && (mailboxSettled || noCards));

  if (me === null) return null;

  const choose = (id: string) => {
    setSelected(id);
    const params = new URLSearchParams(location.search);
    params.set("mailbox", id);
    history.replaceState(null, "", `${location.pathname}?${params.toString()}${location.hash}`);
  };

  const mailbox = data?.find((item) => item.id === current) ?? null;

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
      <EmptyState icon={Inbox} title={t("set_no_mailbox")} headingLevel={2}>
        <Button asChild>
          <a href="/mailboxes">{t("set_open_mailboxes")}</a>
        </Button>
      </EmptyState>
    );
  } else {
    content = (
      <>
        <MailboxSelector mailboxes={data} value={mailbox.id} onChange={choose} />
        <div className="flex flex-wrap items-start gap-2">
          <StatusBadge status={mailbox.status} />
          <ScopeBadges scopes={mailbox.scopes} />
        </div>
        <MailboxSettings
          key={mailbox.id}
          mailbox={mailbox}
          isOwner={isOwner}
          timeZone={me.organization.timezone}
          listLoading={loading}
          reloadMailboxes={reload}
          reloadMe={reloadMe}
          onSettled={onSettled}
        />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {!isOwnerRole && <p className="text-sm text-muted-foreground">{t("set_owner_only")}</p>}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <SettingsNav />
        <div className="flex max-w-3xl min-w-0 flex-1 flex-col gap-8">
          <SettingsGroup id="mailbox">{content}</SettingsGroup>
          <NoticesGroup />
          <OrganizationGroup isOwner={isOwner} isOwnerRole={isOwnerRole} />
          <SettingsGroup id="account">
            <AccountCard />
          </SettingsGroup>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  useLocale();
  return (
    <AppShell active="settings" title="title_settings" lead="set_lead">
      <Settings />
    </AppShell>
  );
}
