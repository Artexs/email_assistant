import { PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { PatternSection } from "../sections";

const VARIANTS = [
  "default",
  "soft",
  "secondary",
  "outline",
  "ghost",
  "destructive",
  "destructive-soft",
  "link",
] as const;
const SIZES = ["lg", "default", "sm", "xs"] as const;
const ICON_SIZES = ["icon", "icon-sm"] as const;

// Every variant at every size, then the icon sizes. The label of a button is `<variant> <size>`: the size spec reads it by name.
function Buttons() {
  return (
    <div className="flex flex-col gap-6">
      {VARIANTS.map((variant) => (
        <div key={variant} className="flex flex-wrap items-center gap-3">
          <p className="w-32 text-sm text-muted-foreground">{variant}</p>
          {SIZES.map((size) => (
            <Button key={size} variant={variant} size={size}>
              {`${variant} ${size}`}
            </Button>
          ))}
          <Button variant={variant} disabled>
            {`${variant} disabled`}
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <p className="w-32 text-sm text-muted-foreground">icon sizes</p>
        {ICON_SIZES.map((size) => (
          <Button key={size} size={size} aria-label={`Add ${size}`}>
            <PlusIcon />
          </Button>
        ))}
      </div>
    </div>
  );
}

export const section: PatternSection = { title: "Buttons", order: 20, render: () => <Buttons /> };
