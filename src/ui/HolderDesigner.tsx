import { useEffect, useRef, useState } from "react";
import { OVERHANG_MM, type Decoration } from "../core/decor";
import { CATEGORIES, HAS_MORE, iconsIn, loadIcon } from "./decorIcons";

type Rect = { x0: number; x1: number; y0: number; y1: number };

type Props = {
  /** The holder's front face, in mm. */
  width: number;
  height: number;
  /** Radius of the frame's outer corners, in mm. */
  corner: number;
  /** Height of the rail below which nothing is cut. */
  rail: number;
  window: Rect;
  pocket: Rect;
  decorations: Decoration[];
  onChange: (next: Decoration[]) => void;
  selected: number | null;
  onSelect: (index: number | null) => void;
};

/** Width of the canvas on screen, in CSS pixels. */
const VIEW_PX = 330;

/** The frame is drawn with this much around it when the view is reset. */
const REST_MARGIN_MM = 14;

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 14;

/** How far the turn handle floats above the selected icon's box, in px. */
const TURN_HANDLE_PX = 22;

type View = { zoom: number; cx: number; cy: number };

type Drag =
  | { kind: "move"; index: number; dx: number; dy: number }
  | { kind: "size"; index: number }
  | { kind: "turn"; index: number }
  | { kind: "pan"; x: number; y: number; cx: number; cy: number };

/**
 * The holder seen from the front, with the decorations on it.
 *
 * Pick an icon from the palette to put it on the frame and drag it into place.
 * The selected icon has a handle at its corner for size and one above it for
 * turn, so both are set on the icon itself; the wheel zooms the view, and
 * dragging the empty background moves it. What is drawn here is what gets
 * raised: the window is an opening because anything over it is taken away, and
 * an icon may be taken past the frame's edge, where it hangs over.
 */
export default function HolderDesigner({
  width,
  height,
  corner,
  rail,
  window: win,
  pocket,
  decorations: committed,
  onChange,
  selected,
  onSelect,
}: Props) {
  const M = OVERHANG_MM;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const [category, setCategory] = useState(CATEGORIES[0].id);

  // What is on screen while a drag or a slider is going on. Only this component
  // is redrawn as it changes; the rest of the page hears of it when it settles,
  // because redrawing the whole page for every pixel of a drag is what made
  // this feel stuck.
  const [draft, setDraft] = useState<Decoration[] | null>(null);
  const decorations = draft ?? committed;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flush = (next: Decoration[]) => {
    clearTimeout(timer.current);
    onChange(next);
    setDraft(null);
  };
  const preview = (next: Decoration[]) => {
    setDraft(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(next), 300);
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  const base = VIEW_PX / (width + 2 * M);
  const viewH = Math.round((height + 2 * M) * base);

  const rest = (): View => ({
    zoom: (width + 2 * M) / (width + 2 * REST_MARGIN_MM),
    cx: width / 2,
    cy: height / 2,
  });
  const [view, setView] = useState<View>(rest);
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const s = base * view.zoom;
  const toX = (x: number, v: View = view) => VIEW_PX / 2 + (x - v.cx) * base * v.zoom;
  const toY = (y: number, v: View = view) => viewH / 2 - (y - v.cy) * base * v.zoom;

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
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, VIEW_PX, viewH);

      const rect = (r: Rect) =>
        [toX(r.x0), toY(r.y1), (r.x1 - r.x0) * s, (r.y1 - r.y0) * s] as const;

      ctx.fillStyle = "#d9b77a";
      const r = Math.min(corner, width / 2, height / 2) * s;
      ctx.beginPath();
      ctx.roundRect(toX(0), toY(height), width * s, height * s, r);
      ctx.fill();

      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.strokeRect(...rect(pocket));
      ctx.setLineDash([]);

      ctx.fillStyle = "#1e293b";
      ctx.fillRect(...rect(win));

      // Below the frame's underside is the table: nothing is raised there.
      ctx.fillStyle = "rgba(220,38,38,0.18)";
      ctx.fillRect(0, toY(0), VIEW_PX, Math.max(0, viewH - toY(0)));
      ctx.strokeStyle = "rgba(248,113,113,0.7)";
      ctx.beginPath();
      ctx.moveTo(0, toY(0));
      ctx.lineTo(VIEW_PX, toY(0));
      ctx.stroke();

      // Where nothing is cut, below the rail the legs stand on.
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      ctx.fillRect(toX(0), toY(rail), width * s, rail * s);

      decorations.forEach((d, i) => {
        const img = images[i];
        if (!img) return;
        const px = d.size * s;
        ctx.save();
        // A cut is drawn as the hole it will be: dark, the frame showing round it.
        if (d.cut) {
          ctx.globalAlpha = 0.55;
          ctx.filter = "brightness(0.15)";
        }
        ctx.translate(toX(d.x), toY(d.y));
        ctx.rotate((d.rotation * Math.PI) / 180);
        ctx.drawImage(img, -px / 2, -px / 2, px, px);
        ctx.restore();
      });

      if (selected !== null && decorations[selected]) {
        const d = decorations[selected];
        const half = (d.size * s) / 2;
        ctx.save();
        ctx.translate(toX(d.x), toY(d.y));
        ctx.rotate((d.rotation * Math.PI) / 180);
        ctx.strokeStyle = "#22d3ee";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-half, -half, half * 2, half * 2);

        ctx.beginPath();
        ctx.moveTo(0, -half);
        ctx.lineTo(0, -half - TURN_HANDLE_PX);
        ctx.stroke();

        ctx.fillStyle = "#22d3ee";
        ctx.beginPath();
        ctx.arc(0, -half - TURN_HANDLE_PX, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(half - 5, half - 5, 10, 10);
        ctx.restore();
      }
    })();

    return () => {
      live = false;
    };
  }, [decorations, selected, width, height, win, pocket, view, viewH]);

  // The wheel has to be a native listener: React's is passive, and a passive
  // one cannot stop the page scrolling under the pointer.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const box = canvas.getBoundingClientRect();
      const px = ((e.clientX - box.left) / box.width) * VIEW_PX;
      const py = ((e.clientY - box.top) / box.height) * viewH;

      // The point under the pointer stays under it.
      const wx = v.cx + (px - VIEW_PX / 2) / (base * v.zoom);
      const wy = v.cy - (py - viewH / 2) / (base * v.zoom);
      const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v.zoom * Math.exp(-e.deltaY * 0.0015)));
      setView({
        zoom,
        cx: wx - (px - VIEW_PX / 2) / (base * zoom),
        cy: wy + (py - viewH / 2) / (base * zoom),
      });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [base, viewH]);

  /** Pointer position in canvas pixels. */
  function px(e: React.PointerEvent): { x: number; y: number } {
    const box = canvasRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - box.left) / box.width) * VIEW_PX,
      y: ((e.clientY - box.top) / box.height) * viewH,
    };
  }

  /** Pointer position on the holder, in mm. */
  function mm(p: { x: number; y: number }): { x: number; y: number } {
    return { x: view.cx + (p.x - VIEW_PX / 2) / s, y: view.cy - (p.y - viewH / 2) / s };
  }

  /** Where a point of the selected icon's own box is on screen, in px. */
  function boxPoint(d: Decoration, lx: number, ly: number): { x: number; y: number } {
    const a = (d.rotation * Math.PI) / 180;
    return {
      x: toX(d.x) + lx * Math.cos(a) - ly * Math.sin(a),
      y: toY(d.y) + lx * Math.sin(a) + ly * Math.cos(a),
    };
  }

  /** The topmost decoration whose turned square holds the point. */
  function hit(p: { x: number; y: number }): number {
    const m = mm(p);
    for (let i = decorations.length - 1; i >= 0; i--) {
      const d = decorations[i];
      const a = (d.rotation * Math.PI) / 180;
      const dx = m.x - d.x;
      const dy = -(m.y - d.y);
      const u = dx * Math.cos(a) + dy * Math.sin(a);
      const v = -dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(u) <= d.size / 2 && Math.abs(v) <= d.size / 2) return i;
    }
    return -1;
  }

  function down(e: React.PointerEvent) {
    const p = px(e);
    try {
      canvasRef.current!.setPointerCapture(e.pointerId);
    } catch {
      // A pointer that has already gone: the drag simply is not captured.
    }

    // The selected icon's handles come first: they stand outside its box.
    if (selected !== null && decorations[selected]) {
      const d = decorations[selected];
      const half = (d.size * s) / 2;
      const near = (a: { x: number; y: number }) => Math.hypot(a.x - p.x, a.y - p.y) <= 10;
      if (near(boxPoint(d, half, half))) {
        drag.current = { kind: "size", index: selected };
        return;
      }
      if (near(boxPoint(d, 0, -half - TURN_HANDLE_PX))) {
        drag.current = { kind: "turn", index: selected };
        return;
      }
    }

    const i = hit(p);
    onSelect(i < 0 ? null : i);
    if (i >= 0) {
      const m = mm(p);
      drag.current = { kind: "move", index: i, dx: decorations[i].x - m.x, dy: decorations[i].y - m.y };
    } else {
      drag.current = { kind: "pan", x: p.x, y: p.y, cx: view.cx, cy: view.cy };
    }
  }

  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const p = px(e);

    if (d.kind === "pan") {
      setView({ ...view, cx: d.cx - (p.x - d.x) / s, cy: d.cy + (p.y - d.y) / s });
      return;
    }

    const patch = (change: (it: Decoration) => Partial<Decoration>) =>
      preview(decorations.map((it, i) => (i === d.index ? { ...it, ...change(it) } : it)));

    if (d.kind === "move") {
      const m = mm(p);
      patch(() => ({
        x: Math.max(-M, Math.min(width + M, m.x + d.dx)),
        y: Math.max(-M, Math.min(height + M, m.y + d.dy)),
      }));
    } else if (d.kind === "size") {
      // The handle is a corner of the box, so its distance from the middle is
      // half the diagonal.
      patch((it) => ({
        size: Math.max(3, Math.min(120, Math.round((Math.hypot(p.x - toX(it.x), p.y - toY(it.y)) / s) * Math.SQRT2))),
      }));
    } else {
      patch((it) => {
        const a = Math.atan2(p.y - toY(it.y), p.x - toX(it.x)) * (180 / Math.PI) + 90;
        // Round to whole degrees, and to a quarter turn when close to one.
        let r = Math.round(((a + 540) % 360) - 180);
        for (const snap of [-180, -90, 0, 90, 180]) if (Math.abs(r - snap) <= 3) r = snap;
        return { rotation: r };
      });
    }
  }

  function up() {
    drag.current = null;
    if (draft) flush(draft);
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
    flush([...decorations, next]);
    onSelect(decorations.length);
  }

  function patchSelected(change: Partial<Decoration>) {
    if (selected === null) return;
    preview(decorations.map((d, i) => (i === selected ? { ...d, ...change } : d)));
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
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, opacity: 0.65, marginTop: 4 }}>
        <span>Wheel zooms · drag the background to move the view</span>
        <button
          className="btn"
          style={{ padding: "1px 8px", fontSize: 11 }}
          onClick={() => setView(rest())}
        >
          Reset view
        </button>
      </div>

      {current && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
            <button
              className={`segment ${!current.cut ? "active" : ""}`}
              style={{ flex: 1 }}
              onClick={() => patchSelected({ cut: false })}
              title="Stand out from the frame's front face"
            >
              Raised
            </button>
            <button
              className={`segment ${current.cut ? "active" : ""}`}
              style={{ flex: 1 }}
              onClick={() => patchSelected({ cut: true })}
              title="Cut clean through the frame, so light shows through"
            >
              Cut out
            </button>
          </div>
          <div className="label-row">
            <label className="miniLabel">Size: {current.size.toFixed(0)} mm</label>
          </div>
          <input
            className="range"
            type="range"
            min={3}
            max={120}
            step={1}
            value={current.size}
            onChange={(e) => patchSelected({ size: Number(e.target.value) })}
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
            onChange={(e) => patchSelected({ rotation: Number(e.target.value) })}
          />
          <button
            className="btn"
            style={{ width: "100%", marginTop: 8, justifyContent: "center" }}
            onClick={() => {
              flush(decorations.filter((_, i) => i !== selected));
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
            flush([]);
            onSelect(null);
          }}
        >
          Clear all
        </button>
      )}
    </div>
  );
}
