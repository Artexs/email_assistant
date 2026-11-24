import { Skeleton } from "@/components/ui/skeleton";

import type { PatternSection } from "../sections";

// A skeleton pulses for ever in the panel. Here it is still: the generic spec waits for every animation to end before it scans.
function SkeletonDemo() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-4 w-2/3 animate-none" />
      <Skeleton className="h-4 w-1/2 animate-none" />
      <Skeleton className="h-12 w-full animate-none" />
    </div>
  );
}

export const section: PatternSection = { title: "Skeleton", order: 57, render: () => <SkeletonDemo /> };
