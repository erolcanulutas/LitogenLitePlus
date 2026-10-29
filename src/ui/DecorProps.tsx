import { FONTS, isText, type Decoration } from "../core/decor";

type Props = {
  decoration: Decoration;
  onPatch: (change: Partial<Decoration>) => void;
  onDuplicate: () => void;
  onRemove: () => void;
};

/**
 * What can be said about the selected decoration that its handles cannot:
 * raised or cut, its words and face if it is text, and the two ways out of it.
 * Size and turn are done on the decoration itself.
 */
export default function DecorProps({ decoration: d, onPatch, onDuplicate, onRemove }: Props) {
  return (
    <div
      style={{
        border: "1px solid rgba(34,211,238,0.35)",
        borderRadius: 8,
        padding: 10,
        background: "rgba(34,211,238,0.05)",
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
        {isText(d) ? "Text" : "Icon"} selected
      </div>

      <div style={{ display: "flex", gap: 4 }}>
        <button
          className={`segment ${!d.cut ? "active" : ""}`}
          style={{ flex: 1 }}
          onClick={() => onPatch({ cut: false })}
          title="Stand out from the frame's front face"
        >
          Raised
        </button>
        <button
          className={`segment ${d.cut ? "active" : ""}`}
          style={{ flex: 1 }}
          onClick={() => onPatch({ cut: true })}
          title="Cut clean through the frame, so light shows through"
        >
          Cut out
        </button>
      </div>

      {!d.cut && (
        <label
          className="shadeToggle"
          style={{ display: "flex", marginTop: 10 }}
          title="Instead of standing out, the decoration is set into the frame so its top is level with the face: the frame is recessed 1 mm to its shape and filled, which gives a colour in the surface when printed in colours. Any part with no frame to sink into — over the window or past the frame's edge — is raised instead."
        >
          <input
            type="checkbox"
            checked={d.flush === true}
            onChange={(e) => onPatch({ flush: e.target.checked })}
          />
          Flush with the frame
        </label>
      )}

      {isText(d) && (
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          <input
            className="spinInput"
            type="text"
            value={d.text ?? ""}
            maxLength={60}
            placeholder="Your words"
            onChange={(e) => onPatch({ text: e.target.value })}
          />
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <select
              className="spinInput"
              value={d.font ?? "sans"}
              onChange={(e) => onPatch({ font: e.target.value })}
            >
              {FONTS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
            <button
              className={`segment ${d.bold ? "active" : ""}`}
              style={{ fontWeight: 700, minWidth: 34 }}
              onClick={() => onPatch({ bold: !d.bold })}
              title="Bold"
            >
              B
            </button>
            <input
              type="color"
              value={d.color ?? "#1f2937"}
              onChange={(e) => onPatch({ color: e.target.value })}
              title="The colour it is printed in, when icons are printed in their own colours"
              style={{ width: 36, height: 30, padding: 0 }}
            />
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <button className="btn" style={{ flex: 1, justifyContent: "center" }} onClick={onDuplicate}>
          Duplicate
        </button>
        <button className="btn" style={{ flex: 1, justifyContent: "center" }} onClick={onRemove}>
          Remove
        </button>
      </div>
    </div>
  );
}
