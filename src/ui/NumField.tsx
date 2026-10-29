import { useState } from "react";

/**
 * A number the person types, which may be half-typed on the way.
 *
 * Clamping on every keystroke makes a range with a floor above the first digit
 * impossible to type into: "4" is clamped to 30 before the "5" arrives. So the
 * text is the field's own until it is left, a value that is already in range
 * is passed on as it is typed, and the clamp is applied when focus moves away.
 */
export default function NumField({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (v: number) => Math.max(min, Math.min(max, v));

  return (
    <input
      className="spinInput"
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft ?? String(value)}
      onChange={(e) => {
        setDraft(e.target.value);
        const v = Number(e.target.value);
        if (e.target.value !== "" && !Number.isNaN(v) && v >= min && v <= max) onChange(v);
      }}
      onBlur={() => {
        if (draft !== null) {
          const v = Number(draft);
          if (draft !== "" && !Number.isNaN(v)) onChange(clamp(v));
        }
        setDraft(null);
      }}
    />
  );
}
