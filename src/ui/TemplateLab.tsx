import { useState } from "react";
import { t } from "../i18n";
import type { Decoration } from "../core/decor";
import {
  captureTemplate,
  layTemplate,
  parseTemplate,
  readSavedTemplates,
  writeSavedTemplates,
  type SavedTemplate,
} from "../core/templates";

type Props = {
  decorations: Decoration[];
  frame: { W: number; H: number };
  onApply: (next: Decoration[]) => void;
};

/**
 * Where templates are made: lay out a frame the usual way, name it, and keep
 * it. What is kept is placed as shares of the frame's size, so it fits a frame
 * of any size, and can be copied out as text to send on or pasted back in.
 */
export default function TemplateLab({ decorations, frame, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<SavedTemplate[]>(readSavedTemplates);
  const [name, setName] = useState("");
  const [paste, setPaste] = useState("");
  const [note, setNote] = useState("");

  const keep = (next: SavedTemplate[]) => {
    setList(next);
    writeSavedTemplates(next);
  };

  const save = () => {
    if (decorations.length === 0) return;
    const item: SavedTemplate = {
      id: `mine-${Date.now()}`,
      name: name.trim() || t("Template {n}", { n: list.length + 1 }),
      savedAt: Date.now(),
      items: captureTemplate(decorations, frame),
    };
    keep([item, ...list]);
    setName("");
    setNote(t("Saved."));
  };

  const copy = async (tpl: SavedTemplate) => {
    const text = JSON.stringify({ name: tpl.name, items: tpl.items });
    try {
      await navigator.clipboard.writeText(text);
      setNote(t("Copied. Paste it wherever it should go."));
    } catch {
      setPaste(text);
      setNote(t("Copying was blocked, so it is in the box below: select it and copy."));
    }
  };

  const add = () => {
    const got = parseTemplate(paste.trim());
    if (!got) {
      setNote(t("That does not look like a template."));
      return;
    }
    keep([
      { id: `mine-${Date.now()}`, name: got.name || t("Template {n}", { n: list.length + 1 }), savedAt: Date.now(), items: got.items },
      ...list,
    ]);
    setPaste("");
    setNote(t("Added."));
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <button className="btn" style={{ width: "100%", justifyContent: "center" }} onClick={() => setOpen(!open)}>
        {open ? t("Hide the template lab") : t("Template lab")}
      </button>

      {open && (
        <div
          style={{
            marginTop: 8,
            border: "1px solid rgba(34,211,238,0.35)",
            borderRadius: 8,
            padding: 10,
            background: "rgba(34,211,238,0.05)",
            display: "grid",
            gap: 8,
          }}
        >
          <div style={{ fontSize: 12, opacity: 0.8 }}>
            {t("Lay out the frame as you would like the template to be, name it and keep it. It is kept in this browser, placed by the frame's size, so it fits a frame of any size.")}
          </div>

          <div style={{ display: "flex", gap: 6 }}>
            <input
              className="spinInput"
              type="text"
              value={name}
              maxLength={60}
              placeholder={t("Template name")}
              onChange={(e) => setName(e.target.value)}
            />
            <button className="btn" disabled={decorations.length === 0} onClick={save}>
              {t("Keep")}
            </button>
          </div>

          {list.length === 0 ? (
            <div style={{ fontSize: 12, opacity: 0.65 }}>{t("Nothing kept yet.")}</div>
          ) : (
            list.map((tpl) => (
              <div key={tpl.id} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={tpl.name}>
                  {tpl.name}
                </span>
                <button className="btn" style={{ padding: "2px 8px" }} onClick={() => onApply(layTemplate(tpl.items, frame))}>
                  {t("Use")}
                </button>
                <button className="btn" style={{ padding: "2px 8px" }} onClick={() => copy(tpl)}>
                  {t("Copy")}
                </button>
                <button
                  className="btn"
                  style={{ padding: "2px 8px" }}
                  onClick={() => keep(list.filter((x) => x.id !== tpl.id))}
                  title={t("Delete")}
                >
                  ✕
                </button>
              </div>
            ))
          )}

          <textarea
            className="spinInput"
            rows={3}
            value={paste}
            placeholder={t("Paste a template here to add it")}
            onChange={(e) => setPaste(e.target.value)}
            style={{ fontFamily: "monospace", fontSize: 11 }}
          />
          <button className="btn" disabled={paste.trim().length === 0} onClick={add}>
            {t("Add the pasted template")}
          </button>
          {note && <div style={{ fontSize: 12, opacity: 0.85 }}>{note}</div>}
        </div>
      )}
    </div>
  );
}
