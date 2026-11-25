import { labelCategories, type Category, type LabelCategory } from "@ea/core/web";

import { t } from "../../i18n";
import { categoryName, subjectText } from "../../lib/activity-text";
import { CategoryPill } from "../patterns/CategoryPill";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";

export interface CategoryPickerProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  aiCategory: Category;
  subject: string | null;
  onPick(category: LabelCategory): void;
}

// Each allowed category is a full-width button with its pill; the AI's own choice says so.
export function CategoryChoices({
  aiCategory,
  onPick,
}: {
  aiCategory: Category;
  onPick(category: LabelCategory): void;
}) {
  return (
    <>
      {labelCategories.map((c) => (
        <Button key={c} type="button" variant="outline" className="w-full justify-between" onClick={() => onPick(c)}>
          <CategoryPill category={c} label={categoryName(c)} />
          {c === aiCategory && <span className="text-sm font-normal text-muted-foreground">{t("act_pick_ai")}</span>}
        </Button>
      ))}
    </>
  );
}

export function CategoryPicker({ open, onOpenChange, aiCategory, subject, onPick }: CategoryPickerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("act_pick_title")}</DialogTitle>
          <DialogDescription>{t("act_pick_help", { category: categoryName(aiCategory) })}</DialogDescription>
        </DialogHeader>
        <p className="truncate text-sm text-muted-foreground">{subjectText(subject)}</p>
        <div className="flex flex-col gap-2">
          <CategoryChoices aiCategory={aiCategory} onPick={onPick} />
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
