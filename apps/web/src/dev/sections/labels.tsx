import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { PatternSection } from "../sections";

function Labels() {
  return (
    <div className="flex max-w-sm flex-col gap-2">
      <Label htmlFor="demo-label-field">Label above a field</Label>
      <Input id="demo-label-field" defaultValue="Field value" />
    </div>
  );
}

export const section: PatternSection = { title: "Labels", order: 90, render: () => <Labels /> };
