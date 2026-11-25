import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "cn";

import { t, type TextKey } from "../../i18n";
import { Card } from "../ui/card";

export interface ChecklistItemProps {
  /** The position in the list, shown in the circle until the step is done. */
  number: number;
  title: TextKey;
  /** `null`: no state to show (Telegram is off on this server). */
  done: boolean | null;
  /** The first required step that is not done: it gets the primary outline. */
  current?: boolean;
  optional?: boolean;
  children: ReactNode;
}

export function ChecklistItem({
  number,
  title,
  done,
  current = false,
  optional = false,
  children,
}: ChecklistItemProps) {
  return (
    <li data-optional={optional || undefined} data-current={current || undefined}>
      <Card className={cn("flex-row gap-4 p-5", current && "ring-2 ring-primary")}>
        <div
          aria-hidden="true"
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-full text-sm font-extrabold",
            done === true ? "bg-primary text-primary-foreground" : "bg-primary-soft text-primary"
          )}
        >
          {done === true ? <Check className="size-5" /> : number}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h2 className="text-lg font-bold">{t(title)}</h2>
          {done !== null && <span className="sr-only">{t(done ? "ob_item_done" : "ob_item_open")}</span>}
          {children}
        </div>
      </Card>
    </li>
  );
}
