import type { ReactNode } from "react";
import { cn } from "cn";

const SIZES = {
  sm: { box: "size-12", stroke: 12 },
  default: { box: "size-14", stroke: 12 },
  lg: { box: "size-44", stroke: 11 },
} as const;

const VIEW = 100;

// Progress of a count ("2 of 10") as a ring. `label` names the picture for a screen reader; `children` sit in the middle.
// `value` above `max` draws a full ring; a `max` of 0 draws an empty one.
export function ProgressRing({
  value,
  max,
  size = "default",
  label,
  children,
}: {
  value: number;
  max: number;
  size?: keyof typeof SIZES;
  label: string;
  children?: ReactNode;
}) {
  const { box, stroke } = SIZES[size];
  const center = VIEW / 2;
  const radius = (VIEW - stroke) / 2;
  const whole = 2 * Math.PI * radius;
  const share = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0;
  return (
    <div data-slot="progress-ring" className={cn("relative inline-grid shrink-0 place-items-center", box)}>
      <svg role="img" aria-label={label} viewBox={`0 0 ${VIEW} ${VIEW}`} className="absolute inset-0 size-full">
        <circle cx={center} cy={center} r={radius} fill="none" strokeWidth={stroke} className="stroke-muted" />
        <circle
          data-part="arc"
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${share * whole} ${whole}`}
          transform={`rotate(-90 ${center} ${center})`}
          className="stroke-primary"
        />
      </svg>
      {children === undefined ? null : <span className="relative font-extrabold tabular-nums">{children}</span>}
    </div>
  );
}
