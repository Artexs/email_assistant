import type { PatternSection } from "../sections";

// A fill, the text colour that sits on it, and the class names a reader copies. Full class names, so the build finds them.
const FILLS = [
  { token: "background", fill: "bg-background", ink: "text-foreground" },
  { token: "card", fill: "bg-card", ink: "text-card-foreground" },
  { token: "popover", fill: "bg-popover", ink: "text-popover-foreground" },
  { token: "primary", fill: "bg-primary", ink: "text-primary-foreground" },
  { token: "secondary", fill: "bg-secondary", ink: "text-secondary-foreground" },
  // The muted text on the muted fill is below 4.5:1 in the light scheme today; the plain text colour shows the fill.
  { token: "muted", fill: "bg-muted", ink: "text-foreground" },
  { token: "accent", fill: "bg-accent", ink: "text-accent-foreground" },
] as const;

// A colour with no paired text colour: the chip carries no text.
const PLAIN = [
  { token: "destructive", fill: "bg-destructive" },
  { token: "border", fill: "bg-border" },
  { token: "input", fill: "bg-input" },
  { token: "ring", fill: "bg-ring" },
] as const;

const TYPE_SCALE = [
  { name: "text-xs", size: "text-xs" },
  { name: "text-sm", size: "text-sm" },
  { name: "text-base", size: "text-base" },
  { name: "text-lg", size: "text-lg" },
  { name: "text-xl", size: "text-xl" },
  { name: "text-2xl", size: "text-2xl" },
  { name: "text-3xl", size: "text-3xl" },
] as const;

const RADII = [
  { name: "rounded-sm", radius: "rounded-sm" },
  { name: "rounded-md", radius: "rounded-md" },
  { name: "rounded-lg", radius: "rounded-lg" },
  { name: "rounded-xl", radius: "rounded-xl" },
  { name: "rounded-full", radius: "rounded-full" },
] as const;

function Swatch({ token, fill, ink }: { token: string; fill: string; ink?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div
        className={`flex h-14 items-center justify-center rounded-md border border-border text-sm ${fill} ${ink ?? ""}`}
      >
        {ink === undefined ? "" : "Aa"}
      </div>
      <p className="text-sm text-foreground">{`${fill} · ${token}`}</p>
    </div>
  );
}

function Tokens() {
  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {FILLS.map((entry) => (
          <Swatch key={entry.token} {...entry} />
        ))}
        {PLAIN.map((entry) => (
          <Swatch key={entry.token} {...entry} />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {TYPE_SCALE.map((entry) => (
          <p key={entry.name} className={entry.size}>
            {`${entry.name} · The quick brown fox jumps over the lazy dog`}
          </p>
        ))}
      </div>
      <div className="flex flex-wrap gap-4">
        {RADII.map((entry) => (
          <div key={entry.name} className="flex flex-col items-center gap-2">
            <div className={`size-16 border-2 border-border bg-muted ${entry.radius}`} />
            <p className="text-sm">{entry.name}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export const section: PatternSection = { title: "Tokens", order: 10, render: () => <Tokens /> };
