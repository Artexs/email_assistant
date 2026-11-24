// One number with its label under it.
export function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div data-slot="stat-tile" className="rounded-lg bg-card px-5 py-4 text-card-foreground shadow-card">
      <div className="text-3xl font-extrabold tracking-tight tabular-nums">{value}</div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </div>
  );
}
