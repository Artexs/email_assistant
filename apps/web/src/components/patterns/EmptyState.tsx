import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  text?: string;
  // `3` inside a `SectionCard`, whose title is already the `h2`.
  headingLevel?: 2 | 3;
  // The next-step buttons.
  children?: ReactNode;
}

// Nothing to show yet: a soft blob with an icon, a title, one sentence and the next step as buttons.
export function EmptyState({ icon: Icon, title, text, headingLevel = 2, children }: EmptyStateProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div data-slot="empty-state" className="mx-auto flex max-w-xl flex-col items-center gap-3 px-4 py-10 text-center">
      <div
        aria-hidden="true"
        className="relative mb-2 grid size-36 place-items-center rounded-[48%_52%_45%_55%/55%_45%_55%_45%] bg-primary-soft text-primary after:absolute after:top-2.5 after:-right-1.5 after:size-8 after:rounded-full after:bg-accent after:content-['']"
      >
        <Icon className="size-14" />
      </div>
      <Heading className="text-xl font-bold">{title}</Heading>
      {text === undefined ? null : <p className="text-base text-muted-foreground">{text}</p>}
      {children === undefined ? null : <div className="mt-2 flex flex-wrap justify-center gap-2.5">{children}</div>}
    </div>
  );
}
