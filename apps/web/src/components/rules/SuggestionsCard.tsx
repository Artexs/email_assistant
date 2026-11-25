import { suggestionListSchema, suggestionResultSchema, type MailboxView, type SuggestionItem } from "@ea/core/web";
import { Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { t } from "../../i18n";
import { api } from "../../lib/api";
import { kindTitles } from "../../lib/rules-view";
import {
  acceptOutcome,
  dismissOutcome,
  focusHeadingAfterReload,
  pickMailbox,
  reasonLines,
  suggestionActionPath,
  suggestionsGone,
  suggestionsPath,
  type ActionOutcome,
  type SuggestionAction,
} from "../../lib/suggestions-view";
import { useResource } from "../../lib/use-resource";
import { Row } from "../patterns/Row";
import { RowList } from "../patterns/RowList";
import { SectionCard } from "../patterns/SectionCard";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

export interface SuggestionRowsProps {
  items: SuggestionItem[];
  // An owner of an account that can write may tap; the default is no button.
  canTap?: boolean;
  pendingId?: string | null;
  onAction?: (item: SuggestionItem, action: SuggestionAction) => void;
}

// The identity of a row is the pattern. The reason is counts only, as text.
export function SuggestionRows({ items, canTap = false, pendingId = null, onAction }: SuggestionRowsProps) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{t("sg_empty")}</p>;
  return (
    <RowList>
      {items.map((item) => (
        <div
          key={item.id}
          className="contents break-words"
          data-pattern={item.pattern}
          data-suggestion-kind={item.kind}
        >
          <Row
            title={item.pattern}
            hint={
              <span className="flex flex-col items-start gap-1.5">
                <Badge variant="secondary">{t(kindTitles[item.kind])}</Badge>
                <span>
                  {reasonLines(item)
                    .map((line) => t(line.key, line.vars))
                    .join(" ")}
                </span>
              </span>
            }
          >
            {canTap && (
              <>
                <Button
                  size="sm"
                  variant="soft"
                  disabled={pendingId !== null}
                  aria-label={t("sg_accept_for", { pattern: item.pattern })}
                  onClick={() => onAction?.(item, "accept")}
                >
                  {t("sg_accept")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pendingId !== null}
                  aria-label={t("sg_dismiss_for", { pattern: item.pattern })}
                  onClick={() => onAction?.(item, "dismiss")}
                >
                  {t("sg_dismiss")}
                </Button>
              </>
            )}
          </Row>
        </div>
      ))}
    </RowList>
  );
}

interface MailboxSuggestionsProps {
  mailboxes: MailboxView[];
  mailbox: MailboxView;
  onChoose(id: string): void;
  isOwner: boolean;
  isOwnerRole: boolean;
  onGone(mailboxId: string): void;
  onRulesChanged(): void;
}

function MailboxSuggestions({
  mailboxes,
  mailbox,
  onChoose,
  isOwner,
  isOwnerRole,
  onGone,
  onRulesChanged,
}: MailboxSuggestionsProps) {
  const { data, error, loading, reload } = useResource(() => api(suggestionsPath(mailbox.id), suggestionListSchema));
  const [pendingId, setPendingId] = useState<string | null>(null);
  const gone = suggestionsGone(error);
  const mailboxId = mailbox.id;
  useEffect(() => {
    if (gone) onGone(mailboxId);
  }, [gone, mailboxId, onGone]);
  // After an Accept or a Dismiss the row that held the focus is gone: the focus moves to the card, not to the page.
  const card = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);
  useEffect(() => {
    const wanted = moveFocus.current;
    moveFocus.current = false;
    if (focusHeadingAfterReload(wanted, error)) card.current?.focus();
  }, [data, error]);

  // The card shows once the first answer is in: with the flag off it never shows, and it does not flash.
  if (gone || (data === null && (error === null || loading))) return null;

  const apply = (outcome: ActionOutcome) => {
    if (outcome.toast !== null) toast[outcome.toast.kind](t(outcome.toast.key));
    if (outcome.reload) {
      moveFocus.current = true;
      reload();
    }
    if (outcome.rulesChanged) onRulesChanged();
  };
  const act = async (item: SuggestionItem, action: SuggestionAction) => {
    setPendingId(item.id);
    try {
      await api(suggestionActionPath(item.id, action), suggestionResultSchema, { method: "POST", body: {} });
      apply(action === "accept" ? acceptOutcome() : dismissOutcome());
    } catch (failure) {
      apply(action === "accept" ? acceptOutcome(failure) : dismissOutcome(failure));
    } finally {
      setPendingId(null);
    }
  };

  return (
    <SectionCard
      ref={card}
      icon={Sparkles}
      title={t("sg_title")}
      lead={t("sg_help")}
      data-card="suggestions"
      role="group"
      aria-label={t("sg_title")}
      tabIndex={-1}
      className="outline-none"
    >
      {!isOwnerRole && <p className="text-sm text-muted-foreground">{t("sg_member_note")}</p>}
      {mailboxes.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="suggestions-mailbox">{t("sg_mailbox_label")}</Label>
          <Select value={mailbox.id} onValueChange={onChoose}>
            <SelectTrigger id="suggestions-mailbox" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {mailboxes.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.address}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {data === null ? (
        <div className="flex flex-col items-start gap-3">
          <p>{t("sg_load_error")}</p>
          <Button onClick={reload}>{t("retry")}</Button>
        </div>
      ) : (
        <SuggestionRows items={data} canTap={isOwner} pendingId={pendingId} onAction={act} />
      )}
    </SectionCard>
  );
}

export interface SuggestionsCardProps {
  mailboxes: MailboxView[];
  /** An owner of an account that can write (not paused). A member sees the list and no button. */
  isOwner: boolean;
  isOwnerRole: boolean;
  /** After an Accept: the rule list of the page loads again. */
  onRulesChanged(): void;
}

export function SuggestionsCard({ mailboxes, isOwner, isOwnerRole, onRulesChanged }: SuggestionsCardProps) {
  const [chosen, setChosen] = useState<string | null>(null);
  // The mailboxes whose list answered 404 (the flag is off, or the mailbox is gone): each is left out, the others stay.
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const markGone = useCallback((id: string) => setGone((previous) => new Set(previous).add(id)), []);
  const { open, mailbox } = pickMailbox(mailboxes, gone, chosen);
  if (mailbox === undefined) return null;
  return (
    <MailboxSuggestions
      key={mailbox.id}
      mailboxes={open}
      mailbox={mailbox}
      onChoose={setChosen}
      isOwner={isOwner}
      isOwnerRole={isOwnerRole}
      onGone={markGone}
      onRulesChanged={onRulesChanged}
    />
  );
}
