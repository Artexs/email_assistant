import type { LucideIcon } from "lucide-react";
import type { ComponentProps } from "react";

import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";

type IconActionProps = Omit<ComponentProps<typeof Button>, "size" | "children" | "aria-label"> & {
  icon: LucideIcon;
  label: string; // the accessible name and the tooltip text
};

// An icon-only action of an Activity row: 44 px, named by `label`, with the same text as its tooltip. The tooltip opens on hover only:
// one that opens on focus would take the first Escape of the detail panel, where focus starts on the first action.
export function IconAction({ icon: Icon, label, variant = "outline", ...props }: IconActionProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon-sm"
            variant={variant}
            aria-label={label}
            onFocus={(event) => event.preventDefault()}
            {...props}
          >
            <Icon aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
