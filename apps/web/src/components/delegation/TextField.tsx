import type { Ref } from "react";

import { Input } from "../ui/input";
import { Label } from "../ui/label";

export interface TextFieldProps {
  id: string;
  label: string;
  value: string;
  // Shown under the field and tied to it for a screen reader (`aria-describedby`); the field is also marked invalid.
  error?: string | null;
  // A hint that stays under the field.
  help?: string;
  type?: "text" | "email";
  readOnly?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  onChange?(value: string): void;
}

// A labelled text field of the delegate forms: the label, the field, the hint and the error, in the order that a screen reader reads them.
export function TextField({
  id,
  label,
  value,
  error = null,
  help,
  type = "text",
  readOnly,
  inputRef,
  onChange,
}: TextFieldProps) {
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = [help === undefined ? null : helpId, error === null ? null : errorId].filter(
    (part) => part !== null
  );
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        ref={inputRef}
        type={type}
        autoComplete="off"
        value={value}
        readOnly={readOnly}
        aria-invalid={error === null ? undefined : true}
        aria-describedby={describedBy.length === 0 ? undefined : describedBy.join(" ")}
        onChange={(event) => onChange?.(event.target.value)}
      />
      {help !== undefined && (
        <p id={helpId} className="text-sm text-muted-foreground">
          {help}
        </p>
      )}
      {error !== null && (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
