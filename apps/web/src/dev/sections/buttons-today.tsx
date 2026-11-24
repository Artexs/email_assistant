import { Button } from "@/components/ui/button";

import type { PatternSection } from "../sections";

const VARIANTS = ["default", "destructive", "outline", "secondary", "ghost", "link"] as const;
const SIZES = ["lg", "default", "sm", "xs"] as const;

function ButtonsToday() {
  return (
    <div className="flex flex-col gap-6">
      {VARIANTS.map((variant) => (
        <div key={variant} className="flex flex-wrap items-center gap-3">
          <p className="w-24 text-sm text-muted-foreground">{variant}</p>
          {SIZES.map((size) => (
            <Button key={size} variant={variant} size={size}>
              {`${variant} ${size}`}
            </Button>
          ))}
          <Button variant={variant} disabled>
            disabled
          </Button>
        </div>
      ))}
    </div>
  );
}

export const section: PatternSection = { title: "Buttons today", order: 20, render: () => <ButtonsToday /> };
