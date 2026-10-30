import { t } from "../i18n";
import { useState } from "react";
import { CATEGORIES, HAS_MORE, iconsIn, searchIcons } from "./decorIcons";

type Props = {
  onAdd: (icon: string) => void;
  onAddText: () => void;
};

/**
 * Where an icon, or some text, is picked to go on the frame.
 *
 * Search looks across every icon at once; with nothing typed the icons are
 * shown by subject, a tab for each.
 */
export default function IconPalette({ onAdd, onAddText }: Props) {
  const [category, setCategory] = useState(CATEGORIES[0].id);
  const [query, setQuery] = useState("");

  const searching = query.trim().length > 0;
  const shown = searching ? searchIcons(query) : iconsIn(category);
  const tabs = [
    ...CATEGORIES.map((c) => ({ id: c.id, label: c.label })),
    ...(HAS_MORE ? [{ id: "more", label: "More" }] : []),
  ];

  return (
    <div>
      <button
        className="btn"
        style={{ width: "100%", justifyContent: "center", fontWeight: 600 }}
        onClick={onAddText}
      >
        {t("+ Add text")}
      </button>

      <input
        className="spinInput"
        type="search"
        placeholder={t("Search icons…")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ marginTop: 8 }}
      />

      {!searching && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4, marginTop: 8 }}>
          {tabs.map((c) => (
            <button
              key={c.id}
              className={`segment ${category === c.id ? "active" : ""}`}
              style={{
                height: 36,
                padding: "2px 4px",
                fontSize: 11.5,
                lineHeight: 1.15,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                overflow: "hidden",
                minWidth: 0,
              }}
              onClick={() => setCategory(c.id)}
            >
              {t(c.label)}
            </button>
          ))}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(6, 1fr)",
          gap: 4,
          marginTop: 8,
          maxHeight: 300,
          overflowY: "auto",
          alignContent: "start",
        }}
      >
        {shown.map((icon) => (
          <button
            key={icon.id}
            title={icon.label}
            onClick={() => onAdd(icon.id)}
            style={{
              background: "rgba(255,255,255,0.88)",
              border: "1px solid rgba(255,255,255,0.25)",
              borderRadius: 6,
              padding: 3,
              cursor: "pointer",
            }}
          >
            <img src={icon.url} alt={icon.label} loading="lazy" style={{ width: "100%", display: "block" }} />
          </button>
        ))}
        {searching && shown.length === 0 && (
          <div style={{ gridColumn: "1 / -1", fontSize: 12, opacity: 0.7 }}>{t("No icon by that name.")}</div>
        )}
      </div>

      <div style={{ fontSize: 11, opacity: 0.6, marginTop: 6 }}>{t("Icons: Fluent Emoji by Microsoft, MIT licence.")}</div>
    </div>
  );
}
