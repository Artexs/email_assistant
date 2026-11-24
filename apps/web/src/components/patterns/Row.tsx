import type { ReactNode } from "react";

import { Label } from "../ui/label";

interface RowProps {
  title: string;
  hint?: ReactNode;
  leading?: ReactNode;
  // The id of the control at the end. With it, the title is the label of that control. Without it, the caller names the control.
  htmlFor?: string;
  // The control at the end.
  children?: ReactNode;
}

// One line of a `RowList`: an optional leading element, the title with its hint under it, and the control at the end.
// Below 360 px the control wraps under the text.
export function Row({ title, hint, leading, htmlFor, children }: RowProps) {
  return (
    <div data-slot="row" className="flex items-center gap-3.5 py-3.5 max-[359px]:flex-wrap">
      {leading === undefined ? null : <div className="shrink-0">{leading}</div>}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 max-[359px]:basis-full">
        {htmlFor === undefined ? (
          <p className="text-base leading-snug font-bold">{title}</p>
        ) : (
          <Label htmlFor={htmlFor} className="text-base leading-snug font-bold">
            {title}
          </Label>
        )}
        {hint === undefined ? null : <div className="text-sm text-muted-foreground">{hint}</div>}
      </div>
      {children === undefined ? null : <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}
