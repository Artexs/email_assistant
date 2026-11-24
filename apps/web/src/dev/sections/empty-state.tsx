import { Inbox, Users } from "lucide-react";

import { EmptyState } from "../../components/patterns/EmptyState";
import { SectionCard } from "../../components/patterns/SectionCard";
import { Button } from "../../components/ui/button";
import type { PatternSection } from "../sections";

function EmptyStates() {
  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg bg-card shadow-card">
        <EmptyState
          icon={Inbox}
          title="Nothing to approve"
          text="New proposals show up here as soon as the assistant has one."
        >
          <Button>Connect a mailbox</Button>
          <Button variant="outline">Read the guide</Button>
        </EmptyState>
      </div>
      <SectionCard icon={Users} title="Delegates">
        <EmptyState
          icon={Users}
          title="No delegates yet"
          text="Add a person who takes tasks from you."
          headingLevel={3}
        >
          <Button variant="secondary">Add a delegate</Button>
        </EmptyState>
      </SectionCard>
    </div>
  );
}

export const section: PatternSection = { title: "EmptyState", order: 52, render: () => <EmptyStates /> };
