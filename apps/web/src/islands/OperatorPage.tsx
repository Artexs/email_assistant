import { operatorNoticesSchema, operatorOrgDetailSchema, operatorOrgListSchema } from "@ea/core/web";
import { useState, type ReactNode } from "react";

import { AppShell } from "../components/shell/AppShell";
import { NoticeList, type NoticeDays } from "../components/operator/NoticeList";
import { OrgDetail } from "../components/operator/OrgDetail";
import { OrgTable } from "../components/operator/OrgTable";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import { t, useLocale } from "../i18n";
import { api, ApiError } from "../lib/api";
import { useNow } from "../lib/use-now";
import { useReloadOn } from "../lib/use-reload-on";
import { useResource } from "../lib/use-resource";

const POLL_MS = 60_000;

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

function Loading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

function Operator() {
  const now = useNow();
  const [selected, setSelected] = useState<string | null>(null);
  const [days, setDays] = useState<NoticeDays>(7);

  const orgs = useResource(() => api("/api/operator/orgs", operatorOrgListSchema), { pollMs: POLL_MS });
  const notices = useResource(() => api(`/api/operator/notices?days=${days}`, operatorNoticesSchema), {
    pollMs: POLL_MS,
  });
  const detail = useResource(
    () => (selected === null ? Promise.resolve(null) : api(`/api/operator/orgs/${selected}`, operatorOrgDetailSchema)),
    { pollMs: POLL_MS }
  );
  // The loaders read the current state through a ref; a new choice needs its own load.
  useReloadOn(days, notices.reload);
  useReloadOn(selected, detail.reload);

  const reloadAll = () => {
    orgs.reload();
    notices.reload();
    detail.reload();
  };

  // A non-operator who reached the page shell gets 404 from the API: the page says so and shows nothing else.
  if (isNotFound(orgs.error) || isNotFound(notices.error)) {
    return <p>{t("op_not_found")}</p>;
  }

  let orgsContent: ReactNode;
  if (orgs.data !== null) {
    orgsContent = <OrgTable orgs={orgs.data.orgs} selected={selected} now={now} onSelect={setSelected} />;
  } else if (orgs.error !== null && !orgs.loading) {
    orgsContent = <p>{t("op_load_error")}</p>;
  } else {
    orgsContent = <Loading />;
  }

  let detailContent: ReactNode;
  if (selected === null) {
    detailContent = (
      <Card>
        <CardContent className="text-sm text-muted-foreground">{t("op_detail_hint")}</CardContent>
      </Card>
    );
  } else if (detail.data !== null) {
    detailContent = <OrgDetail detail={detail.data} now={now} onChanged={reloadAll} />;
  } else if (isNotFound(detail.error)) {
    detailContent = <p>{t("op_not_found")}</p>;
  } else if (detail.error !== null && !detail.loading) {
    detailContent = <p>{t("op_load_error")}</p>;
  } else {
    detailContent = <Loading />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button variant="outline" onClick={reloadAll}>
          {t("op_reload")}
        </Button>
      </div>
      {orgsContent}
      {detailContent}
      {notices.data !== null ? <NoticeList notices={notices.data.notices} days={days} onDays={setDays} /> : <Loading />}
    </div>
  );
}

export default function OperatorPage() {
  useLocale();
  return (
    <AppShell active="operator" title="title_operator">
      <Operator />
    </AppShell>
  );
}
