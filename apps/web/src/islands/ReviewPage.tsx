import {
  mailboxListSchema,
  type PanelReviewItem,
  type PanelReviewLabelResult,
  type ReviewLabelCategory,
} from "@ea/core/web";
import { useState } from "react";
import { toast } from "sonner";

import { MailboxSelector } from "../components/settings/MailboxSelector";
import { ReviewContent } from "../components/review/ReviewContent";
import { useMe } from "../components/shell/MeProvider";
import { AppShell } from "../components/shell/AppShell";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import { t, useLocale } from "../i18n";
import { feedbackToast } from "../lib/activity-text";
import { api, ApiError } from "../lib/api";
import { canWrite } from "../lib/can-write";
import { errorText } from "../lib/errors";
import { pickReportMailbox } from "../lib/report-view";
import { fetchReviewSample, postReviewLabel } from "../lib/review-api";
import { reportPath } from "../lib/trust-api";
import { useNow } from "../lib/use-now";
import { useResource } from "../lib/use-resource";

function Loading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <Skeleton className="h-6 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

// One mailbox. The parent remounts it (`key`) when the choice changes. The sample loads once: no polling, a reload of the page gives a
// new sample.
function MailboxReview({ mailboxId, timeZone, paused }: { mailboxId: string; timeZone: string; paused: boolean }) {
  const { data, error, loading, reload } = useResource(() => fetchReviewSample(mailboxId), { pollMs: 0 });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [doneTapped, setDoneTapped] = useState(false);
  const now = useNow();

  const save = async (
    item: PanelReviewItem,
    kind: "right" | "pick",
    category: ReviewLabelCategory,
    send: () => Promise<PanelReviewLabelResult>
  ) => {
    setPending(true);
    try {
      const result = await send();
      setAnswers((previous) => ({ ...previous, [item.emailId]: feedbackToast(kind, result, category) }));
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 404)
        setAnswers((p) => ({ ...p, [item.emailId]: t("err_not_found") }));
      else toast.error(t(errorText(failure)));
    } finally {
      setPending(false);
    }
  };

  if (data === null) {
    if (error === null || loading) return <Loading />;
    return (
      <div className="flex flex-col items-start gap-3">
        <p>{t("rv_load_error")}</p>
        <Button onClick={reload}>{t("retry")}</Button>
      </div>
    );
  }
  return (
    <ReviewContent
      sample={data}
      answers={answers}
      busy={pending || paused}
      doneTapped={doneTapped}
      timeZone={timeZone}
      now={now}
      backHref={reportPath(mailboxId)}
      onRight={(item) =>
        void save(item, "right", item.category as ReviewLabelCategory, () =>
          postReviewLabel({ emailId: item.emailId, verdict: "right" })
        )
      }
      onPick={(item, category) =>
        void save(item, "pick", category, () => postReviewLabel({ emailId: item.emailId, category }))
      }
      onDone={() => setDoneTapped(true)}
    />
  );
}

function Review() {
  const { me } = useMe();
  const [chosen, setChosen] = useState<string | null>(null);
  const mailboxes = useResource(() => api("/api/mailboxes", mailboxListSchema), { pollMs: 0 });
  if (me === null) return null;

  // The flag is off: the page asks for nothing (the review routes would answer 404).
  if (!me.features.includes("panel_review")) {
    return (
      <Card>
        <CardContent>
          <p className="text-muted-foreground">{t("rep_off")}</p>
        </CardContent>
      </Card>
    );
  }

  const list = mailboxes.data;
  if (list === null) {
    if (mailboxes.error === null || mailboxes.loading) return <Loading />;
    return (
      <div className="flex flex-col items-start gap-3">
        <p>{t("rv_load_error")}</p>
        <Button onClick={mailboxes.reload}>{t("retry")}</Button>
      </div>
    );
  }

  const mailbox = pickReportMailbox(list, chosen ?? new URLSearchParams(location.search).get("mailbox"));
  if (mailbox === null) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-muted-foreground">{t("rv_no_mailbox")}</p>
        <Button asChild variant="outline">
          <a href="/mailboxes">{t("set_open_mailboxes")}</a>
        </Button>
      </div>
    );
  }

  const choose = (id: string) => {
    setChosen(id);
    const params = new URLSearchParams(location.search);
    params.set("mailbox", id);
    history.replaceState(null, "", `${location.pathname}?${params.toString()}${location.hash}`);
  };

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      {list.length >= 2 && <MailboxSelector mailboxes={list} value={mailbox.id} onChange={choose} />}
      <MailboxReview
        key={mailbox.id}
        mailboxId={mailbox.id}
        timeZone={me.organization.timezone}
        paused={!canWrite(me)}
      />
    </div>
  );
}

export default function ReviewPage() {
  useLocale();
  return (
    <AppShell active="settings" title="title_review">
      <Review />
    </AppShell>
  );
}
