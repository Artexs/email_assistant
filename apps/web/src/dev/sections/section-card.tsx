import { Bell, Trash2 } from "lucide-react";

import { SectionCard } from "../../components/patterns/SectionCard";
import { Button } from "../../components/ui/button";
import type { PatternSection } from "../sections";

function SectionCards() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <SectionCard
        icon={Bell}
        title="Notifications"
        lead="Choose where the daily digest goes."
        id="demo-digest"
        data-card="digest"
      >
        <p className="text-base">The content of the card goes here.</p>
      </SectionCard>
      <SectionCard icon={Trash2} title="Delete organization" lead="This removes all mail data." tone="danger">
        <div>
          <Button variant="destructive">Delete</Button>
        </div>
      </SectionCard>
    </div>
  );
}

export const section: PatternSection = { title: "SectionCard", order: 50, render: () => <SectionCards /> };
