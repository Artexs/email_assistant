import { formatClock, mailboxListSchema, ruleListSchema, type MailboxView } from "@ea/core/web";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { AppShell } from "../components/shell/AppShell";
import { useMe } from "../components/shell/MeProvider";
import { AddRuleForm } from "../components/rules/AddRuleForm";
import { RuleList } from "../components/rules/RuleList";
import { NewslettersCard } from "../components/rules/NewslettersCard";
import { SuggestionsCard } from "../components/rules/SuggestionsCard";
import { UrgencyCard } from "../components/rules/UrgencyCard";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Skeleton } from "../components/ui/skeleton";
import { getLocale, t, useLocale } from "../i18n";
import { api } from "../lib/api";
import { canWrite } from "../lib/can-write";
import { groupRules, ruleKindOrder, rulesPath } from "../lib/rules-view";
import { useNow } from "../lib/use-now";
import { useResource } from "../lib/use-resource";

const ALL = "all";

interface RulesBodyProps {
  // `null` = all mailboxes.
  filter: string | null;
  mailboxes: MailboxView[];
  isOwner: boolean;
  isOwnerRole: boolean; // the "only the owner" text depends on the role, not on the write right
  timeZone: string;
  // Counts the Accepts of the suggestions card: a new value loads the rule list again, and the add form keeps what is typed.
  rulesVersion: number;
  // A rule was removed or put back: a new rules version and a fresh count for the onboarding checklist.
  onRulesChanged(): void;
  reloadMailboxes(): void;
  // The element in the bar above the form that holds the "updated at" line and Refresh. The mailbox filter
  // sits in the same bar and must keep its focus when the body loads again, so the body fills this slot.
  statusSlot: HTMLElement | null;
}

// The shape of the page while it loads: the bar, the add form and the three lists.
function RulesSkeleton({ withForm }: { withForm: boolean }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      {withForm && <Skeleton className="h-12 w-full" />}
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}

function RulesBody({
  filter,
  mailboxes,
  isOwner,
  isOwnerRole,
  timeZone,
  rulesVersion,
  onRulesChanged,
  reloadMailboxes,
  statusSlot,
}: RulesBodyProps) {
  const now = useNow();
  const [lastLoad, setLastLoad] = useState<Date | null>(null);
  const { data, error, loading, reload } = useResource(async () => {
    const list = await api(rulesPath(filter), ruleListSchema);
    setLastLoad(new Date());
    return list;
  });

  const seenVersion = useRef(rulesVersion);
  useEffect(() => {
    if (seenVersion.current === rulesVersion) return;
    seenVersion.current = rulesVersion;
    reload();
  }, [rulesVersion, reload]);

  let content;
  if (data === null) {
    content =
      error === null || loading ? (
        <RulesSkeleton withForm={false} />
      ) : (
        <div className="flex flex-col items-start gap-3">
          <p>{t("rules_load_error")}</p>
          <Button onClick={reload}>{t("retry")}</Button>
        </div>
      );
  } else {
    const groups = groupRules(data);
    content = (
      <div className="grid items-start gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        {ruleKindOrder.map((kind) => (
          <RuleList
            key={kind}
            kind={kind}
            rules={groups[kind]}
            mailboxes={mailboxes}
            isOwner={isOwner}
            onChanged={onRulesChanged}
          />
        ))}
      </div>
    );
  }

  return (
    <>
      {statusSlot !== null &&
        createPortal(
          <>
            <p className="text-sm text-muted-foreground">
              {lastLoad !== null && t("updated_at", { time: formatClock(lastLoad, timeZone, now, getLocale()) })}
            </p>
            <Button variant="outline" onClick={reload}>
              {t("refresh")}
            </Button>
          </>,
          statusSlot
        )}
      {isOwner ? (
        <AddRuleForm mailboxes={mailboxes} onAdded={onRulesChanged} onMissingMailbox={reloadMailboxes} />
      ) : (
        !isOwnerRole && <p className="text-sm text-muted-foreground">{t("set_owner_only")}</p>
      )}
      {content}
    </>
  );
}

function Rules() {
  const { me, reload: reloadMe } = useMe();
  const [filter, setFilter] = useState(ALL);
  // An Accept in the suggestions card adds a rule: a new version makes the rule list load again.
  const [rulesVersion, setRulesVersion] = useState(0);
  const [statusSlot, setStatusSlot] = useState<HTMLElement | null>(null);
  const {
    data: mailboxes,
    error,
    loading,
    reload: reloadMailboxes,
  } = useResource(() => api("/api/mailboxes", mailboxListSchema));

  // The rules count of the onboarding checklist lives in `useMe()`. The callback sits above the keyed body, so an Undo
  // from a toast still reloads the list on screen after the mailbox filter changed.
  const onRulesChanged = () => {
    setRulesVersion((version) => version + 1);
    reloadMe();
  };

  if (me === null) return null;
  const isOwner = me.role === "owner" && canWrite(me);
  const isOwnerRole = me.role === "owner";

  if (mailboxes === null) {
    return (
      <div className="flex max-w-6xl flex-col gap-4">
        {error === null || loading ? (
          <div aria-busy="true" className="flex flex-col gap-4">
            <Skeleton className="h-12 w-full" />
            <RulesSkeleton withForm />
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <p>{t("rules_load_error")}</p>
            <Button onClick={reloadMailboxes}>{t("retry")}</Button>
          </div>
        )}
      </div>
    );
  }

  // Derived in render: a filter whose mailbox left the list falls back to all mailboxes.
  const selected = mailboxes.some((mailbox) => mailbox.id === filter) ? filter : ALL;

  return (
    <div className="flex max-w-6xl flex-col gap-4">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1.5 sm:max-w-sm">
          <Label htmlFor="rules-filter">{t("rules_filter_label")}</Label>
          <Select value={selected} onValueChange={setFilter}>
            <SelectTrigger id="rules-filter" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("rules_all_mailboxes")}</SelectItem>
              {mailboxes.map((mailbox) => (
                <SelectItem key={mailbox.id} value={mailbox.id}>
                  {mailbox.address}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div ref={setStatusSlot} className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:ml-auto" />
      </div>
      <RulesBody
        key={selected}
        filter={selected === ALL ? null : selected}
        mailboxes={mailboxes}
        isOwner={isOwner}
        isOwnerRole={isOwnerRole}
        timeZone={me.organization.timezone}
        rulesVersion={rulesVersion}
        onRulesChanged={onRulesChanged}
        reloadMailboxes={reloadMailboxes}
        statusSlot={statusSlot}
      />
      {me.features.includes("urgency_editor") && (
        <UrgencyCard
          mailboxes={mailboxes}
          isOwner={isOwner}
          timeZone={me.organization.timezone}
          reloadMailboxes={reloadMailboxes}
        />
      )}
      <SuggestionsCard
        mailboxes={mailboxes}
        isOwner={isOwner}
        isOwnerRole={isOwnerRole}
        onRulesChanged={onRulesChanged}
      />
      {me.features.includes("bulk_unsubscribe") && (
        <NewslettersCard mailboxes={mailboxes} timeZone={me.organization.timezone} isOwner={isOwner} />
      )}
    </div>
  );
}

export default function RulesPage() {
  useLocale();
  return (
    <AppShell active="rules" title="title_rules" lead="rules_lead">
      <Rules />
    </AppShell>
  );
}
