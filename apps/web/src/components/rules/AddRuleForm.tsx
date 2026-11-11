import {
  ruleBodySchema,
  ruleViewSchema,
  senderRuleKinds,
  type MailboxView,
  type RuleView,
  type SenderRuleKind,
} from "@ea/core/web";
import { useState } from "react";
import { toast } from "sonner";

import { t, type TextKey } from "../../i18n/en";
import { api, ApiError } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

const kindTitles: Record<SenderRuleKind, TextKey> = {
  vip: "rule_kind_vip",
  whitelist: "rule_kind_whitelist",
  blocklist: "rule_kind_blocklist",
};

const ALL = "all";

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

  return (
    <Card data-card="add-rule">
      <CardHeader>
        <CardTitle>{t("rules_add_title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rule-kind">{t("rules_kind_label")}</Label>
            <Select value={kind} onValueChange={(value) => setKind(value as SenderRuleKind)}>
              <SelectTrigger id="rule-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {senderRuleKinds.map((item) => (
                  <SelectItem key={item} value={item}>
                    {t(kindTitles[item])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rule-pattern">{t("rules_pattern_label")}</Label>
            <Input
              id="rule-pattern"
              autoComplete="off"
              value={pattern}
              aria-invalid={error !== null}
              aria-describedby="rule-pattern-help"
              onChange={(event) => {
                setError(null);
                setPattern(event.target.value);
              }}
            />
            <p id="rule-pattern-help" className="text-sm text-muted-foreground">
              {t("rules_pattern_help")}
            </p>
            {error !== null && (
              <p role="alert" className="text-sm text-destructive">
                {t(error)}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rule-scope">{t("rules_scope_label")}</Label>
            <Select value={scopeValue} onValueChange={setScope}>
              <SelectTrigger id="rule-scope" className="w-full">
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
          <div>
            <Button type="submit" disabled={pending}>
              {t("rules_add")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
