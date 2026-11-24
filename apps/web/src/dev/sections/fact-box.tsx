import { Lightbulb } from "lucide-react";

import { FactBox } from "../../components/patterns/FactBox";
import type { PatternSection } from "../sections";

function FactBoxes() {
  return (
    <div className="flex flex-col gap-4">
      <FactBox icon={Lightbulb}>The sender wrote to you twice this week and asked for a reply by Friday.</FactBox>
      <FactBox>A note with no icon.</FactBox>
    </div>
  );
}

export const section: PatternSection = { title: "FactBox", order: 53, render: () => <FactBoxes /> };
