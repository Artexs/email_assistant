import { ProgressRing } from "../../components/patterns/ProgressRing";
import type { PatternSection } from "../sections";

export const section: PatternSection = {
  title: "ProgressRing",
  order: 40,
  render: () => (
    <div className="flex flex-wrap items-center gap-8">
      <ProgressRing value={2} max={10} size="sm" label="2 of 10 answered">
        <span className="text-xs">2/10</span>
      </ProgressRing>
      <ProgressRing value={8} max={10} label="8 of 10 handled" />
      <ProgressRing value={50} max={100} size="lg" label="50 percent handled">
        <span className="text-3xl">50%</span>
      </ProgressRing>
      <ProgressRing value={12} max={10} label="Done, 12 of 10" />
      <ProgressRing value={0} max={0} label="Nothing to count" />
    </div>
  ),
};
