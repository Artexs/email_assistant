import { StepDots } from "../../components/patterns/StepDots";
import type { PatternSection } from "../sections";

export const section: PatternSection = {
  title: "StepDots",
  order: 50,
  render: () => (
    <div className="flex flex-col gap-4">
      <StepDots current={1} total={5} label="Draft 1 of 5" />
      <StepDots current={5} total={5} label="Draft 5 of 5" />
      <StepDots current={3} total={8} label="Draft 3 of 8" />
      <StepDots current={4} total={12} label="Draft 4 of 12" />
    </div>
  ),
};
