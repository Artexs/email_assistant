import { isLabelCategory, type ActivityItem, type LabelCategory } from "@ea/core/web";
import { useState } from "react";
import { toast } from "sonner";

import { t } from "../../i18n/en";
import { postFeedback, postUndo } from "../../lib/activity-api";
import { categoryName, feedbackToast, undoToast } from "../../lib/activity-text";
import { ApiError } from "../../lib/api";
import { Button } from "../ui/button";
import { CategoryPicker } from "./CategoryPicker";

export interface ActionButtonsProps {
  item: ActivityItem;
  onPatch(emailId: string, patch: Partial<Pick<ActivityItem, "feedback" | "undoable" | "undoPending">>): void;
  onGone(): void; // a 404: the list refreshes
}

export function ActionButtons({ item, onPatch, onGone }: ActionButtonsProps) {
  const [pending, setPending] = useState<"right" | "pick" | "undo" | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const busy = pending !== null;
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
    <div className="flex items-center gap-2">
      {rightCategory !== null && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          aria-label={t("act_btn_right", { category: categoryName(rightCategory) })}
          onClick={() => void saveLabel("right", rightCategory)}
        >
          {t("act_icon_right")}
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy}
        aria-label={t("act_btn_edit")}
        onClick={() => setPickerOpen(true)}
      >
        {t("act_icon_edit")}
      </Button>
      {item.undoable && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          aria-label={t("act_btn_undo")}
          onClick={() => void undo()}
        >
          {t("act_icon_undo")}
        </Button>
      )}
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
