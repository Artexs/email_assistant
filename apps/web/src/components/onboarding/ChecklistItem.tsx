import { Circle, CircleCheck } from "lucide-react";
import type { ReactNode } from "react";

import { t, type TextKey } from "../../i18n/en";

export interface ChecklistItemProps {
  title: TextKey;
  /** `null`: no state to show (Telegram is off on this server). */
  done: boolean | null;
  optional?: boolean;
  children: ReactNode;
}

export function ChecklistItem({ title, done, optional = false, children }: ChecklistItemProps) {
  return (
    <li className="flex gap-3 rounded-lg border bg-card p-4 text-card-foreground" data-optional={optional || undefined}>
      <div className="mt-0.5 size-5 shrink-0">
        {done === true && <CircleCheck aria-hidden="true" className="size-5 text-primary" />}
        {done === false && <Circle aria-hidden="true" className="size-5 text-muted-foreground" />}
        {done !== null && <span className="sr-only">{t(done ? "ob_item_done" : "ob_item_open")}</span>}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h2 className="font-medium">{t(title)}</h2>
        {children}
      </div>
    </li>
  );
}
