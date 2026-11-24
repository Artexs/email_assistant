import type { Category } from "@ea/core";
import { cn } from "cn";

import { categoryLook } from "../../lib/category-look";

// A mail category: its icon and its label in the category colour. The colour is never the only signal.
export function CategoryPill({ category, label }: { category: Category; label: string }) {
  const { icon: Icon, tone } = categoryLook[category];
  return (
    <span
      data-slot="category-pill"
      data-category={category}
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold whitespace-nowrap",
        tone
      )}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {label}
    </span>
  );
}
