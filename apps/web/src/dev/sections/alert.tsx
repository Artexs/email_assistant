import { InfoIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import type { PatternSection } from "../sections";

function AlertDemo() {
  return (
    <div className="flex flex-col gap-3">
      <Alert>
        <InfoIcon />
        <AlertTitle>Default alert</AlertTitle>
        <AlertDescription>A note with an icon, a title and a description.</AlertDescription>
      </Alert>
      <Alert variant="destructive">
        <InfoIcon />
        <AlertTitle>Destructive alert</AlertTitle>
        <AlertDescription>Something went wrong and needs a decision.</AlertDescription>
      </Alert>
      <Alert>A bare text child fills the full width.</Alert>
      <Alert variant="destructive">A bare destructive text child fills the full width.</Alert>
    </div>
  );
}

export const section: PatternSection = { title: "Alert", order: 51, render: () => <AlertDemo /> };
