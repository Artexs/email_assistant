import { cn } from "cn";

// A row of filters that toggle. `single` keeps exactly one chip pressed: a click on another chip replaces the value, a click on the
// pressed one changes nothing. Without `single`, a click adds or removes that value. The row wraps.
export function FilterChips<T extends string>({
  label,
  options,
  value,
  onChange,
  single = false,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T[];
  onChange(next: T[]): void;
  single?: boolean;
}) {
  const toggle = (chip: T) => {
    const pressed = value.includes(chip);
    if (single) {
      if (!pressed) onChange([chip]);
      return;
    }
    onChange(options.map((option) => option.value).filter((item) => (item === chip ? !pressed : value.includes(item))));
  };
  return (
    <div data-slot="filter-chips" role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value.includes(option.value)}
          onClick={() => toggle(option.value)}
          className={cn(
            "min-h-11 rounded-full border-2 border-border bg-card px-4 py-2 text-sm font-bold whitespace-nowrap text-muted-foreground",
            "hover:bg-secondary aria-pressed:border-primary aria-pressed:bg-primary-soft aria-pressed:text-primary",
            "outline-offset-2 focus-visible:outline-3 focus-visible:outline-ring"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
