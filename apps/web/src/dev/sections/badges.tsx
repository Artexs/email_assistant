import { Badge } from "@/components/ui/badge";

import type { PatternSection } from "../sections";

const VARIANTS = ["default", "secondary", "outline", "destructive", "ghost", "link"] as const;

function Badges() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {VARIANTS.map((variant) => (
        <Badge key={variant} variant={variant}>
          {variant}
        </Badge>
      ))}
    </div>
  );
}

export const section: PatternSection = { title: "Badges", order: 40, render: () => <Badges /> };
