import type { ReactNode } from "react";

export interface PageHeadProps {
  title: string;
  lead?: string;
  action?: ReactNode;
}

// The only h1 of a page. The shell renders it; an island passes the lead and the action to the shell.
// Below `lg` the action wraps under the title and the lead gives way to it.
export function PageHead({ title, lead, action }: PageHeadProps) {
  const hasAction = action !== undefined && action !== null && action !== false;
  return (
    <div className="mb-3.5 flex flex-col items-start gap-2.5 lg:mb-5.5 lg:flex-row lg:items-end lg:justify-between lg:gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">{title}</h1>
        {lead !== undefined && (
          <p className={`mt-1.5 text-muted-foreground ${hasAction ? "hidden lg:block" : ""}`}>{lead}</p>
        )}
      </div>
      {hasAction && <div className="flex shrink-0 items-center gap-3">{action}</div>}
    </div>
  );
}
