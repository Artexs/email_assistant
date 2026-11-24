import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

import type { PatternSection } from "../sections";

const SIDES = ["right", "left", "top", "bottom"] as const;

function SheetDemo() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {SIDES.map((side) => (
        <Sheet key={side}>
          <SheetTrigger asChild>
            <Button variant="outline" className="motion-reduce:transition-none" data-open-demo>
              {`Open sheet (${side})`}
            </Button>
          </SheetTrigger>
          <SheetContent side={side}>
            <SheetHeader>
              <SheetTitle>{`Sheet from the ${side}`}</SheetTitle>
              <SheetDescription>The free corners of a sheet are rounded.</SheetDescription>
            </SheetHeader>
            <SheetFooter>
              <Button>Done</Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      ))}
    </div>
  );
}

export const section: PatternSection = { title: "Sheet", order: 53, render: () => <SheetDemo /> };
