import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import type { PatternSection } from "../sections";

function Choices() {
  return (
    <SelectContent>
      <SelectItem value="one">First choice</SelectItem>
      <SelectItem value="two">Second choice</SelectItem>
    </SelectContent>
  );
}

function Selects() {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="flex flex-col gap-2">
        <Label htmlFor="demo-select">Default select</Label>
        <Select defaultValue="one">
          <SelectTrigger id="demo-select" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <Choices />
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="demo-select-sm">Compact select</Label>
        <Select defaultValue="two">
          <SelectTrigger id="demo-select-sm" size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <Choices />
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="demo-select-invalid">Invalid select</Label>
        <Select>
          <SelectTrigger id="demo-select-invalid" aria-invalid="true" className="w-full">
            <SelectValue placeholder="Pick one" />
          </SelectTrigger>
          <Choices />
        </Select>
      </div>
    </div>
  );
}

export const section: PatternSection = { title: "Selects", order: 70, render: () => <Selects /> };
