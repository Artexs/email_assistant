import {
  mailboxListSchema,
  trustHistoryCheckAnswerSchema,
  trustRecommendedAnswerSchema,
  trustViewSchema,
} from "@ea/core/web";
import { useEffect, useState } from "react";
import { Inbox } from "lucide-react";
import { toast } from "sonner";

import { MailboxSelector } from "../components/settings/MailboxSelector";
import { ReportContent, type TurnedOn } from "../components/report/ReportContent";
import { useMe } from "../components/shell/MeProvider";
import { AppShell } from "../components/shell/AppShell";
import { Button } from "../components/ui/button";
import { EmptyState } from "../components/patterns/EmptyState";
import { FactBox } from "../components/patterns/FactBox";
import { Skeleton } from "../components/ui/skeleton";
import { t, useLocale } from "../i18n";
import { api, ApiError } from "../lib/api";
import { canWrite } from "../lib/can-write";
import { errorText } from "../lib/errors";
import { pickReportMailbox, shouldPoll } from "../lib/report-view";
import { reviewHrefFor } from "../lib/review-view";
import { historyCheckPath, recommendedPath, trustPath } from "../lib/trust-api";
import { useResource } from "../lib/use-resource";

function Loading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <Skeleton className="h-6 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

// One mailbox. The parent remounts it (`key`) when the choice changes, so a view never shows next to another mailbox.
function MailboxReport({
  mailboxId,
  isOwner,
  features,
}: {
  mailboxId: string;
  isOwner: boolean;
  features: readonly string[];
}) {
  const [poll, setPoll] = useState(true);
  const { data, error, loading, reload, mutate } = useResource(() => api(trustPath(mailboxId), trustViewSchema), {
    pollMs: poll ? 30_000 : 0,
  });
  const [pending, setPending] = useState(false);
  const [turnedOn, setTurnedOn] = useState<TurnedOn | null>(null);

  // Poll only while the check is open or has not started; an end state needs no polling.
  useEffect(() => {
    if (data !== null) setPoll(shouldPoll(data));
  }, [data]);

  const run = async (action: () => Promise<void>) => {
    setPending(true);
    try {
      await action();
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === "nothing_recommended") {
        toast.message(t("rep_all_on"));
        reload();
      } else if (failure instanceof ApiError && failure.code === "check_running") {
        toast.message(t("rep_check_running"));
        reload();
      } else {
        toast.error(t(errorText(failure)));
      }
    } finally {
      setPending(false);
    }
  };

  const turnOn = () =>
    run(async () => {
      const answer = await api(recommendedPath(mailboxId), trustRecommendedAnswerSchema, { method: "POST" });
      setTurnedOn({ categories: answer.turnedOn, mode: answer.mode });
      mutate(answer.view);
    });

  const checkAgain = () =>
    run(async () => {
      await api(historyCheckPath(mailboxId), trustHistoryCheckAnswerSchema, { method: "POST" });
      setTurnedOn(null);
      setPoll(true);
      toast.success(t("rep_check_started"));
      reload();
    });

  if (data === null) {
    if (error === null || loading) return <Loading />;
    return (
      <div className="flex flex-col items-start gap-3">
        <p>{t("rep_load_error")}</p>
        <Button onClick={reload}>{t("retry")}</Button>
      </div>
    );
  }
  return (
    <ReportContent
      view={data}
      isOwner={isOwner}
      pending={pending}
      turnedOn={turnedOn}
      reviewHref={reviewHrefFor(features, mailboxId)}
      onTurnOn={() => void turnOn()}
      onCheckAgain={() => void checkAgain()}
    />
  );
}

function Report() {
  const { me } = useMe();
  const [chosen, setChosen] = useState<string | null>(null);
  const mailboxes = useResource(() => api("/api/mailboxes", mailboxListSchema), { pollMs: 0 });
  if (me === null) return null;

  // The flag is off: the page asks for nothing (the trust routes would answer 404).
  if (!me.features.includes("trust_ladder")) {
    return (
      <FactBox>
        <p data-report="off">{t("rep_off")}</p>
      </FactBox>
    );
  }

  const isOwner = me.role === "owner" && canWrite(me);
  const list = mailboxes.data;
  if (list === null) {
    if (mailboxes.error === null || mailboxes.loading) return <Loading />;
    return (
      <div className="flex flex-col items-start gap-3">
        <p>{t("rep_load_error")}</p>
        <Button onClick={mailboxes.reload}>{t("retry")}</Button>
      </div>
    );
  }

  const mailbox = pickReportMailbox(list, chosen ?? new URLSearchParams(location.search).get("mailbox"));
  if (mailbox === null) {
    return (
      <EmptyState icon={Inbox} title={t("rep_no_mailbox")}>
        <Button asChild>
          <a href="/mailboxes">{t("set_open_mailboxes")}</a>
        </Button>
      </EmptyState>
    );
  }

  const choose = (id: string) => {
    setChosen(id);
    const params = new URLSearchParams(location.search);
    params.set("mailbox", id);
    history.replaceState(null, "", `${location.pathname}?${params.toString()}${location.hash}`);
  };

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      {list.length >= 2 && <MailboxSelector mailboxes={list} value={mailbox.id} onChange={choose} />}
      <MailboxReport key={mailbox.id} mailboxId={mailbox.id} isOwner={isOwner} features={me.features} />
    </div>
  );
}

export default function ReportPage() {
  useLocale();
  return (
    <AppShell active="settings" title="title_report" lead="rep_lead">
      <Report />
    </AppShell>
  );
}
