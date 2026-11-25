import type { ActivityItem, Delegate } from "@ea/core/web";
import { Users } from "lucide-react";
import { useState } from "react";

import { t } from "../../i18n";
import { approvalLink } from "../../lib/delegations-view";
import { delegateErrorKey, isExistsError, postDelegateMail, showDelegateAction } from "../../lib/delegate-action";
import { ApiError } from "../../lib/api";
import { subjectText } from "../../lib/activity-text";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { useDelegateHint } from "./DelegateHintProvider";
import { IconAction } from "./IconAction";

type Outcome =
  | { kind: "done"; sendId: string }
  | { kind: "error"; key: ReturnType<typeof delegateErrorKey>; exists: boolean };

export interface DelegateDialogProps {
  item: Pick<ActivityItem, "emailId" | "subject">;
  delegates: readonly Delegate[];
  open: boolean;
  onOpenChange(open: boolean): void;
  // A 404, or the dialog closes after a delegation: the list refreshes.
  onGone(): void;
}

// The dialog of the Delegate action: a select of active delegates (the address under each name), then one POST. The success
// text links to the approval of the draft; a 409 code has one text, and `exists` links to the delegations.
export function DelegateDialog({ item, delegates, open, onOpenChange, onGone }: DelegateDialogProps) {
  const [delegateId, setDelegateId] = useState("");
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const picked = delegates.find((delegate) => delegate.id === delegateId);

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      // A drafted delegation changes the row: the list refreshes.
      if (outcome?.kind === "done") onGone();
      setDelegateId("");
      setOutcome(null);
    }
  };

  const submit = async () => {
    if (picked === undefined) return;
    setPending(true);
    try {
      const answer = await postDelegateMail(item.emailId, picked.id);
      setOutcome({ kind: "done", sendId: answer.sendId });
    } catch (error) {
      setOutcome({ kind: "error", key: delegateErrorKey(error), exists: isExistsError(error) });
      if (error instanceof ApiError && error.status === 404) onGone();
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("dla_title")}</DialogTitle>
          <DialogDescription className="break-words">{subjectText(item.subject)}</DialogDescription>
        </DialogHeader>
        {outcome?.kind === "done" ? (
          <p role="status" className="text-sm">
            {t("dla_done")}{" "}
            <a className="underline underline-offset-2" href={approvalLink(outcome.sendId)}>
              {t("dla_done_link")}
            </a>
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">{t("dla_text")}</p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dla-select">{t("dla_select_label")}</Label>
              <Select value={delegateId} onValueChange={setDelegateId}>
                <SelectTrigger id="dla-select" className="w-full">
                  <SelectValue placeholder={t("dla_select_placeholder")}>{picked?.name}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {delegates.map((delegate) => (
                    <SelectItem key={delegate.id} value={delegate.id}>
                      <span className="flex flex-col items-start">
                        <span>{delegate.name}</span>
                        <span className="text-xs text-muted-foreground">{delegate.email}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {outcome?.kind === "error" && (
              <p role="alert" className="text-sm text-destructive">
                {t(outcome.key)}{" "}
                {outcome.exists && (
                  <a className="underline underline-offset-2" href="/delegations">
                    {t("dla_exists_link")}
                  </a>
                )}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)}>
            {t("cancel")}
          </Button>
          {outcome?.kind !== "done" && (
            <Button type="button" disabled={picked === undefined || pending} onClick={() => void submit()}>
              {t("dla_submit")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface DelegateActionProps {
  item: ActivityItem;
  onGone(): void;
}

// The button and its dialog. It renders nothing when the rule of `showDelegateAction` says no.
export function DelegateAction({ item, onGone }: DelegateActionProps) {
  const hint = useDelegateHint();
  const [open, setOpen] = useState(false);
  if (hint === null || !showDelegateAction(item, hint)) return null;
  return (
    <>
      <IconAction icon={Users} label={t("dla_button")} onClick={() => setOpen(true)} />
      <DelegateDialog item={item} delegates={hint.delegates} open={open} onOpenChange={setOpen} onGone={onGone} />
    </>
  );
}
