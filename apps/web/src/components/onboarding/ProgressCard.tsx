import { tp } from "../../i18n";
import type { OnboardingProgress } from "../../lib/onboarding-view";
import { ProgressRing } from "../patterns/ProgressRing";
import { Card } from "../ui/card";

// The side card of the page: how many required steps are done. A small ring above the list below `lg`, a large one beside it from `lg`.
export function ProgressCard({ progress }: { progress: OnboardingProgress }) {
  const label = tp("ob_steps_done", progress.total, { done: progress.done });
  const figure = `${progress.done}/${progress.total}`;
  return (
    <Card data-card="progress" className="items-center gap-3 p-5 text-center">
      <div className="lg:hidden">
        <ProgressRing value={progress.done} max={progress.total} size="sm" label={label}>
          {figure}
        </ProgressRing>
      </div>
      <div className="hidden lg:block">
        <ProgressRing value={progress.done} max={progress.total} size="lg" label={label}>
          <span className="text-3xl">{figure}</span>
        </ProgressRing>
      </div>
      <p className="font-bold">{label}</p>
    </Card>
  );
}
