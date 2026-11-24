import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import type { PatternSection } from "../sections";

const CASES = [
  { id: "demo-switch-off", label: "Switch off", size: "default", checked: false, disabled: false },
  { id: "demo-switch-on", label: "Switch on", size: "default", checked: true, disabled: false },
  { id: "demo-switch-small", label: "Small switch on", size: "sm", checked: true, disabled: false },
  { id: "demo-switch-disabled", label: "Switch disabled", size: "default", checked: true, disabled: true },
] as const;

function Switches() {
  return (
    <div className="flex flex-col gap-4">
      {CASES.map((entry) => (
        <div key={entry.id} className="flex items-center gap-3">
          <Switch id={entry.id} size={entry.size} defaultChecked={entry.checked} disabled={entry.disabled} />
          <Label htmlFor={entry.id}>{entry.label}</Label>
        </div>
      ))}
    </div>
  );
}

export const section: PatternSection = { title: "Switches", order: 80, render: () => <Switches /> };
