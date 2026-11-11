import type { MailboxView, RuleView, SenderRuleKind } from "@ea/core/web";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { t, type TextKey } from "../../i18n/en";
import { api, ApiError } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { kindTitles, scopeLabel } from "../../lib/rules-view";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

const kindTexts: Record<SenderRuleKind, TextKey> = {
  vip: "rules_vip_text",
  whitelist: "rules_whitelist_text",
  blocklist: "rules_blocklist_text",
};

export interface RuleListProps {
  kind: SenderRuleKind;
  rules: RuleView[];
  mailboxes: MailboxView[];
  isOwner: boolean;
  onDeleted(id: string): void;
}

export function RuleList({ kind, rules, mailboxes, isOwner, onDeleted }: RuleListProps) {
  const [pendingId, setPendingId] = useState<string | null>(null);

  const remove = async (rule: RuleView) => {
    setPendingId(rule.id);
    try {
      await api(`/api/rules/${encodeURIComponent(rule.id)}`, z.undefined(), { method: "DELETE" });
      toast.success(t("rule_deleted_toast"));
      onDeleted(rule.id);
    } catch (failure) {
      const gone = failure instanceof ApiError && failure.status === 404;
      toast.error(t(gone ? "err_not_found" : errorText(failure)));
      // A rule that is gone already must leave the list too.
      if (gone) onDeleted(rule.id);
    } finally {
      setPendingId(null);
    }
  };

  return (
    <Card data-kind={kind}>
      <CardHeader>
        <CardTitle>{t(kindTitles[kind])}</CardTitle>
        <p className="text-sm text-muted-foreground">{t(kindTexts[kind])}</p>
      </CardHeader>
      <CardContent>
        {rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("rules_empty")}</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {rules.map((rule) => {
              const scope = scopeLabel(rule, mailboxes);
              return (
                <li key={rule.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="break-all font-medium">{rule.pattern}</p>
                    <p className="break-all text-sm text-muted-foreground">
                      {"key" in scope ? t(scope.key) : scope.address}
                    </p>
                  </div>
                  {isOwner && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={pendingId === rule.id}
                      aria-label={t("rules_delete", { pattern: rule.pattern })}
                      onClick={() => void remove(rule)}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
