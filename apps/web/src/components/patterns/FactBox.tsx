import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

// The warm box for a calm note or a "why" fact. It is a plain `div`, not an alert: no ARIA role.
export function FactBox({ icon: Icon, children }: { icon?: LucideIcon; children: ReactNode }) {
  return (
    <div
      data-slot="fact-box"
      className="flex items-start gap-3 rounded-md bg-accent px-4 py-3.5 text-base text-accent-foreground"
    >
      {Icon === undefined ? null : <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
