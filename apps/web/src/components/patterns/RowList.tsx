import { Children, type ReactNode } from "react";

// Rows with a divider between them: none before the first, none after the last.
export function RowList({ children }: { children: ReactNode }) {
  const rows = Children.toArray(children);
  return (
    <div data-slot="row-list" className="flex flex-col">
      {rows.map((row, index) => (
        <div key={index} className="contents">
          {index === 0 ? null : <div data-slot="row-divider" aria-hidden="true" className="h-px bg-border" />}
          {row}
        </div>
      ))}
    </div>
  );
}
