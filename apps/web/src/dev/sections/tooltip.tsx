import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import type { PatternSection } from "../sections";

function TooltipDemo() {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline">Hover or focus for a tooltip</Button>
        </TooltipTrigger>
        <TooltipContent>The tooltip text</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export const section: PatternSection = { title: "Tooltip", order: 55, render: () => <TooltipDemo /> };
