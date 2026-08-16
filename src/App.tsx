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

  const [rotate, setRotate] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);

  const editorRef = useRef<ImageEditorHandle>(null);

  const [widthMm, setWidthMm] = useState(80);
  const [minT, setMinT] = useState(0.8);
  const [maxT, setMaxT] = useState(3.0);
  const [frameMm, setFrameMm] = useState(1.5);
  const [splitHeightMm, setSplitHeightMm] = useState(0);
  const [quality, setQuality] = useState<Quality>("normal");
  const [smoothing, setSmoothing] = useState(1.0);

  const [previewMesh, setPreviewMesh] = useState<PreviewMesh | null>(null);
  const [view, setView] = useState<"editor" | "preview">("editor");
  const [flatShading, setFlatShading] = useState(true);

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
    setSplitHeightMm(0);
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
      }>((resolve, reject) => {
        const handler = (e: MessageEvent) => {
          if (e.data.ok) {
            resolve({
              file: e.data.file,
              extension: e.data.extension,
              preview: e.data.preview,
              previewTriangles: e.data.previewTriangles,
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
          splitHeightMm,
          layerHeight: 0.2,
          emboss: "back",
        });
      });

      const result = await p;

      if (jobIdRef.current === currentJobId) {
        setPreviewMesh({
          positions: new Float32Array(result.preview),
          triangleCount: result.previewTriangles,
        });
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
                setSplitHeightMm((s) => +(Math.min(s, v).toFixed(2)));
              }}
            />
            <div className="spinBtns">
              <button
                className="spinBtn"
                onClick={() => {
                  setMaxT((v) => {
                    const next = +(v + 0.1).toFixed(2);
                    return next;
                  });
                }}
              >
                ▲
              </button>
              <button
                className="spinBtn"
                onClick={() => {
                  setMaxT((v) => {
                    const next = +(v - 0.1).toFixed(2);
                    setSplitHeightMm((s) => +(Math.min(s, next).toFixed(2)));
                    return next;
                  });
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
            <label className="miniLabel">Color Split (mm)</label>
            <InfoIcon text="Splits the lithophane into two stacked STL bodies at this thickness for multicolor printing. Set to 0 to disable." />
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <input
              className="range"
              type="range"
              min={0}
              max={maxT}
              step={0.1}
              value={splitHeightMm}
              onChange={(e) =>
                setSplitHeightMm(+Number(e.target.value).toFixed(2))
              }
            />

            <div className="spinRow">
              <input
                className="spinInput"
                type="number"
                min={0}
                max={maxT}
                step={0.1}
                value={splitHeightMm}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  const clamped = Math.max(0, Math.min(maxT, v));
                  setSplitHeightMm(+clamped.toFixed(2));
                }}
              />
              <div className="spinBtns">
                <button
                  className="spinBtn"
                  onClick={() =>
                    setSplitHeightMm((v) =>
                      +(Math.min(maxT, v + 0.1)).toFixed(2)
                    )
                  }
                >
                  ▲
                </button>
                <button
                  className="spinBtn"
                  onClick={() =>
                    setSplitHeightMm((v) =>
                      +(Math.max(0, v - 0.1)).toFixed(2)
                    )
                  }
                >
                  ▼
                </button>
              </div>
            </div>
          </div>

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
          style={{ height: "100%", display: "flex", flexDirection: "column" }}
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

            {view === "preview" && (
              <label className="shadeToggle">
                <input
                  type="checkbox"
                  checked={flatShading}
                  onChange={(e) => setFlatShading(e.target.checked)}
                />
                Flat shading
              </label>
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
                onImageData={setImgData}
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
                  <MeshPreview mesh={previewMesh} flatShading={flatShading} />
                </React.Suspense>
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
    </div>
  );
}