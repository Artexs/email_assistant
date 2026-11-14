import type { OperatorOrgRow } from "@ea/core/web";

import { t, type TextKey } from "../../i18n";
import { ageText, dayText, llmTodayText, shortId } from "../../lib/operator-view";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

export const planTexts: Record<OperatorOrgRow["plan"], TextKey> = {
  trial: "op_plan_trial",
  active: "op_plan_active",
  suspended: "op_plan_suspended",
};

const planVariants = { trial: "secondary", active: "default", suspended: "destructive" } as const;

export function PlanBadge({ plan }: { plan: OperatorOrgRow["plan"] }) {
  return <Badge variant={planVariants[plan]}>{t(planTexts[plan])}</Badge>;
}

export interface OrgTableProps {
  orgs: readonly OperatorOrgRow[];
  selected: string | null;
  now: Date;
  onSelect(orgId: string): void;
}

export function OrgTable({ orgs, selected, now, onSelect }: OrgTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("op_orgs_title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {orgs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("op_orgs_empty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("op_col_org")}</TableHead>
                <TableHead>{t("op_col_plan")}</TableHead>
                <TableHead>{t("op_col_trial_end")}</TableHead>
                <TableHead>{t("op_col_mailboxes")}</TableHead>
                <TableHead>{t("op_col_last_sync")}</TableHead>
                <TableHead>{t("op_col_failures")}</TableHead>
                <TableHead>{t("op_col_llm")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orgs.map((org) => (
                <TableRow
                  key={org.orgId}
                  className="cursor-pointer"
                  data-state={org.orgId === selected ? "selected" : undefined}
                  onClick={() => onSelect(org.orgId)}
                >
                  <TableCell className="font-mono" title={org.orgId}>
                    {shortId(org.orgId)}
                  </TableCell>
                  <TableCell>
                    <PlanBadge plan={org.plan} />
                  </TableCell>
                  <TableCell>{dayText(org.trialEndsAt)}</TableCell>
                  <TableCell>{`${org.mailboxes.total} / ${org.mailboxes.authError} / ${org.mailboxes.hostBlocked}`}</TableCell>
                  <TableCell>{ageText(org.lastSyncAt, now)}</TableCell>
                  <TableCell>{`${org.failures24h.sends} / ${org.failures24h.outbox}`}</TableCell>
                  <TableCell>{llmTodayText(org.llmToday)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
