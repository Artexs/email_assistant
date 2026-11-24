import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";

import type { PatternSection } from "../sections";

function ToastDemo() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" onClick={() => toast("A toast message")}>
        Show a toast
      </Button>
      <Button variant="outline" onClick={() => toast.error("A toast error")}>
        Show an error toast
      </Button>
      <Toaster />
    </div>
  );
}

export const section: PatternSection = { title: "Toast", order: 58, render: () => <ToastDemo /> };
