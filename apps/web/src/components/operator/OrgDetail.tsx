import type { OperatorOrgDetail } from "@ea/core/web";
import type { ReactNode } from "react";

import { t, type TextKey } from "../../i18n";
import { ageText, dayText, llmTodayText, shortId } from "../../lib/operator-view";
import { StatusBadge } from "../mailboxes/StatusBadge";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { PlanBadge } from "./OrgTable";

const runTexts: Record<keyof OperatorOrgDetail["lastRuns"], TextKey> = {
  sync: "op_run_sync",
  triage: "op_run_triage",
  digest: "op_run_digest",
  send: "op_run_send",
  notice: "op_run_notice",
};
const runKeys = Object.keys(runTexts) as (keyof OperatorOrgDetail["lastRuns"])[];

const sourceTexts: Record<OperatorOrgDetail["flags"][number]["source"], TextKey> = {
  env: "op_source_env",
  row: "op_source_row",
  default: "op_source_default",
};

function Section({ title, children }: { title: TextKey; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{t(title)}</h3>
      {children}
    </section>
  );
}

export function OrgDetail({ detail, now }: { detail: OperatorOrgDetail; now: Date }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle title={detail.orgId}>{t("op_detail_title", { id: shortId(detail.orgId) })}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 text-sm">
        <Section title="op_plan_state">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <PlanBadge plan={detail.plan} />
            <span>{`${t("op_trial_ends")}: ${dayText(detail.trialEndsAt)}`}</span>
            <span>{`${t("op_resumed_at")}: ${dayText(detail.resumedAt)}`}</span>
            <span>{`${t("op_max_mailboxes")}: ${detail.maxMailboxes}`}</span>
          </div>
        </Section>
        <Section title="op_mailboxes_title">
          {detail.mailboxes.length === 0 ? (
            <p className="text-muted-foreground">{t("op_no_mailboxes")}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {detail.mailboxes.map((mailbox) => (
                <li key={mailbox.mailboxId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono" title={mailbox.mailboxId}>
                    {shortId(mailbox.mailboxId)}
                  </span>
                  <StatusBadge status={mailbox.status} />
                  <span className="text-muted-foreground">
                    {t("op_status_changed", { when: ageText(mailbox.statusChangedAt, now) })}
                  </span>
                  <span className="text-muted-foreground">
                    {t("op_synced", { when: ageText(mailbox.lastSyncedAt, now) })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="op_runs_title">
          <ul className="flex flex-col gap-1">
            {runKeys.map((key) => (
              <li key={key}>{`${t(runTexts[key])}: ${ageText(detail.lastRuns[key], now)}`}</li>
            ))}
          </ul>
        </Section>
        <Section title="op_failures_title">
          <ul className="flex flex-col gap-1">
            <li>{`${t("op_failed_sends")}: ${detail.failures24h.sends}`}</li>
            <li>{`${t("op_failed_notices")}: ${detail.failures24h.outbox}`}</li>
          </ul>
        </Section>
        <Section title="op_llm_title">
          <p>{llmTodayText(detail.llmToday)}</p>
        </Section>
        <Section title="op_flags_title">
          <ul className="flex flex-col gap-1">
            {detail.flags.map((flag) => (
              <li key={flag.flag} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono">{flag.flag}</span>
                <Badge variant={flag.enabled ? "default" : "secondary"}>
                  {t(flag.enabled ? "op_flag_on" : "op_flag_off")}
                </Badge>
                <span className="text-muted-foreground">{t(sourceTexts[flag.source])}</span>
              </li>
            ))}
          </ul>
        </Section>
      </CardContent>
    </Card>
  );
}
