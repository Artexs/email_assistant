import { isLabelCategory, type ActivityItem, type LabelCategory } from "@ea/core/web";
import { Check, Pencil, Undo2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { t } from "../../i18n";
import { postFeedback, postUndo } from "../../lib/activity-api";
import { categoryName, feedbackToast, undoToast } from "../../lib/activity-text";
import { ApiError } from "../../lib/api";
import { canWrite } from "../../lib/can-write";
import { useMe } from "../shell/MeProvider";
import { Button } from "../ui/button";
import { CategoryPicker } from "./CategoryPicker";
import { DelegateAction } from "./DelegateAction";
import { DraftReplyAction } from "./DraftReplyAction";
import { IconAction } from "./IconAction";

export interface ActionButtonsProps {
  item: ActivityItem;
  onPatch(emailId: string, patch: Partial<Pick<ActivityItem, "feedback" | "undoable" | "undoPending">>): void;
  onGone(): void; // a 404: the list refreshes
}

export function ActionButtons({ item, onPatch, onGone }: ActionButtonsProps) {
  const [pending, setPending] = useState<"right" | "pick" | "undo" | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const { me } = useMe();
  // A paused organization takes no feedback and no undo (the server refuses them).
  const busy = pending !== null || !canWrite(me);
  const emailId = item.emailId;

  const fail = (error: unknown) => {
    if (error instanceof ApiError && error.status === 404) {
      toast.error(t("err_not_found"));
      onGone();
    } else {
      toast.error(t("error_generic"));
    }
  };

  const saveLabel = async (kind: "right" | "pick", category: LabelCategory) => {
    setPending(kind);
    try {
      const result = await postFeedback({ emailId, trueCategory: category });
      toast.success(feedbackToast(kind, result, category));
      if (result.saved) {
        onPatch(emailId, {
          feedback: { verdict: result.verdict, trueCategory: category, source: "web", at: new Date().toISOString() },
        });
      }
    } catch (error) {
      fail(error);
    } finally {
      setPending(null);
    }
  };

  const undo = async () => {
    setPending("undo");
    try {
      const result = await postUndo({ emailId });
      if (result.kind === "started") toast.success(undoToast(result.kind));
      else toast(undoToast(result.kind));
      if (result.kind === "started") onPatch(emailId, { undoable: false, undoPending: true });
      else if (result.kind === "already") onPatch(emailId, { undoable: false });
    } catch (error) {
      fail(error);
    } finally {
      setPending(null);
    }
  };

  const rightCategory = isLabelCategory(item.category) ? item.category : null;

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 max-sm:max-w-24">
      {rightCategory !== null && (
        <IconAction
          icon={Check}
          label={t("act_btn_right", { category: categoryName(rightCategory) })}
          disabled={busy}
          onClick={() => void saveLabel("right", rightCategory)}
        />
      )}
      <IconAction icon={Pencil} label={t("act_btn_edit")} disabled={busy} onClick={() => setPickerOpen(true)} />
      {item.undoable && (
        <Button type="button" size="sm" variant="soft" disabled={busy} onClick={() => void undo()}>
          <Undo2 aria-hidden="true" />
          {t("act_btn_undo")}
        </Button>
      )}
      <DelegateAction item={item} onGone={onGone} />
      <DraftReplyAction item={item} />
      <CategoryPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        aiCategory={item.category}
        subject={item.subject}
        onPick={(category) => {
          setPickerOpen(false);
          void saveLabel("pick", category);
        }}
      />
    </div>
  );
}
