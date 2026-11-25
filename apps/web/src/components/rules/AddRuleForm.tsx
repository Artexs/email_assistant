import {
  ruleBodySchema,
  ruleViewSchema,
  senderRuleKinds,
  type MailboxView,
  type RuleView,
  type SenderRuleKind,
} from "@ea/core/web";
import { cn } from "cn";
import { Plus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { t, type TextKey } from "../../i18n";
import { api, ApiError } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { sentenceParts, type RuleSlot } from "../../lib/rule-sentence";
import { Button } from "../ui/button";
import { SectionCard } from "../patterns/SectionCard";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

const ALL = "all";

const kindSentenceTexts: Record<SenderRuleKind, TextKey> = {
  vip: "rules_sentence_kind_vip",
  whitelist: "rules_sentence_kind_whitelist",
  blocklist: "rules_sentence_kind_blocklist",
};

// A slot of the sentence: a soft tint and a primary edge, full width on a phone.
const slotLook = "w-full border-primary bg-primary-soft font-bold text-primary placeholder:font-normal";

export interface AddRuleFormProps {
  mailboxes: MailboxView[];
  onAdded(rule: RuleView): void;
  onMissingMailbox(): void;
}

export function AddRuleForm({ mailboxes, onAdded, onMissingMailbox }: AddRuleFormProps) {
  const [kind, setKind] = useState<SenderRuleKind>("vip");
  const [pattern, setPattern] = useState("");
  const [scope, setScope] = useState(ALL);
  const [error, setError] = useState<TextKey | null>(null);
  const [pending, setPending] = useState(false);

  // A scope whose mailbox left the list falls back to all mailboxes.
  const scopeValue = mailboxes.some((mailbox) => mailbox.id === scope) ? scope : ALL;

  const submit = async () => {
    const parsed = ruleBodySchema.safeParse({
      kind,
      pattern,
      ...(scopeValue === ALL ? {} : { mailboxId: scopeValue }),
    });
    if (!parsed.success) {
      setError("pattern_invalid");
      return;
    }
    setPending(true);
    try {
      const rule = await api("/api/rules", ruleViewSchema, { method: "POST", body: parsed.data });
      setPattern("");
      setError(null);
      toast.success(t("rule_added_toast"));
      onAdded(rule);
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === "rule_exists") {
        setError("err_rule_exists");
      } else if (failure instanceof ApiError && failure.status === 404) {
        toast.error(t("err_not_found"));
        onMissingMailbox();
      } else if (failure instanceof ApiError && failure.status === 400) {
        const first = failure.details?.[0]?.message;
        setError(first === "pattern_invalid" ? "pattern_invalid" : "error_generic");
      } else {
        toast.error(t(errorText(failure)));
      }
    } finally {
      setPending(false);
    }
  };

  const slots: Record<RuleSlot, ReactNode> = {
    pattern: (
      <Input
        id="rule-pattern"
        aria-label={t("rules_pattern_label")}
        placeholder={t("rules_pattern_help")}
        autoComplete="off"
        value={pattern}
        aria-invalid={error !== null}
        aria-describedby={error === null ? "rule-pattern-help" : "rule-pattern-help rule-pattern-error"}
        className={cn(slotLook, "sm:w-72")}
        onChange={(event) => {
          setError(null);
          setPattern(event.target.value);
        }}
      />
    ),
    kind: (
      <Select value={kind} onValueChange={(value) => setKind(value as SenderRuleKind)}>
        <SelectTrigger id="rule-kind" aria-label={t("rules_kind_label")} className={cn(slotLook, "sm:w-auto")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {senderRuleKinds.map((item) => (
            <SelectItem key={item} value={item}>
              {t(kindSentenceTexts[item])}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ),
    scope: (
      <Select value={scopeValue} onValueChange={setScope}>
        <SelectTrigger id="rule-scope" aria-label={t("rules_scope_label")} className={cn(slotLook, "sm:w-auto")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("rules_sentence_scope_all")}</SelectItem>
          {mailboxes.map((mailbox) => (
            <SelectItem key={mailbox.id} value={mailbox.id}>
              {t("rules_sentence_scope_one", { address: mailbox.address })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ),
  };

  return (
    <SectionCard icon={Plus} title={t("rules_add_title")} data-card="add-rule">
      <form
        aria-label={t("rules_add_title")}
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-3 text-lg font-bold">
          {sentenceParts(t("rules_sentence")).map((part) =>
            part.kind === "text" ? (
              <span key={`text-${part.text}`} className="whitespace-pre-wrap">
                {part.text.trim()}
              </span>
            ) : (
              <div key={part.slot} className="max-sm:basis-full sm:min-w-0">
                {slots[part.slot]}
              </div>
            )
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <p id="rule-pattern-help" className="text-sm text-muted-foreground">
            {t("rules_pattern_help")}
          </p>
          {error !== null && (
            <p id="rule-pattern-error" role="alert" className="text-sm text-destructive">
              {t(error)}
            </p>
          )}
        </div>
        <div>
          <Button type="submit" disabled={pending} className="max-sm:w-full">
            {t("rules_add")}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
