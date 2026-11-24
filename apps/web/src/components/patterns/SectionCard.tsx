import type { LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "cn";

import { Card } from "../ui/card";

interface SectionCardProps extends Omit<ComponentProps<"div">, "title"> {
  icon: LucideIcon;
  title: string;
  lead?: string;
  tone?: "default" | "danger";
  children: ReactNode;
}

// A card for one group of settings: an icon tile, the `h2`, a lead line, then the content. `tone="danger"` is for the
// destructive group: a red edge and no shadow. Extra `div` props (`id`, `data-card`, …) reach the card, so a link or a test can find it.
export function SectionCard({
  icon: Icon,
  title,
  lead,
  tone = "default",
  className,
  children,
  ...props
}: SectionCardProps) {
  const danger = tone === "danger";
  return (
    <Card
      data-tone={tone}
      className={cn("gap-4 p-6", danger && "border border-destructive shadow-none", className)}
      {...props}
    >
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2.5 text-lg font-bold">
          <span
            aria-hidden="true"
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-md",
              danger ? "bg-destructive-soft text-destructive" : "bg-primary-soft text-primary"
            )}
          >
            <Icon className="size-5" />
          </span>
          {title}
        </h2>
        {lead === undefined ? null : <p className="text-sm text-muted-foreground">{lead}</p>}
      </div>
      {children}
    </Card>
  );
}
