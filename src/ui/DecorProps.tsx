import type { ReactNode } from "react";
import { t } from "../i18n";
import { FONTS, isText, type Decoration } from "../core/decor";

type Props = {
  decoration: Decoration;
  onPatch: (change: Partial<Decoration>) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  /** Ticked filaments are in use, so a colour is printed in the nearest of them. */
  snapsToFilaments?: boolean;
  onAlign: (to: "centreX" | "centreY" | "top" | "bottom") => void;
  onOrder: (by: 1 | -1) => void;
  canForward: boolean;
  canBack: boolean;
  /** Printing in colours, which is a setting of the whole frame but is reached from here. */
  colourOptions?: ReactNode;
};

/**
 * What can be said about the selected decoration that its handles cannot:
 * raised or cut, its words and face if it is text, and the two ways out of it.
 * Size and turn are done on the decoration itself.
 */
export default function DecorProps({
  decoration: d,
  onPatch,
  onDuplicate,
  onRemove,
  snapsToFilaments = false,
  onAlign,
  onOrder,
  canForward,
  canBack,
  colourOptions,
}: Props) {
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
        {isText(d) ? t("Text selected") : t("Icon selected")}
      </div>

      <div style={{ display: "flex", gap: 4 }}>
        <button
          className={`segment ${!d.cut ? "active" : ""}`}
          style={{ flex: 1 }}
          onClick={() => onPatch({ cut: false })}
          title={t("Stand out from the frame's front face")}
        >{t("Raised")}</button>
        <button
          className={`segment ${d.cut ? "active" : ""}`}
          style={{ flex: 1 }}
          onClick={() => onPatch({ cut: true })}
          title={t("Cut clean through the frame, so light shows through")}
        >{t("Cut out")}</button>
      </div>

      {!d.cut && (
        <label
          className="shadeToggle"
          style={{ display: "flex", marginTop: 10 }}
          title={t("Instead of standing out, the decoration is set into the frame so its top is level with the face: the frame is recessed 1 mm to its shape and filled, which gives a colour in the surface when printed in colours. Any part with no frame to sink into — over the window or past the frame's edge — is raised instead.")}
        >
          <input
            type="checkbox"
            checked={d.flush === true}
            onChange={(e) => onPatch({ flush: e.target.checked })}
          />{t("Flush with the frame")}</label>
      )}

      {!isText(d) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 13 }}>
          <span style={{ flex: 1 }}>{t("Custom single colour")}{!d.tint && <span style={{ opacity: 0.6 }}> · {t("now its own colours")}</span>}</span>
          <input
            type="color"
            value={d.tint ?? "#444444"}
            title={t("Print the icon as a silhouette in one colour")}
            onChange={(e) => onPatch({ tint: e.target.value })}
            style={{ width: 36, height: 30, padding: 0 }}
          />
          {d.tint && (
            <button className="btn" style={{ padding: "2px 8px" }} onClick={() => onPatch({ tint: undefined })}>{t("Original")}</button>
          )}
        </div>
      )}

      {isText(d) && (
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          <input
            className="spinInput"
            type="text"
            value={d.text ?? ""}
            maxLength={60}
            placeholder={t("Your words")}
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
                  {t(f.label)}
                </option>
              ))}
            </select>
            <button
              className={`segment ${d.bold ? "active" : ""}`}
              style={{ fontWeight: 700, minWidth: 34 }}
              onClick={() => onPatch({ bold: !d.bold })}
              title={t("Bold")}
            >
              B
            </button>
            <input
              type="color"
              value={d.color ?? "#1f2937"}
              onChange={(e) => onPatch({ color: e.target.value })}
              title={t("The colour it is printed in, when icons are printed in their own colours")}
              style={{ width: 36, height: 30, padding: 0 }}
            />
          </div>
          {snapsToFilaments && (
            <div style={{ fontSize: 11, opacity: 0.7 }}>{t("Your ticked filaments are in use, so this is printed in the nearest of them and a small change may not show. Untick them under Colours to print it exactly.")}</div>
          )}
        </div>
      )}

      {colourOptions && <div style={{ marginTop: 12 }}>{colourOptions}</div>}

      <div style={{ fontSize: 12, opacity: 0.75, marginTop: 12 }}>{t("Place")}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4, marginTop: 4 }}>
        {(
          [
            ["centreX", t("Centre ↔"), t("Centre across the frame")],
            ["centreY", t("Centre ↕"), t("Centre up and down the frame")],
            ["top", t("Top strip"), t("On the middle of the top border")],
            ["bottom", t("Bottom strip"), t("On the middle of the bottom border")],
          ] as const
        ).map(([id, label, hint]) => (
          <button
            key={id}
            className="btn"
            style={{ padding: "3px 2px", fontSize: 11, justifyContent: "center" }}
            title={hint}
            onClick={() => onAlign(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        <button
          className="btn"
          style={{ flex: 1, justifyContent: "center", fontSize: 12 }}
          disabled={!canForward}
          title={t("In front of the one above it")}
          onClick={() => onOrder(1)}
        >{t("Bring forward")}</button>
        <button
          className="btn"
          style={{ flex: 1, justifyContent: "center", fontSize: 12 }}
          disabled={!canBack}
          title={t("Behind the one below it")}
          onClick={() => onOrder(-1)}
        >{t("Send back")}</button>
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <button className="btn" style={{ flex: 1, justifyContent: "center" }} onClick={onDuplicate}>{t("Duplicate")}</button>
        <button className="btn" style={{ flex: 1, justifyContent: "center" }} onClick={onRemove}>{t("Remove")}</button>
      </div>
    </div>
  );
}
