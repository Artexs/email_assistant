import type { ApprovalDetail, ReplyRecipientsBody } from "@ea/core/web";
import { useId, useState, type FormEvent } from "react";

import { t } from "../../i18n";
import { instructionState, redraftState, redraftsLeftOf } from "../../lib/replies-view";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { AddressList } from "./AddressList";

export interface ReplyControlsProps {
  detail: ApprovalDetail;
  // A redraft has no answer yet: the page shows "Drafting…" and the Redraft button is off.
  waiting: boolean;
  // A call is on its way (a redraft, or a recipient change).
  busy: boolean;
  onRedraft(line: string): void;
  // The text that the field starts with (a render test types no text).
  initialText?: string;
  onRecipients(mode: ReplyRecipientsBody["mode"]): void;
}

// What an owner does with a waiting reply besides Approve, Reject and Edit: one line for a new version, and who it goes to. Every
// button is a hint: the server checks the owner, the gates and the limits again. The line is kept only in this field.
export function ReplyControls({
  detail,
  waiting,
  busy,
  onRedraft,
  initialText = "",
  onRecipients,
}: ReplyControlsProps) {
  const ids = { field: useId(), help: useId(), count: useId(), left: useId() };
  const [text, setText] = useState(initialText);
  const view = detail.view;
  if (view === null) return null;
  const line = instructionState(text);
  const redraft = redraftState({ redraftsLeft: detail.redraftsLeft, line: line.line, waiting });
  const off = busy || waiting;
  const mode = detail.recipientsMode ?? "from";
  const replyTo = view.replyTo?.[0];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (redraft.enabled && !busy && line.line !== null) onRedraft(line.line);
  };

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={submit} className="flex flex-col gap-1.5" noValidate>
        <Label htmlFor={ids.field}>{t("rp_instruction_label")}</Label>
        <div className="flex flex-wrap items-start gap-2">
          <Input
            id={ids.field}
            className="min-w-0 flex-1"
            autoComplete="off"
            value={text}
            disabled={off}
            aria-invalid={text !== "" && !line.ok}
            aria-describedby={`${ids.help} ${ids.count} ${ids.left}`}
            onChange={(event) => setText(event.target.value)}
          />
          <Button type="submit" variant="outline" disabled={!redraft.enabled || off}>
            {t("rp_redraft")}
          </Button>
        </div>
        <p id={ids.help} className="text-sm text-muted-foreground">
          {t("rp_instruction_help")}
        </p>
        <p
          id={ids.count}
          className={line.length > line.max ? "text-sm text-destructive" : "text-sm text-muted-foreground"}
        >
          {t("rp_instruction_count", { n: line.length, max: line.max })}
        </p>
        <p id={ids.left} className="text-sm text-muted-foreground">
          {redraft.reason === null
            ? t("rp_redraft_left", { n: redraftsLeftOf(detail.redraftsLeft) })
            : t(redraft.reason)}
        </p>
        <p role="status" className="text-sm">
          {waiting ? t("rp_drafting") : ""}
        </p>
      </form>
      {(view.canReplyAll === true || mode === "all") && (
        <div className="flex flex-col items-start gap-1">
          <Button
            type="button"
            variant="outline"
            aria-pressed={mode === "all"}
            disabled={off}
            onClick={() => onRecipients(mode === "all" ? "from" : "all")}
          >
            {t("rp_reply_all")}
          </Button>
          {mode !== "all" && detail.replyAllAdds !== undefined && (
            <p className="break-words text-sm text-muted-foreground">
              {`${t("rp_reply_all_adds")} `}
              <AddressList entries={detail.replyAllAdds} />
            </p>
          )}
        </div>
      )}
      {(view.canUseReplyTo === true || mode === "reply_to") && (
        <div className="flex flex-col items-start gap-1">
          <Button
            type="button"
            variant="outline"
            aria-pressed={mode === "reply_to"}
            disabled={off}
            onClick={() => onRecipients(mode === "reply_to" ? "from" : "reply_to")}
          >
            {t("rp_use_reply_to")}
          </Button>
          {mode !== "reply_to" && replyTo !== undefined && (
            <p className="break-words text-sm text-muted-foreground">
              {`${t("rp_use_reply_to_to")} `}
              <AddressList entries={[replyTo]} />
            </p>
          )}
        </div>
      )}
    </div>
  );
}
