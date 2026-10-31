import { useRef, useState } from "react";
import { t } from "../i18n";
import { hashFile, type HistoryEntry } from "../core/history";

type Props = {
  entries: HistoryEntry[];
  onClose: () => void;
  onDownloadFrame: (entry: HistoryEntry) => void | Promise<void>;
  onDownloadStand: (entry: HistoryEntry) => void;
  /** The picture was chosen again: go back to this piece of work with it. */
  onOpen: (entry: HistoryEntry, file: File) => void;
  onDelete: (entry: HistoryEntry) => void;
  note?: string | null;
};

const SHAPE_LABELS: Record<string, string> = {
  rectangle: "Rectangle",
  circle: "Circle",
  hexagon: "Hexagon",
  pentagon: "Pentagon",
  triangle: "Triangle",
};

/**
 * Past work. Each entry keeps the settings and the frame, never the picture, so
 * the frame and its candle stand can be downloaded at once, and the picture's
 * own model needs the same picture chosen again — which is checked.
 */
export default function HistoryPanel({ entries, onClose, onDownloadFrame, onDownloadStand, onOpen, onDelete, note }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<HistoryEntry | null>(null);

  const chosen = async (file: File) => {
    if (!target) return;
    const same = (await hashFile(file)) === target.fileHash;
    if (!same && !window.confirm(t("A different picture from the one used before was chosen. Are you sure you want to continue?"))) return;
    onOpen(target, file);
  };

  return (
    <div className="modalBackdrop" onClick={onClose}>
      <div className="modalCard" style={{ width: "min(640px, 94vw)", maxHeight: "85vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div className="modalTitle">{t("History")}</div>
        <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 10 }}>
          {t("Your past work, kept in this browser without the pictures. The frame and the candle stand download straight from here; for the picture's own model, choose the same picture again.")}
        </div>

        <input
          ref={input}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void chosen(f);
          }}
        />

        {entries.length === 0 && <div style={{ opacity: 0.7, fontSize: 13 }}>{t("Nothing here yet. Work is kept when you download a model or a frame.")}</div>}

        <div style={{ display: "grid", gap: 8 }}>
          {entries.map((e) => (
            <div key={e.id} style={{ border: "1px solid rgba(128,128,128,0.35)", borderRadius: 10, padding: 10, display: "grid", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13 }}>
                <b style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={e.name}>{e.name}</b>
                <span style={{ opacity: 0.65, whiteSpace: "nowrap" }}>{new Date(e.at).toLocaleString()}</span>
              </div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>
                {t(SHAPE_LABELS[e.studio.shapeId] ?? e.studio.shapeId)} · {e.frame.width} × {e.frame.height} mm
                {e.frame.curveDeg > 0 ? ` · ${e.frame.curveDeg}°` : ""} · {e.frame.decorations.length} {t("decorations")}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button className="btn" style={{ padding: "3px 10px" }} onClick={() => void onDownloadFrame(e)}>{t("Download frame")}</button>
                <button className="btn" style={{ padding: "3px 10px" }} onClick={() => onDownloadStand(e)}>{t("Download candle stand")}</button>
                <button
                  className="btn"
                  style={{ padding: "3px 10px" }}
                  disabled={!e.fileHash}
                  title={t("Choose the same picture again to open it with these settings")}
                  onClick={() => {
                    setTarget(e);
                    input.current?.click();
                  }}
                >
                  {t("Open with the picture…")}
                </button>
                <button className="btn" style={{ padding: "3px 10px", marginLeft: "auto" }} onClick={() => onDelete(e)} title={t("Delete")}>✕</button>
              </div>
            </div>
          ))}
        </div>

        {note && <div style={{ fontSize: 13, marginTop: 10 }}>{note}</div>}
        <div className="modalActions" style={{ marginTop: 14 }}>
          <button className="btn" onClick={onClose}>{t("Close")}</button>
        </div>
      </div>
    </div>
  );
}
