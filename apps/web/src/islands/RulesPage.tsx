import { formatClock, mailboxListSchema, ruleListSchema, type MailboxView } from "@ea/core/web";
import { useState } from "react";

import { AppShell } from "../components/shell/AppShell";
import { useMe } from "../components/shell/MeProvider";
import { AddRuleForm } from "../components/rules/AddRuleForm";
import { RuleList } from "../components/rules/RuleList";
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
  reloadMe(): void;
  reloadMailboxes(): void;
}

function RulesBody({ filter, mailboxes, isOwner, isOwnerRole, timeZone, reloadMe, reloadMailboxes }: RulesBodyProps) {
  const now = useNow();
  const [lastLoad, setLastLoad] = useState<Date | null>(null);
  const { data, error, loading, reload } = useResource(async () => {
    const list = await api(rulesPath(filter), ruleListSchema);
    setLastLoad(new Date());
    return list;
  });

  // The rules count of the onboarding checklist lives in `useMe()`.
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
          <p>{t("rules_load_error")}</p>
          <Button onClick={reload}>{t("retry")}</Button>
        </div>
      );
  } else {
    const groups = groupRules(data);
    content = ruleKindOrder.map((kind) => (
      <RuleList
        key={kind}
        kind={kind}
        rules={groups[kind]}
        mailboxes={mailboxes}
        isOwner={isOwner}
        onDeleted={onChanged}
      />
    ));
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {lastLoad !== null && t("updated_at", { time: formatClock(lastLoad, timeZone, now, getLocale()) })}
        </p>
        <Button variant="outline" onClick={reload}>
          {t("refresh")}
        </Button>
      </div>
      {isOwner ? (
        <AddRuleForm mailboxes={mailboxes} onAdded={onChanged} onMissingMailbox={reloadMailboxes} />
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
  const {
    data: mailboxes,
    error,
    loading,
    reload: reloadMailboxes,
  } = useResource(() => api("/api/mailboxes", mailboxListSchema));

  if (me === null) return null;
  const isOwner = me.role === "owner" && canWrite(me);
  const isOwnerRole = me.role === "owner";

  if (mailboxes === null) {
    return (
      <div className="flex max-w-3xl flex-col gap-3">
        {error === null || loading ? (
          <div aria-busy="true" className="flex flex-col gap-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
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
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex flex-col gap-1.5">
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
      <RulesBody
        key={selected}
        filter={selected === ALL ? null : selected}
        mailboxes={mailboxes}
        isOwner={isOwner}
        isOwnerRole={isOwnerRole}
        timeZone={me.organization.timezone}
        reloadMe={reloadMe}
        reloadMailboxes={reloadMailboxes}
      />
    </div>
  );
}

export default function RulesPage() {
  useLocale();
  return (
    <AppShell active="rules" title="title_rules">
      <Rules />
    </AppShell>
  );
}
