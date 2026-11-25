import type { ReactNode } from "react";
import { cn } from "cn";

export interface PageHeadProps {
  title: string;
  lead?: string;
  action?: ReactNode;
}

// The only h1 of a page. The shell renders it; an island passes the lead and the action to the shell.
// Below `lg` the action wraps under the title and the lead gives way to it. An action component that renders nothing
// (a control for owners only, a switch behind a flag) leaves its slot empty, and then the lead stays.
export function PageHead({ title, lead, action }: PageHeadProps) {
  const hasAction = action !== undefined && action !== null && action !== false;
  return (
    <div className="group/head mb-3.5 flex flex-col items-start gap-2.5 lg:mb-5.5 lg:flex-row lg:items-end lg:justify-between lg:gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">{title}</h1>
        {lead !== undefined && (
          <p
            className={cn(
              "mt-1.5 text-muted-foreground",
              hasAction && "max-lg:group-has-[[data-slot=page-head-action]:not(:empty)]/head:hidden"
            )}
          >
            {lead}
          </p>
        )}
      </div>
      {hasAction && (
        <div data-slot="page-head-action" className="flex shrink-0 items-center gap-3 empty:hidden">
          {action}
        </div>
      )}
    </div>
  );
}
