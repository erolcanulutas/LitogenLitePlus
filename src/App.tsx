import React, { useMemo, useRef, useState, useEffect } from "react";
import ImageEditor from "./ui/ImageEditor";
import type { ImageEditorHandle } from "./ui/ImageEditor";

import ImageControls from "./ui/ImageControls";
import type { PreviewMesh } from "./ui/MeshPreview";

// three.js is most of the bundle, and plenty of sessions never open the 3D
// tab, so it is fetched on first use rather than on page load.
const MeshPreview = React.lazy(() => import("./ui/MeshPreview"));
import { SHAPES } from "./shapes";
import STLWorker from "./worker/stl.worker?worker";
import type { Quality } from "./core/quality";
import type { ShapeId } from "./core/types";

/* -------------------------------------------------------------
 * BRAND FONT & STYLES
 * ------------------------------------------------------------- */
const BRAND_STYLE = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@500;700;800&display=swap');

body {
  font-family: 'Outfit', sans-serif;
  margin: 0;
  overflow: hidden; 
  background-color: #020617;
  color: #f8fafc;
}

.appShell {
  display: flex;
  height: 100vh;
  width: 100vw;
  padding: 16px;
  gap: 16px;
  box-sizing: border-box;
}

.brand-title {
  font-family: 'Outfit', sans-serif;
  font-weight: 800;
  font-size: 24px;
  background: linear-gradient(135deg, #fff 0%, #a5f3fc 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.leftPanel {
  width: 340px;
  min-width: 340px;
  height: 100%;
  background: #0f172a;
  border: 1px solid #1e293b;
  border-radius: 16px;
  padding: 16px;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  scrollbar-width: thin;
}

.rightPanel {
  flex: 1;
  height: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.section {
  padding: 12px 0;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}

.label-row {
  display: flex;
  justify-content: space-between; 
  align-items: center;
  margin-bottom: 6px;
  height: 20px;
}

.info-icon-wrapper {
  position: relative;
  display: inline-flex;
}

.info-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  font-size: 11px;
  font-weight: bold;
  color: #64748b;
  border: 1px solid #334155;
  border-radius: 50%;
  cursor: help;
  transition: all 0.2s;
  background: rgba(255,255,255,0.02);
}

.info-icon:hover {
  color: #a5f3fc;
  border-color: #a5f3fc;
  background: rgba(165, 243, 252, 0.1);
}

.tooltip-content {
  visibility: hidden;
  width: 200px;
  background-color: #1e293b;
  color: #cbd5e1;
  text-align: center;
  border-radius: 6px;
  padding: 8px;
  position: absolute;
  z-index: 50;
  bottom: 135%;
  right: -10px;
  opacity: 0;
  transition: opacity 0.2s;
  font-size: 0.75rem;
  font-weight: 500;
  border: 1px solid #334155;
  box-shadow: 0 4px 12px rgba(0,0,0,0.5);
  pointer-events: none;
}

.tooltip-content::after {
  content: "";
  position: absolute;
  top: 100%;
  right: 14px;
  margin-left: -5px;
  border-width: 5px;
  border-style: solid;
  border-color: #334155 transparent transparent transparent;
}

.info-icon-wrapper:hover .tooltip-content {
  visibility: visible;
  opacity: 1;
}

.previewHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.viewTabs {
  display: flex;
  gap: 4px;
}

.viewTab {
  background: transparent;
  border: 1px solid transparent;
  color: #64748b;
  font-family: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.viewTab:hover { color: #cbd5e1; }

.viewTab.active {
  color: #a5f3fc;
  border-color: #1e293b;
  background: rgba(165, 243, 252, 0.08);
}

.shadeToggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  color: #64748b;
  cursor: pointer;
  user-select: none;
}

.staleChip {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #fbbf24;
  border: 1px solid rgba(251, 191, 36, 0.4);
  background: rgba(251, 191, 36, 0.12);
  border-radius: 999px;
  padding: 3px 9px;
}

.staleBanner {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  max-width: 90%;
  padding: 8px 14px;
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.92);
  border: 1px solid rgba(251, 191, 36, 0.35);
  color: #fde68a;
  font-size: 0.78rem;
  text-align: center;
  pointer-events: none;
}

.preview-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 24px;
  color: #475569;
  font-size: 0.85rem;
  pointer-events: none;
}

.segmented {
  display: flex;
  gap: 4px;
  background: #0f172a;
  border: 1px solid #1e293b;
  border-radius: 8px;
  padding: 3px;
}

.segment {
  flex: 1;
  background: transparent;
  border: none;
  color: #64748b;
  font-family: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  padding: 7px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.segment:hover { color: #cbd5e1; }

.segment.active {
  color: #0f172a;
  background: #a5f3fc;
}

.modalBackdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(2, 6, 23, 0.72);
  backdrop-filter: blur(2px);
}

.modalCard {
  width: 100%;
  max-width: 420px;
  background: #0f172a;
  border: 1px solid #1e293b;
  border-radius: 14px;
  padding: 22px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
}

.modalTitle {
  font-size: 1.05rem;
  font-weight: 800;
  color: #f8fafc;
  margin-bottom: 10px;
}

.modalBody {
  margin: 0 0 18px;
  font-size: 0.85rem;
  line-height: 1.55;
  color: #94a3b8;
}

.modalActions {
  display: grid;
  gap: 8px;
}

.linkBtn {
  display: block;
  width: 100%;
  margin-top: 14px;
  background: none;
  border: none;
  color: #475569;
  font-family: inherit;
  font-size: 0.75rem;
  cursor: pointer;
  text-decoration: underline;
}

.linkBtn:hover { color: #94a3b8; }

.bands {
  display: grid;
  gap: 6px;
}

.bandRow {
  display: flex;
  align-items: center;
  gap: 8px;
}

.bandSwatch {
  width: 34px;
  height: 30px;
  padding: 2px;
  border: 1px solid #334155;
  border-radius: 6px;
  background: #1e293b;
  cursor: pointer;
  flex: none;
}

.bandHeight { flex: 1; min-width: 0; }

.bandUnit {
  font-size: 0.75rem;
  color: #64748b;
  flex: none;
}

.bandTop {
  flex: 1;
  font-size: 0.78rem;
  color: #94a3b8;
}

.bandHint {
  margin-top: 6px;
  font-size: 0.7rem;
  color: #475569;
}

.bandDrop {
  flex: none;
  width: 26px;
  height: 26px;
  border: 1px solid #334155;
  border-radius: 6px;
  background: transparent;
  color: #94a3b8;
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
  transition: all 0.15s ease;
}

.bandDrop:hover {
  color: #fca5a5;
  border-color: #7f1d1d;
  background: rgba(127, 29, 29, 0.2);
}

.build-tag {
  font-size: 0.65rem;
  font-weight: 500;
  color: #64748b;
  letter-spacing: 0.02em;
  margin-top: 2px;
  user-select: all;
  cursor: text;
}

.leftPanel::-webkit-scrollbar { width: 4px; }
.leftPanel::-webkit-scrollbar-thumb { background: #334155; border-radius: 10px; }

.dynamic-footer {
  padding-top: 20px;
  color: #64748b;
  font-size: 0.7rem;
  text-align: center;
  opacity: 0.6;
  margin-top: auto; 
}

.custom-file-upload {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  height: 44px;
  padding: 0 12px;
  cursor: pointer;
  background-color: #1e293b;
  border: 1px dashed #475569;
  border-radius: 8px;
  color: #cbd5e1;
  font-size: 0.9rem;
  font-weight: 500;
  transition: all 0.2s ease;
  white-space: nowrap;
  overflow: hidden;
}

.custom-file-upload:hover {
  background-color: #334155;
  border-color: #94a3b8;
  color: #fff;
}

.custom-file-upload.drag-active {
  background-color: rgba(6, 182, 212, 0.15);
  border-color: #06b6d4;
  color: #fff;
}

.primaryBtn {
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.primaryBtn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(6, 182, 212, 0.2);
}

.status-msg {
  margin-top: 8px;
  font-size: 0.8rem;
  text-align: center;
  min-height: 1.2em;
}

.status-error { color: #ef4444; }
.status-success { color: #10b981; }
`;

const InfoIcon = ({ text }: { text: string }) => (
  <div className="info-icon-wrapper">
    <span className="info-icon">?</span>
    <span className="tooltip-content">{text}</span>
  </div>
);

const FOOTER_MESSAGES = [
  "Made with ❤️ by Erol Can Ulutaş",
  "Made with ❤️ by Erol Can Ulutaş",
  "Made with ❤️ by Erol Can Ulutaş",
  "Turn your memories into light.",
  "IcosaLume: The Geometry of Light.",
  "Ready for your 3D Printer.",
  "Precision lithophane generation.",
  "Bring your photos to life.",
  "Crafting light with IcosaLume.",
  "Shadows that tell a story.",
  "Layer by layer perfection.",
  "From pixels to plastic.",
  "Illuminate your world.",
  "Geometry meets photography.",
  "Your memories, set in plastic.",
  "Designed for makers.",
  "The art of hidden light.",
  "Create something unique today.",
  "Just slice and print.",
  "Polygons of light.",
  "Simply IcosaLume.",
  "Light up the room.",
  "Create something beautiful.",
  "Slice. Print. Illuminate.",
  "Shadows that tell a story.",
  "A new dimension for your photos.",
  "Infinite details in every layer.",
  "Make it permanent.",
  "The perfect personalized gift.",
  "See your memories glow.",
  "Tangible nostalgia.",
  "Where technology meets nostalgia.",
];

/**
 * Cheap content fingerprint for the editor's output.
 *
 * The editor re-emits on every redraw, including ones that change nothing —
 * a panel resize, say. Comparing content rather than identity keeps the
 * preview from claiming to be out of date when the picture is unchanged.
 */
function imageSignature(d: ImageData): string {
  const a = d.data;
  let hash = 0x811c9dc5;
  // A few thousand samples is ample to tell one crop from another.
  const step = Math.max(4, ((a.length / 4000) | 0) & ~3);
  for (let i = 0; i < a.length; i += step) {
    hash = Math.imul(hash ^ a[i], 0x01000193) >>> 0;
  }
  return `${d.width}x${d.height}:${hash.toString(16)}`;
}

const FLAT_HINT_KEY = "litogen.hideFlatHint";

/** Default palette for new bands: light at the bottom, darker going up. */
const BAND_PALETTE = [
  "#f2f2f2", "#1f2937", "#b91c1c", "#1d4ed8",
  "#047857", "#b45309", "#6d28d9", "#0f172a",
];

function downloadArrayBuffer(buf: ArrayBuffer, filename: string) {
  const blob = new Blob([buf], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [shapeId, setShapeId] = useState<ShapeId>("triangle");

  const shape = useMemo(() => SHAPES.find((s) => s.id === shapeId)!, [shapeId]);

  const [file, setFile] = useState<File | null>(null);
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [imgData, setImgData] = useState<ImageData | null>(null);

  // Fills whatever the photo does not cover. White by default: untouched
  // corners then come out thin and bright rather than solid and opaque.
  const [bgColor, setBgColor] = useState("#ffffff");

  const [rotate, setRotate] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);

  const editorRef = useRef<ImageEditorHandle>(null);

  const [widthMm, setWidthMm] = useState(80);
  const [minT, setMinT] = useState(0.8);
  const [maxT, setMaxT] = useState(3.0);
  const [frameMm, setFrameMm] = useState(1.5);
  const [layerHeight, setLayerHeight] = useState(0.2);

  // Band boundaries as layer counts through the thickness, ascending, plus one
  // colour per band (so one more colour than boundaries). Empty means a
  // single-colour STL. Counting in layers keeps every boundary on something
  // the printer can actually land on.
  const [splitLayers, setSplitLayers] = useState<number[]>([]);
  const [colors, setColors] = useState<string[]>(["#f2f2f2"]);

  const totalLayers = Math.max(1, Math.round(maxT / layerHeight));
  const [quality, setQuality] = useState<Quality>("normal");
  const [smoothing, setSmoothing] = useState(1.0);
  const [levels, setLevels] = useState(0);

  // Vertical prints the lithophane standing up; flat lays it down so the
  // relief runs along the print axis.
  const [orientation, setOrientation] = useState<"vertical" | "flat">(
    "vertical",
  );
  const [flatHintOpen, setFlatHintOpen] = useState(false);

  const [previewMesh, setPreviewMesh] = useState<PreviewMesh | null>(null);

  // The preview shows whatever was generated last. Without tracking which
  // settings produced it, changing the crop and switching tabs shows the old
  // model with no hint that it is out of date — which reads as the generator
  // disagreeing with the editor.
  const [imgVersion, setImgVersion] = useState(0);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const imgSigRef = useRef("");

  /** Everything the generated mesh depends on. */
  const settingsKey = JSON.stringify([
    imgVersion, shapeId, widthMm, minT, maxT, frameMm,
    quality, smoothing, levels, layerHeight, splitLayers, colors, orientation,
  ]);
  const previewStale = previewMesh !== null && previewKey !== settingsKey;
  const [view, setView] = useState<"editor" | "preview">("editor");
  const [flatShading, setFlatShading] = useState(true);
  const [lightBackground, setLightBackground] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [backlit, setBacklit] = useState(false);

  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{
    type: "error" | "success";
    text: string;
  } | null>(null);

  const [footerText, setFooterText] = useState(FOOTER_MESSAGES[0]);
  const [isDragOver, setIsDragOver] = useState(false);

  const jobIdRef = useRef(0);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const randomMsg =
      FOOTER_MESSAGES[Math.floor(Math.random() * FOOTER_MESSAGES.length)];
    setFooterText(randomMsg);
  }, []);

  useEffect(() => {
    if (!file) {
      setImgEl(null);
      return;
    }

    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      setImgEl(img);
      URL.revokeObjectURL(url);
    };

    img.src = url;
    setStatusMsg(null);
  }, [file]);

  function resetThicknessDefaults() {
    setMaxT(3.0);
    setMinT(0.8);
    setFrameMm(1.5);
    setSplitLayers([]);
    setColors(["#f2f2f2"]);
  }

  function handleImageData(d: ImageData | null) {
    setImgData(d);
    const sig = d ? imageSignature(d) : "";
    if (sig !== imgSigRef.current) {
      imgSigRef.current = sig;
      setImgVersion((v) => v + 1);
    }
  }

  function setBandColor(index: number, value: string) {
    setColors((prev) => prev.map((c, i) => (i === index ? value : c)));
  }

  /**
   * Drops or pulls in band boundaries that no longer fit a thinner model.
   *
   * Splits and colours have to move together, so both are worked out here and
   * set outright. Deriving one inside the other's updater does not work —
   * updaters run later, not during the call.
   */
  function clampBandsTo(newMaxT: number) {
    const limit = Math.max(1, Math.round(newMaxT / layerHeight)) - 1;

    const next: number[] = [];
    for (const s of splitLayers) {
      const v = Math.min(s, limit);
      if (v >= 1 && (next.length === 0 || v > next[next.length - 1])) {
        next.push(v);
      }
    }

    if (next.length === splitLayers.length) {
      if (next.some((v, i) => v !== splitLayers[i])) setSplitLayers(next);
      return;
    }

    setSplitLayers(next);
    setColors(colors.slice(0, next.length + 1));
  }

  /** Sets a band's last layer, keeping the list strictly increasing. */
  function setSplitAt(index: number, value: number) {
    if (Number.isNaN(value)) return;
    setSplitLayers((prev) => {
      const lowest = index > 0 ? prev[index - 1] + 1 : 1;
      const highest =
        index + 1 < prev.length ? prev[index + 1] - 1 : totalLayers - 1;
      if (highest < lowest) return prev;

      const clamped = Math.max(lowest, Math.min(highest, Math.round(value)));
      return prev.map((s, i) => (i === index ? clamped : s));
    });
  }

  /** Where a new boundary would go: halfway to the top, on a layer. */
  function nextBandBoundary(): number | null {
    const last = splitLayers.length > 0 ? splitLayers[splitLayers.length - 1] : 0;
    const next = Math.round((last + totalLayers) / 2);
    if (splitLayers.length >= 7) return null;
    if (next <= last || next > totalLayers - 1) return null;
    return next;
  }

  function addBand() {
    const next = nextBandBoundary();
    if (next === null) return;

    const wasSingleColour = splitLayers.length === 0;

    setSplitLayers([...splitLayers, next]);
    setColors([...colors, BAND_PALETTE[colors.length % BAND_PALETTE.length]]);

    // Standing up, the bands run through the model's depth, so every layer
    // contains all of them and the printer swaps filament on each one. Worth
    // saying once, at the moment it starts to matter.
    if (
      wasSingleColour &&
      orientation === "vertical" &&
      localStorage.getItem(FLAT_HINT_KEY) !== "1"
    ) {
      setFlatHintOpen(true);
    }
  }

  function removeBand(index: number) {
    setSplitLayers((prev) => prev.filter((_, i) => i !== index));
    setColors((prev) => prev.filter((_, i) => i !== index + 1));
  }

  function ensureWorker() {
    if (!workerRef.current) workerRef.current = new STLWorker();
    return workerRef.current!;
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFile = e.dataTransfer.files[0];

      if (droppedFile.type.startsWith("image/")) {
        setFile(droppedFile);
        setStatusMsg(null);
      }
    }
  };

  async function generate(download = true) {
    if (!imgData || isGenerating) return;

    setIsGenerating(true);
    setStatusMsg(null);

    const currentJobId = ++jobIdRef.current;
    const w = ensureWorker();

    try {
      const p = new Promise<{
        file: ArrayBuffer;
        extension: "stl" | "3mf";
        preview: ArrayBuffer;
        previewTriangles: number;
        previewBands: number[];
      }>((resolve, reject) => {
        const handler = (e: MessageEvent) => {
          if (e.data.ok) {
            resolve({
              file: e.data.file,
              extension: e.data.extension,
              preview: e.data.preview,
              previewTriangles: e.data.previewTriangles,
              previewBands: e.data.previewBands,
            });
          } else {
            reject(e.data.error);
          }

          w.removeEventListener("message", handler);
        };

        w.addEventListener("message", handler);

        w.postMessage({
          id: currentJobId,
          shapeId,
          image: imgData,
          widthMm,
          heightMm: widthMm,
          minT,
          maxT,
          frameMm,
          quality,
          smoothing,
          levels,
          orientation,
          splitHeightsMm: splitLayers.map((n) => +(n * layerHeight).toFixed(4)),
          colors,
          layerHeight,
          emboss: "back",
        });
      });

      const result = await p;

      if (jobIdRef.current === currentJobId) {
        setPreviewMesh({
          positions: new Float32Array(result.preview),
          triangleCount: result.previewTriangles,
          bandStarts: result.previewBands,
          colors: [...colors],
          // Where each band ends through the thickness, so the backlit shader
          // can accumulate absorption band by band.
          bandBounds: [
            ...splitLayers.map((n) => +(n * layerHeight).toFixed(4)),
            maxT,
          ],
        });
        setPreviewKey(settingsKey);
        setView("preview");

        if (download) {
          const baseName = file?.name.replace(/\.[^/.]+$/, "") || "image";
          downloadArrayBuffer(
            result.file,
            `litogen-${baseName}.${result.extension}`,
          );
        }

        setStatusMsg({
          type: "success",
          text: download
            ? `${result.extension.toUpperCase()} Ready! · ${result.previewTriangles.toLocaleString()} tris`
            : `${result.previewTriangles.toLocaleString()} triangles`,
        });
      }
    } catch {
      setStatusMsg({ type: "error", text: "Failed!" });
    } finally {
      if (jobIdRef.current === currentJobId) setIsGenerating(false);
    }
  }

  return (
    <div className="appShell">
      <style>{BRAND_STYLE}</style>

      <aside className="leftPanel">
        <div className="panelHeader" style={{ paddingBottom: 10 }}>
          <div className="brand-title">Litogen Lite+</div>
          <div className="build-tag" title="Bug bildirirken bu satırı da yaz">
            v{__APP_VERSION__} · {__BUILD_SHA__} · {__BUILD_DATE__}
          </div>
        </div>

        <div className="section">
          <label
            className={`custom-file-upload ${isDragOver ? "drag-active" : ""}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <span>📷 {file.name.slice(0, 10)}...</span>
            ) : (
              <span>📂 Select Image or Drag&Drop</span>
            )}
          </label>

        </div>

        <div className="section">
          <div className="label-row">
            <label className="miniLabel">Shape</label>
            <InfoIcon text="Choose the geometric base shape for your lithophane (Triangle, Circle, Hexagon, Pentagon)." />
          </div>

          <select
            className="spinInput"
            value={shapeId}
            onChange={(e) => setShapeId(e.target.value as ShapeId)}
          >
            {SHAPES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>

          <div className="label-row" style={{ marginTop: 12 }}>
            <label className="miniLabel">Width (mm)</label>
            <InfoIcon text="Horizontal width of the print, defined as the maximum distance between the leftmost and rightmost points." />
          </div>

          <div className="spinRow">
            <input
              className="spinInput"
              type="number"
              step={0.01}
              value={widthMm}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!Number.isNaN(v)) setWidthMm(+v.toFixed(2));
              }}
            />

            <div className="spinBtns">
              <button
                className="spinBtn"
                onClick={() => setWidthMm((v) => +(v + 1).toFixed(2))}
              >
                ▲
              </button>
              <button
                className="spinBtn"
                onClick={() =>
                  setWidthMm((v) => +(Math.max(10, v - 1)).toFixed(2))
                }
              >
                ▼
              </button>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button
              className="btn"
              style={{
                flex: 1,
                justifyContent: "center",
                padding: "8px 4px",
                fontSize: "0.85rem",
              }}
              onClick={() => {
                if (shapeId === "pentagon") {
                  const side = 50;
                  const width = side * 1.618;
                  setWidthMm(+width.toFixed(2));
                } else {
                  setWidthMm(60);
                }
                resetThicknessDefaults();
              }}
            >
              Small
            </button>

            <button
              className="btn"
              style={{
                flex: 1,
                justifyContent: "center",
                padding: "8px 4px",
                fontSize: "0.85rem",
              }}
              onClick={() => {
                if (shapeId === "pentagon") {
                  const side = 60;
                  const width = side * 1.618;
                  setWidthMm(+width.toFixed(2));
                } else {
                  setWidthMm(80);
                }
                resetThicknessDefaults();
              }}
            >
              Large
            </button>
          </div>
        </div>

        <div className="section">
          <div className="sectionTitle" style={{ marginBottom: 12 }}>
            Thickness
          </div>

          <div className="label-row">
            <label className="miniLabel">Max (mm)</label>
            <InfoIcon text="The thickness of the darkest (black) areas. Ideal value: 2.5mm - 3.2mm." />
          </div>

          <div className="spinRow">
            <input
              className="spinInput"
              type="number"
              step={0.1}
              value={maxT}
              onChange={(e) => {
                const v = +e.target.value;
                setMaxT(v);
                clampBandsTo(v);
              }}
            />
            <div className="spinBtns">
              <button
                className="spinBtn"
                onClick={() => setMaxT(+(maxT + 0.1).toFixed(2))}
              >
                ▲
              </button>
              <button
                className="spinBtn"
                onClick={() => {
                  const next = +(maxT - 0.1).toFixed(2);
                  setMaxT(next);
                  clampBandsTo(next);
                }}
              >
                ▼
              </button>
            </div>
          </div>

          <div className="label-row">
            <label className="miniLabel">Min (mm)</label>
            <InfoIcon text="The thickness of the lightest (white) areas. Do not go below 0.6mm." />
          </div>

          <div className="spinRow">
            <input
              className="spinInput"
              type="number"
              step={0.1}
              value={minT}
              onChange={(e) => setMinT(+e.target.value)}
            />
            <div className="spinBtns">
              <button
                className="spinBtn"
                onClick={() => setMinT((v) => +(v + 0.1).toFixed(2))}
              >
                ▲
              </button>
              <button
                className="spinBtn"
                onClick={() => setMinT((v) => +(v - 0.1).toFixed(2))}
              >
                ▼
              </button>
            </div>
          </div>

          <div className="label-row">
            <label className="miniLabel">Frame (mm)</label>
            <InfoIcon text="The thickness of the frame surrounding the model." />
          </div>

          <div className="spinRow">
            <input
              className="spinInput"
              type="number"
              step={0.1}
              value={frameMm}
              onChange={(e) => setFrameMm(+e.target.value)}
            />
            <div className="spinBtns">
              <button
                className="spinBtn"
                onClick={() => setFrameMm((v) => +(v + 0.1).toFixed(2))}
              >
                ▲
              </button>
              <button
                className="spinBtn"
                onClick={() => setFrameMm((v) => +(v - 0.1).toFixed(2))}
              >
                ▼
              </button>
            </div>
          </div>

          <div className="label-row">
            <label className="miniLabel">Print Orientation</label>
            <InfoIcon text="Vertical stands the lithophane up — best for single colour. Flat lays it down so the relief runs along the print axis, which turns each colour band into a contiguous run of layers: one filament change per band instead of one per layer." />
          </div>

          <div className="segmented">
            <button
              className={`segment ${orientation === "vertical" ? "active" : ""}`}
              onClick={() => setOrientation("vertical")}
            >
              Vertical
            </button>
            <button
              className={`segment ${orientation === "flat" ? "active" : ""}`}
              onClick={() => setOrientation("flat")}
            >
              Flat
            </button>
          </div>

          <div className="label-row" style={{ marginTop: 12 }}>
            <label className="miniLabel">Layer Height (mm)</label>
            <InfoIcon text="Your slicer's layer height. Colour bands are counted in these, so every boundary lands on a layer the printer can actually stop at." />
          </div>

          <div className="spinRow">
            <input
              className="spinInput"
              type="number"
              min={0.04}
              max={0.4}
              step={0.02}
              value={layerHeight}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!Number.isNaN(v) && v >= 0.04 && v <= 0.4) {
                  setLayerHeight(+v.toFixed(2));
                }
              }}
            />
          </div>

          <div className="label-row" style={{ marginTop: 12 }}>
            <label className="miniLabel">
              Color Bands · {totalLayers} layers
            </label>
            <InfoIcon text="Slices the lithophane into stacked bodies through its thickness and exports a 3MF instead of an STL. The bodies come out as one part made of several bodies, so they stay registered — assign a filament to each. One band means a plain single-colour STL." />
          </div>

          <div className="bands">
            {colors.map((color, b) => {
              const first = b === 0 ? 1 : splitLayers[b - 1] + 1;
              const isTop = b >= splitLayers.length;
              const last = isTop ? totalLayers : splitLayers[b];

              return (
                <div className="bandRow" key={b}>
                  <input
                    className="bandSwatch"
                    type="color"
                    value={color}
                    onChange={(e) => setBandColor(b, e.target.value)}
                    title={`Band ${b + 1} colour`}
                  />

                  <span className="bandUnit">layer {first} –</span>

                  {isTop ? (
                    <span className="bandTop">
                      {last}
                      {splitLayers.length > 0 && " (top)"}
                    </span>
                  ) : (
                    <>
                      <input
                        className="spinInput bandHeight"
                        type="number"
                        min={1}
                        max={totalLayers - 1}
                        step={1}
                        value={last}
                        onChange={(e) => setSplitAt(b, Number(e.target.value))}
                      />
                      <button
                        className="bandDrop"
                        onClick={() => removeBand(b)}
                        title="Remove this band"
                      >
                        ×
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <div className="bandHint">
            {splitLayers.length === 0
              ? `single colour · ${(totalLayers * layerHeight).toFixed(2)} mm thick`
              : `${(layerHeight).toFixed(2)} mm per layer · exports as 3MF`}
          </div>

          <button
            className="btn"
            style={{ width: "100%", marginTop: 8, justifyContent: "center" }}
            onClick={addBand}
            disabled={nextBandBoundary() === null}
            title={
              nextBandBoundary() === null
                ? "No layers left to give a new band — raise Max thickness or lower Layer height"
                : undefined
            }
          >
            + Add color band
          </button>

          <button
            className="btn"
            style={{ marginTop: 12, width: "100%" }}
            onClick={resetThicknessDefaults}
          >
            Reset Defaults
          </button>
        </div>

        <div className="section">
          <div className="label-row">
            <div className="sectionTitle">Quality</div>
            <InfoIcon text="High: More detail and more triangles (larger file). Normal: Balanced." />
          </div>

          <select
            className="spinInput"
            value={quality}
            onChange={(e) => setQuality(e.target.value as Quality)}
          >
            <option value="draft">Draft</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select>

          <div className="label-row" style={{ marginTop: 12 }}>
            <label className="miniLabel">Surface</label>
            <InfoIcon text="Photo samples the picture as a continuous surface. Graphic quantises it into bands and cuts the mesh along the picture's own contours, so hard edges come out exactly straight instead of stair-stepped. Use Graphic for logos, text and line art." />
          </div>

          <select
            className="spinInput"
            value={levels === 0 ? "photo" : "graphic"}
            onChange={(e) => setLevels(e.target.value === "photo" ? 0 : 2)}
          >
            <option value="photo">Photo (smooth)</option>
            <option value="graphic">Graphic (hard edges)</option>
          </select>

          {levels > 0 && (
            <>
              <div className="label-row" style={{ marginTop: 12 }}>
                <label className="miniLabel">Bands</label>
                <InfoIcon text="How many brightness levels the picture is reduced to. 2 gives a pure silhouette — right for a black and white logo. More bands keep some shading, at the cost of extra walls." />
              </div>

              <div className="spinRow">
                <input
                  className="spinInput"
                  type="number"
                  min={2}
                  max={16}
                  step={1}
                  value={levels}
                  onChange={(e) => {
                    const v = Math.round(Number(e.target.value));
                    if (!Number.isNaN(v)) setLevels(Math.max(2, Math.min(16, v)));
                  }}
                />
                <div className="spinBtns">
                  <button
                    className="spinBtn"
                    onClick={() => setLevels((v) => Math.min(16, v + 1))}
                  >
                    ▲
                  </button>
                  <button
                    className="spinBtn"
                    onClick={() => setLevels((v) => Math.max(2, v - 1))}
                  >
                    ▼
                  </button>
                </div>
              </div>
            </>
          )}

          <div className="label-row" style={{ marginTop: 12 }}>
            <label className="miniLabel">Edge Smoothing</label>
            <InfoIcon text="Widens sampling beyond one mesh cell. Low keeps edges crisp but hard edges come out stair-stepped; high trades a little sharpness for clean edges. Photos ~1, logos and line art 1.5-3. Costs no extra triangles." />
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <input
              className="range"
              type="range"
              min={0.4}
              max={3}
              step={0.1}
              value={smoothing}
              onChange={(e) => setSmoothing(+Number(e.target.value).toFixed(1))}
            />
            <div className="spinRow">
              <input
                className="spinInput"
                type="number"
                min={0.4}
                max={3}
                step={0.1}
                value={smoothing}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isNaN(v)) {
                    setSmoothing(+Math.max(0.4, Math.min(3, v)).toFixed(1));
                  }
                }}
              />
              <div className="spinBtns">
                <button
                  className="spinBtn"
                  onClick={() => setSmoothing((v) => +Math.min(3, v + 0.1).toFixed(1))}
                >
                  ▲
                </button>
                <button
                  className="spinBtn"
                  onClick={() => setSmoothing((v) => +Math.max(0.4, v - 0.1).toFixed(1))}
                >
                  ▼
                </button>
              </div>
            </div>
          </div>
        </div>

        <div style={{ padding: "10px 0" }}>
          <button
            className="primaryBtn"
            style={{ width: "100%", opacity: isGenerating ? 0.7 : 1 }}
            onClick={() => generate(true)}
            disabled={isGenerating}
          >
            {isGenerating ? "Processing..." : "Generate STL"}
          </button>

          <button
            className="btn"
            style={{ width: "100%", marginTop: 8, justifyContent: "center" }}
            onClick={() => generate(false)}
            disabled={isGenerating}
            title="Build the model and show it in 3D without downloading"
          >
            Preview in 3D
          </button>

          {statusMsg && (
            <div
              className={`status-msg ${
                statusMsg.type === "error" ? "status-error" : "status-success"
              }`}
            >
              {statusMsg.text}
            </div>
          )}
        </div>

        <div className="dynamic-footer">{footerText}</div>
      </aside>

      <main className="rightPanel">
        <div
          className="previewCard"
          style={{
            height: "100%",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            minHeight: 0,
          }}
        >
          <div className="previewHeader">
            <div className="viewTabs">
              <button
                className={`viewTab ${view === "editor" ? "active" : ""}`}
                onClick={() => setView("editor")}
              >
                Image Editor
              </button>
              <button
                className={`viewTab ${view === "preview" ? "active" : ""}`}
                onClick={() => setView("preview")}
              >
                3D Preview
              </button>
            </div>

            {view === "editor" && (
              <label
                className="shadeToggle"
                title="Fills anything the photo does not cover. Leave it white so bare areas print thin and let light through — otherwise they come out as the thickest, most opaque part of the model."
              >
                Backdrop
                <input
                  className="bandSwatch"
                  type="color"
                  value={bgColor}
                  onChange={(e) => setBgColor(e.target.value)}
                />
              </label>
            )}

            {view === "preview" && (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {previewStale && <span className="staleChip">out of date</span>}
                <label
                  className="shadeToggle"
                  title="Light it from behind, the way a lithophane is looked at. Transmission falls off exponentially with thickness, so this shows whether the picture will read once printed."
                >
                  <input
                    type="checkbox"
                    checked={backlit}
                    onChange={(e) => setBacklit(e.target.checked)}
                  />
                  Backlit
                </label>
                <label
                  className="shadeToggle"
                  title="Draw every triangle in one tone, the way a slicer does, so the mesh's real facets are visible. Off smooths the normals."
                >
                  <input
                    type="checkbox"
                    checked={flatShading}
                    onChange={(e) => setFlatShading(e.target.checked)}
                    disabled={backlit}
                  />
                  Flat shading
                </label>
                <label className="shadeToggle">
                  <input
                    type="checkbox"
                    checked={lightBackground}
                    onChange={(e) => setLightBackground(e.target.checked)}
                  />
                  Light background
                </label>
                <label className="shadeToggle">
                  <input
                    type="checkbox"
                    checked={showGrid}
                    onChange={(e) => setShowGrid(e.target.checked)}
                  />
                  Grid
                </label>
              </div>
            )}
          </div>

          {/* Both stay mounted: the editor owns the crop, and remounting the
              WebGL context on every tab switch is wasteful. */}
          <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
            <div
              style={{
                position: "absolute",
                inset: 0,
                visibility: view === "editor" ? "visible" : "hidden",
              }}
            >
              <ImageEditor
                ref={editorRef}
                image={imgEl}
                cropRatio={shape.cropRatio}
                shapeId={shapeId}
                rotate={rotate}
                flipH={flipH}
                flipV={flipV}
                bgColor={bgColor}
                frameMm={frameMm}
                widthMm={widthMm}
                onImageData={handleImageData}
              />
            </div>

            <div
              style={{
                position: "absolute",
                inset: 0,
                visibility: view === "preview" ? "visible" : "hidden",
              }}
            >
              {(view === "preview" || previewMesh) && (
                <React.Suspense
                  fallback={<div className="preview-empty">Loading viewer…</div>}
                >
                  <MeshPreview
                    mesh={previewMesh}
                    flatShading={flatShading}
                    lightBackground={lightBackground}
                    showGrid={showGrid}
                    backlit={backlit}
                  />
                </React.Suspense>
              )}

              {previewStale && (
                <div className="staleBanner">
                  Settings changed since this was built — press{" "}
                  <strong>Preview in 3D</strong> to rebuild.
                </div>
              )}
            </div>
          </div>

          {view === "editor" && (
          <ImageControls
            rotate={rotate}
            setRotate={setRotate}
            flipH={flipH}
            setFlipH={setFlipH}
            flipV={flipV}
            setFlipV={setFlipV}
            onReset={() => {
              setRotate(0);
              setFlipH(false);
              setFlipV(false);
              editorRef.current?.reset();
            }}
          />
          )}
        </div>
      </main>

      {flatHintOpen && (
        <div className="modalBackdrop" onClick={() => setFlatHintOpen(false)}>
          <div className="modalCard" onClick={(e) => e.stopPropagation()}>
            <div className="modalTitle">Print this one flat?</div>
            <p className="modalBody">
              Standing up, the colour bands run through the model's depth, so
              every layer contains all of them and the printer changes filament
              on <em>each layer</em>.
              <br />
              <br />
              Laid flat, the bands stack along the print axis instead — each one
              becomes a contiguous run of layers, so it is a single change per
              band. That is also what makes the layer numbers here line up with
              your slicer.
            </p>

            <div className="modalActions">
              <button
                className="primaryBtn"
                onClick={() => {
                  setOrientation("flat");
                  setFlatHintOpen(false);
                }}
              >
                Switch to flat
              </button>
              <button
                className="btn"
                style={{ justifyContent: "center" }}
                onClick={() => setFlatHintOpen(false)}
              >
                Keep vertical
              </button>
            </div>

            <button
              className="linkBtn"
              onClick={() => {
                localStorage.setItem(FLAT_HINT_KEY, "1");
                setFlatHintOpen(false);
              }}
            >
              Don't show this again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}