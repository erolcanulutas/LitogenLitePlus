import { MAX_FILAMENTS, type Filament } from "../core/filaments";

type Props = {
  value: Filament[];
  onChange: (next: Filament[]) => void;
  /** The colour a new filament starts out as. */
  addAs?: string;
};

/**
 * The colours of filament a person has to hand.
 *
 * Each has a tick, for whether a print is to be made in it, a swatch to change
 * its colour and a cross to take it off the list for good. Ticking is how one is
 * left out of a print without losing it.
 */
export default function FilamentEditor({ value, onChange, addAs = "#cccccc" }: Props) {
  const used = value.filter((f) => f.on).length;

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        {value.map((f, i) => (
          <span
            key={i}
            style={{
              position: "relative",
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "3px 6px 3px 5px",
              borderRadius: 8,
              border: `1px solid ${f.on ? "rgba(34,211,238,0.7)" : "rgba(148,163,184,0.3)"}`,
              background: f.on ? "rgba(34,211,238,0.08)" : "transparent",
            }}
          >
            <input
              type="checkbox"
              checked={f.on}
              title={f.on ? "Printing with this one" : "Tick to print with this one"}
              onChange={(e) => onChange(value.map((g, j) => (j === i ? { ...g, on: e.target.checked } : g)))}
            />
            <input
              type="color"
              value={f.c}
              onChange={(e) => onChange(value.map((g, j) => (j === i ? { ...g, c: e.target.value } : g)))}
              style={{ width: 32, height: 26, padding: 0 }}
            />
            <button
              type="button"
              title="Delete this filament from my list"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              style={{
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
            onClick={() => onChange([...value, { c: addAs, on: false }])}
          >
            + Add
          </button>
        )}
      </div>
      <div style={{ fontSize: 11, opacity: 0.65, marginTop: 6 }}>
        {value.length === 0
          ? "Add the filaments you have, then tick the ones to print with."
          : used === 0
            ? "None ticked, so prints use their own colours. Tick the ones to print with; unticked ones stay in your list."
            : `${used} ticked. Unticked ones stay in your list but are not used.`}
      </div>
    </div>
  );
}
