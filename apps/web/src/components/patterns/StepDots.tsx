// Up to this many steps are drawn as dots; more are drawn as one bar.
const MAX_DOTS = 8;

const BAR_WIDTH = 160;
const BAR_HEIGHT = 6;

// Progress through a short list ("Draft 1 of 5"). `label` is what a screen reader gets; the picture itself is hidden from it.
export function StepDots({ current, total, label }: { current: number; total: number; label: string }) {
  const count = Math.max(total, 0);
  const done = Math.min(Math.max(current, 0), count);
  return (
    <span data-slot="step-dots" role="img" aria-label={label} className="inline-flex items-center">
      {count <= MAX_DOTS ? (
        <span aria-hidden="true" className="flex gap-1.5">
          {Array.from({ length: count }, (_, index) => (
            <i
              key={index}
              data-step={index < done ? "done" : "todo"}
              className={`h-1.5 w-6 rounded-[3px] ${index < done ? "bg-primary" : "bg-muted"}`}
            />
          ))}
        </span>
      ) : (
        <svg aria-hidden="true" viewBox={`0 0 ${BAR_WIDTH} ${BAR_HEIGHT}`} className="h-1.5 w-40">
          <rect width={BAR_WIDTH} height={BAR_HEIGHT} rx={3} className="fill-muted" />
          <rect
            data-part="bar"
            width={(done / count) * BAR_WIDTH}
            height={BAR_HEIGHT}
            rx={3}
            className="fill-primary"
          />
        </svg>
      )}
    </span>
  );
}
