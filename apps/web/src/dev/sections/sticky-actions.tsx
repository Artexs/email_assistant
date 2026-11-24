import { StickyActions } from "../../components/patterns/StickyActions";
import { Button } from "../../components/ui/button";
import type { PatternSection } from "../sections";

// The bar is `position: fixed` below `lg`. A transform on the frame makes the frame, not the screen, its containing block,
// so the demo stays inside its box instead of covering the page.
function StickyActionsDemo() {
  return (
    <div className="relative h-64 overflow-hidden rounded-lg bg-background [transform:translateZ(0)] lg:h-auto lg:overflow-visible">
      <p className="p-4 text-base">
        The content of the page. Below the large breakpoint the bar sits at the bottom of this box.
      </p>
      <StickyActions>
        <Button size="lg" className="flex-1">
          Approve
        </Button>
        <Button size="lg" variant="outline" className="flex-1">
          Skip
        </Button>
      </StickyActions>
    </div>
  );
}

export const section: PatternSection = { title: "StickyActions", order: 54, render: () => <StickyActionsDemo /> };
