import { labelCategories, type Category, type LabelCategory } from "@ea/core/web";

import { t } from "../../i18n";
import { categoryName, categoryTagText, subjectText } from "../../lib/activity-text";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";

export interface CategoryPickerProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  aiCategory: Category;
  subject: string | null;
  onPick(category: LabelCategory): void;
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
          {labelCategories.map((c) => (
            <Button key={c} type="button" variant="outline" onClick={() => onPick(c)}>
              {c === aiCategory ? t("act_pick_ai", { category: categoryTagText(c) }) : categoryTagText(c)}
            </Button>
          ))}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
