import { ruleViewSchema, type MailboxView, type RuleView, type SenderRuleKind } from "@ea/core/web";
import { Ban, Check, Shield, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { t, type TextKey } from "../../i18n";
import { api, ApiError } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { kindTitles, scopeLabel, undoBody, vipCardId } from "../../lib/rules-view";
import { SectionCard } from "../patterns/SectionCard";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

const kindTexts: Record<SenderRuleKind, TextKey> = {
  vip: "rules_vip_text",
  whitelist: "rules_whitelist_text",
  blocklist: "rules_blocklist_text",
};

const kindIcons: Record<SenderRuleKind, LucideIcon> = { vip: Shield, whitelist: Check, blocklist: Ban };

// How long the toast of a removed rule offers Undo.
const UNDO_TOAST_MS = 10_000;

export interface RuleListProps {
  kind: SenderRuleKind;
  rules: RuleView[];
  mailboxes: MailboxView[];
  isOwner: boolean;
  // A rule was removed or put back: the page reloads its list.
  onChanged(): void;
}

// Puts a removed rule back with the body of the add form. A rule that exists again counts as put back.
// One request at a time: a second click on Undo while the first runs sends nothing.
async function restore(rule: RuleView, onChanged: () => void, running: { current: boolean }): Promise<void> {
  if (running.current) return;
  running.current = true;
  try {
    await api("/api/rules", ruleViewSchema, { method: "POST", body: undoBody(rule) });
    toast.success(t("rule_restored_toast"));
    onChanged();
  } catch (failure) {
    if (failure instanceof ApiError && failure.code === "rule_exists") {
      toast.success(t("rule_restored_toast"));
      onChanged();
    } else {
      toast.error(t(failure instanceof ApiError && failure.status === 404 ? "err_not_found" : errorText(failure)));
    }
  } finally {
    running.current = false;
  }
}

export function RuleList({ kind, rules, mailboxes, isOwner, onChanged }: RuleListProps) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  // The rule that was removed and the chip that gets the focus when the list no longer holds it.
  const focusAfter = useRef<{ removed: string; next: string | null } | null>(null);
  const restoring = useRef(false);
  const Icon = kindIcons[kind];

  useEffect(() => {
    const target = focusAfter.current;
    if (target === null || rules.some((rule) => rule.id === target.removed)) return;
    focusAfter.current = null;
    const button = target.next === null ? undefined : buttons.current.get(target.next);
    (button ?? root.current)?.focus();
  }, [rules]);

  const remove = async (rule: RuleView) => {
    const index = rules.findIndex((item) => item.id === rule.id);
    const neighbour = rules[index + 1] ?? rules[index - 1];
    setPendingId(rule.id);
    try {
      await api(`/api/rules/${encodeURIComponent(rule.id)}`, z.undefined(), { method: "DELETE" });
      focusAfter.current = { removed: rule.id, next: neighbour?.id ?? null };
      toast.success(t("rule_deleted_toast"), {
        duration: UNDO_TOAST_MS,
        action: { label: t("rule_undo"), onClick: () => void restore(rule, onChanged, restoring) },
      });
      onChanged();
    } catch (failure) {
      const gone = failure instanceof ApiError && failure.status === 404;
      toast.error(t(gone ? "err_not_found" : errorText(failure)));
      // A rule that is gone already must leave the list too.
      if (gone) {
        focusAfter.current = { removed: rule.id, next: neighbour?.id ?? null };
        onChanged();
      }
    } finally {
      setPendingId(null);
    }
  };

  return (
    <SectionCard
      ref={root}
      tabIndex={-1}
      icon={Icon}
      title={t(kindTitles[kind])}
      lead={t(kindTexts[kind])}
      data-kind={kind}
      id={kind === "vip" ? vipCardId : undefined}
      className="outline-none"
    >
      <Badge variant="secondary" className="-mt-2 w-fit">
        {rules.length}
      </Badge>
      {rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("rules_empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rules.map((rule) => {
            const scope = scopeLabel(rule, mailboxes);
            return (
              <li key={rule.id} className="flex items-center gap-3 rounded-md bg-muted px-4 py-2">
                <div className="min-w-0 flex-1">
                  <p className="break-all font-medium">{rule.pattern}</p>
                  {"key" in scope && scope.key === "rules_all_mailboxes" ? null : (
                    <p className="break-all text-sm text-muted-foreground">
                      {"key" in scope ? t(scope.key) : scope.address}
                    </p>
                  )}
                </div>
                {isOwner && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    ref={(node) => {
                      if (node === null) buttons.current.delete(rule.id);
                      else buttons.current.set(rule.id, node);
                    }}
                    disabled={pendingId === rule.id}
                    aria-label={t("rules_delete", { pattern: rule.pattern })}
                    onClick={() => void remove(rule)}
                  >
                    <X aria-hidden="true" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
