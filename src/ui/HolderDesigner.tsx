import { useEffect, useRef, useState } from "react";
import type { Decoration } from "../core/decor";
import { CATEGORIES, HAS_MORE, drawDecoration, iconsIn, loadIcon } from "./decorIcons";

type Rect = { x0: number; x1: number; y0: number; y1: number };

type Props = {
  /** The holder's front face, in mm. */
  width: number;
  height: number;
  window: Rect;
  pocket: Rect;
  decorations: Decoration[];
  onChange: (next: Decoration[]) => void;
  selected: number | null;
  onSelect: (index: number | null) => void;
};

/** Width of the canvas on screen, in CSS pixels. */
const VIEW_PX = 320;

/**
 * The holder seen from the front, with the decorations on it.
 *
 * Pick an icon from the palette to put it on the frame, drag it into place, and
 * set its size and turn. What is drawn here is what gets raised on the front
 * face: the window is shown as an opening because anything over it is taken
 * away, so an icon dragged across it is cut off at its edge.
 */
export default function HolderDesigner({
  width,
  height,
  window: win,
  pocket,
  decorations,
  onChange,
  selected,
  onSelect,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ index: number; dx: number; dy: number } | null>(null);
  const [category, setCategory] = useState(CATEGORIES[0].id);

  const scale = VIEW_PX / width;
  const viewH = Math.round(height * scale);

  // Redrawn whenever anything it shows changes. Icons are loaded once and
  // cached, so asking for them again costs nothing but the wait for the first.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let live = true;

    (async () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(VIEW_PX * dpr);
      canvas.height = Math.round(viewH * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const images = await Promise.all(decorations.map((d) => loadIcon(d.icon).catch(() => null)));
      if (!live) return;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, VIEW_PX, viewH);

      ctx.fillStyle = "#d9b77a";
      ctx.fillRect(0, 0, VIEW_PX, viewH);

      const rect = (r: Rect) =>
        [r.x0 * scale, (height - r.y1) * scale, (r.x1 - r.x0) * scale, (r.y1 - r.y0) * scale] as const;

      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.strokeRect(...rect(pocket));
      ctx.setLineDash([]);

      ctx.fillStyle = "#1e293b";
      ctx.fillRect(...rect(win));

      decorations.forEach((d, i) => {
        const img = images[i];
        if (img) drawDecoration(ctx, img, d, height, scale);
      });

      // Over the decorations, the window again: what is drawn here and cut
      // away in the model are the same thing.
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(...rect(win));

      if (selected !== null && decorations[selected]) {
        const d = decorations[selected];
        ctx.save();
        ctx.translate(d.x * scale, (height - d.y) * scale);
        ctx.rotate((d.rotation * Math.PI) / 180);
        const half = (d.size * scale) / 2;
        ctx.strokeStyle = "#22d3ee";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-half, -half, half * 2, half * 2);
        ctx.restore();
      }
    })();

    return () => {
      live = false;
    };
  }, [decorations, selected, width, height, win, pocket, scale, viewH]);

  function at(e: React.PointerEvent): { x: number; y: number } {
    const box = canvasRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - box.left) / box.width) * width,
      y: height - ((e.clientY - box.top) / box.height) * height,
    };
  }

  /** The topmost decoration whose turned square holds the point. */
  function hit(p: { x: number; y: number }): number {
    for (let i = decorations.length - 1; i >= 0; i--) {
      const d = decorations[i];
      const a = (d.rotation * Math.PI) / 180;
      const dx = p.x - d.x;
      const dy = -(p.y - d.y);
      const u = dx * Math.cos(a) + dy * Math.sin(a);
      const v = -dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(u) <= d.size / 2 && Math.abs(v) <= d.size / 2) return i;
    }
    return -1;
  }

  function down(e: React.PointerEvent) {
    const p = at(e);
    const i = hit(p);
    onSelect(i < 0 ? null : i);
    if (i >= 0) {
      drag.current = { index: i, dx: decorations[i].x - p.x, dy: decorations[i].y - p.y };
      canvasRef.current!.setPointerCapture(e.pointerId);
    }
  }

  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const p = at(e);
    onChange(
      decorations.map((it, i) =>
        i === d.index
          ? {
              ...it,
              x: Math.max(0, Math.min(width, p.x + d.dx)),
              y: Math.max(0, Math.min(height, p.y + d.dy)),
            }
          : it,
      ),
    );
  }

  function up() {
    drag.current = null;
  }

  function add(icon: string) {
    // The top border is the widest strip clear of the window, so new icons
    // start there and are dragged to where they belong.
    const next: Decoration = {
      icon,
      x: width / 2,
      y: (win.y1 + height) / 2,
      size: Math.max(8, Math.min(20, (height - win.y1) * 1.6)),
      rotation: 0,
    };
    onChange([...decorations, next]);
    onSelect(decorations.length);
  }

  function patch(change: Partial<Decoration>) {
    if (selected === null) return;
    onChange(decorations.map((d, i) => (i === selected ? { ...d, ...change } : d)));
  }

  const current = selected !== null ? decorations[selected] : undefined;

  return (
    <div>
      <canvas
        ref={canvasRef}
        style={{
          width: VIEW_PX,
          height: viewH,
          display: "block",
          borderRadius: 6,
          touchAction: "none",
          cursor: "grab",
        }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />

      {current && (
        <div style={{ marginTop: 10 }}>
          <div className="label-row">
            <label className="miniLabel">Size: {current.size.toFixed(0)} mm</label>
          </div>
          <input
            className="range"
            type="range"
            min={4}
            max={60}
            step={1}
            value={current.size}
            onChange={(e) => patch({ size: Number(e.target.value) })}
          />
          <div className="label-row" style={{ marginTop: 8 }}>
            <label className="miniLabel">Turn: {current.rotation}°</label>
          </div>
          <input
            className="range"
            type="range"
            min={-180}
            max={180}
            step={5}
            value={current.rotation}
            onChange={(e) => patch({ rotation: Number(e.target.value) })}
          />
          <button
            className="btn"
            style={{ width: "100%", marginTop: 8, justifyContent: "center" }}
            onClick={() => {
              onChange(decorations.filter((_, i) => i !== selected));
              onSelect(null);
            }}
          >
            Remove
          </button>
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 10 }}>
        {[...CATEGORIES.map((c) => ({ id: c.id, label: c.label })), ...(HAS_MORE ? [{ id: "more", label: "More" }] : [])].map((c) => (
          <button
            key={c.id}
            className={`segment ${category === c.id ? "active" : ""}`}
            style={{ padding: "4px 8px", fontSize: 12 }}
            onClick={() => setCategory(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(6, 1fr)",
          gap: 4,
          marginTop: 8,
        }}
      >
        {iconsIn(category).map((icon) => (
          <button
            key={icon.id}
            title={icon.label}
            onClick={() => add(icon.id)}
            style={{
              background: "rgba(255,255,255,0.88)",
              border: "1px solid rgba(255,255,255,0.25)",
              borderRadius: 6,
              padding: 3,
              cursor: "pointer",
            }}
          >
            <img src={icon.url} alt={icon.label} style={{ width: "100%", display: "block" }} />
          </button>
        ))}
      </div>

      {decorations.length > 0 && (
        <button
          className="btn"
          style={{ width: "100%", marginTop: 8, justifyContent: "center" }}
          onClick={() => {
            onChange([]);
            onSelect(null);
          }}
        >
          Clear all
        </button>
      )}
    </div>
  );
}
