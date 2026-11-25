import { cn } from "cn";
import type { MouseEvent } from "react";

// A plain click changes the view without a page load; a click with a modifier key or a middle click keeps the link's own behaviour.
export function isPlainClick(
  event: Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">
): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export interface PillNavItem<K extends string> {
  key: K;
  href: string;
  label: string;
}

// Link tabs in a pill group: a muted track, and the current item in the colour of a card. Plain links with their own address;
// `aria-current="page"` marks the current one. With `onSelect`, a plain left click calls it instead of loading the page.
export function PillNav<K extends string>({
  label,
  items,
  current,
  onSelect,
}: {
  label: string;
  items: PillNavItem<K>[];
  current: K;
  onSelect?: (key: K) => void;
}) {
  return (
    <nav aria-label={label} className="inline-flex gap-0.5 rounded-full bg-muted p-1">
      {items.map((item) => (
        <a
          key={item.key}
          href={item.href}
          aria-current={item.key === current ? "page" : undefined}
          onClick={
            onSelect === undefined
              ? undefined
              : (event) => {
                  if (!isPlainClick(event)) return;
                  event.preventDefault();
                  onSelect(item.key);
                }
          }
          className={cn(
            "inline-flex min-h-11 items-center rounded-full px-4 text-sm font-bold focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none",
            item.key === current ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}
