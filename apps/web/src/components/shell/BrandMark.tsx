import { Mail } from "lucide-react";

import { cn } from "cn";

const sizes = {
  sm: "size-8 rounded-[11px_11px_11px_4px] [&>svg]:size-4",
  default: "size-9 rounded-[12px_12px_12px_4px] [&>svg]:size-4.5",
  lg: "size-12 rounded-[16px_16px_16px_5px] [&>svg]:size-6",
} as const;

const tones = {
  primary: "bg-primary text-primary-foreground",
  inverse: "bg-primary-foreground text-primary",
} as const;

// The brand tile: the envelope on a teal tile with one small corner. Pure markup (no hook, no `t()`), so a static Astro page can
// render it. It is decoration: the brand name next to it is the text a reader gets.
export function BrandMark({
  size = "default",
  tone = "primary",
}: {
  size?: keyof typeof sizes;
  tone?: keyof typeof tones;
}) {
  return (
    <span aria-hidden="true" className={cn("inline-grid shrink-0 place-items-center", sizes[size], tones[tone])}>
      <Mail />
    </span>
  );
}
