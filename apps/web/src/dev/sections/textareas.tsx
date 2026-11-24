import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import type { PatternSection } from "../sections";

function Textareas() {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="flex flex-col gap-2">
        <Label htmlFor="demo-textarea">Default textarea</Label>
        <Textarea id="demo-textarea" placeholder="Write a few lines" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="demo-textarea-invalid">Invalid textarea</Label>
        <Textarea id="demo-textarea-invalid" aria-invalid="true" defaultValue="Too short" />
      </div>
    </div>
  );
}

export const section: PatternSection = { title: "Textareas", order: 60, render: () => <Textareas /> };
