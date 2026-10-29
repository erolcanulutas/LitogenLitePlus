type Props = {
  value: string[];
  onChange: (next: string[]) => void;
  /** The colour a new filament starts out as. */
  addAs?: string;
};

const MAX_FILAMENTS = 12;

/**
 * The colours of filament a person has to hand.
 *
 * A row of swatches, each editable and each with a cross to take it away, and a
 * button to add another. What is made of them is up to whoever uses it: icons
 * and tones are printed in the nearest of them.
 */
export default function FilamentEditor({ value, onChange, addAs = "#cccccc" }: Props) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      {value.map((c, i) => (
        <span key={i} style={{ position: "relative", display: "inline-flex" }}>
          <input
            type="color"
            value={c}
            onChange={(e) => onChange(value.map((f, j) => (j === i ? e.target.value : f)))}
            style={{ width: 36, height: 30, padding: 0 }}
          />
          <button
            type="button"
            title="Remove this filament"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
            style={{
              position: "absolute",
              top: -6,
              right: -6,
              width: 16,
              height: 16,
              lineHeight: "14px",
              padding: 0,
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.35)",
              background: "rgba(15,23,42,0.92)",
              color: "#e2e8f0",
              fontSize: 10,
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </span>
      ))}
      {value.length < MAX_FILAMENTS && (
        <button
          type="button"
          className="btn"
          style={{ padding: "3px 10px" }}
          onClick={() => onChange([...value, addAs])}
        >
          + Add
        </button>
      )}
    </div>
  );
}
