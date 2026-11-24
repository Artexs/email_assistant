import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { PatternSection } from "../sections";

// The compact input carries `h-9`, the 36 px size for a dense table.
function Inputs() {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="flex flex-col gap-2">
        <Label htmlFor="demo-input">Default input</Label>
        <Input id="demo-input" placeholder="Type here" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="demo-input-compact">Compact input</Label>
        <Input id="demo-input-compact" className="h-9" placeholder="Type here" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="demo-input-invalid">Invalid input</Label>
        <Input id="demo-input-invalid" aria-invalid="true" defaultValue="not an address" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="demo-input-disabled">Disabled input</Label>
        <Input id="demo-input-disabled" disabled defaultValue="Cannot change" />
      </div>
    </div>
  );
}

export const section: PatternSection = { title: "Inputs", order: 50, render: () => <Inputs /> };
