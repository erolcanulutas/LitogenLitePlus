import { t } from "../i18n";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { OVERHANG_MM, isText, type Decoration } from "../core/decor";
import { decorationBox, drawDecoration, loadIcon } from "./decorIcons";

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
  /** Lines a decoration being dragged catches on, in mm: x for vertical, y for horizontal. */
  guides?: { x: number[]; y: number[] };
};

/** How near a guide a decoration has to come to catch on it, in mm. */
const SNAP_MM = 1.1;

/** The frame is drawn with this much around it when the view is reset. */
const REST_MARGIN_MM = 14;

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 16;

/** How far the turn handle floats above the selected decoration's box, in px. */
const TURN_HANDLE_PX = 24;

/** Radius of a handle's grab area, in px. */
const GRAB_PX = 11;

type View = { zoom: number; cx: number; cy: number };

type Drag =
  | { kind: "move"; index: number; dx: number; dy: number }
  | { kind: "size"; index: number; startSize: number; startDist: number }
  | { kind: "turn"; index: number }
  | { kind: "pan"; x: number; y: number; cx: number; cy: number };

/**
 * The holder seen from the front, large, with the decorations on it.
 *
 * The selected decoration has a handle at its corner for size, one above it for
 * turn, and a cross to take it away, so all three are done on the thing itself;
 * the wheel zooms about the pointer and dragging the background moves the view.
 * What is drawn here is what gets built: the window is an opening, a
 * decoration may reach past the frame's edge or over the window, and the red
 * strip at the bottom is the table, where nothing is raised.
 *
 * It fills whatever it is put in.
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
  guides = { x: [], y: [] },
}: Props) {
  const M = OVERHANG_MM;
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  /** The guides the dragged decoration is caught on just now, to draw. */
  const [caught, setCaught] = useState<{ x?: number; y?: number }>({});
  const [size, setSize] = useState({ w: 480, h: 420 });

  // What is on screen while a drag is going on. Only this component is redrawn
  // as it changes; the rest of the page hears of it when it settles, because
  // redrawing the whole page for every pixel of a drag is what made this feel
  // stuck.
  const [draft, setDraft] = useState<Decoration[] | null>(null);
  const decorations = draft ?? committed;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
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

  // Follow the size of the box it is in.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const read = () => {
      const w = Math.max(200, Math.floor(host.clientWidth));
      const h = Math.max(160, Math.floor(host.clientHeight));
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const viewW = size.w;
  const viewH = size.h;
  const base = Math.min(viewW / (width + 2 * M), viewH / (height + 2 * M));

  const rest = (): View => ({
    zoom: Math.min(viewW / (width + 2 * REST_MARGIN_MM), viewH / (height + 2 * REST_MARGIN_MM)) / base,
    cx: width / 2,
    cy: height / 2,
  });
  const [view, setView] = useState<View>({ zoom: 1, cx: width / 2, cy: height / 2 });
  const framed = useRef(false);
  useEffect(() => {
    // The first time the real size is known, show the frame properly.
    if (!framed.current && size.w > 0) {
      framed.current = true;
      setView({
        zoom: Math.min(viewW / (width + 2 * REST_MARGIN_MM), viewH / (height + 2 * REST_MARGIN_MM)) / base,
        cx: width / 2,
        cy: height / 2,
      });
    }
  }, [size, viewW, viewH, width, height, base]);
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const s = base * view.zoom;
  const toX = (x: number, v: View = view) => viewW / 2 + (x - v.cx) * base * v.zoom;
  const toY = (y: number, v: View = view) => viewH / 2 - (y - v.cy) * base * v.zoom;

  // Redrawn whenever anything it shows changes. Icons are loaded once and
  // cached, so asking for them again costs nothing but the wait for the first.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let live = true;

    (async () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(viewW * dpr);
      canvas.height = Math.round(viewH * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const images = await Promise.all(
        decorations.map((d) => (isText(d) ? null : loadIcon(d.icon).catch(() => null))),
      );
      if (!live) return;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, viewW, viewH);
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, viewW, viewH);

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
      ctx.fillRect(0, toY(0), viewW, Math.max(0, viewH - toY(0)));
      ctx.strokeStyle = "rgba(248,113,113,0.7)";
      ctx.beginPath();
      ctx.moveTo(0, toY(0));
      ctx.lineTo(viewW, toY(0));
      ctx.stroke();

      // Where nothing is cut: the rail the legs stand on.
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      ctx.fillRect(toX(0), toY(rail), width * s, rail * s);

      decorations.forEach((d, i) => {
        ctx.save();
        ctx.translate(toX(d.x), toY(d.y));
        ctx.rotate((d.rotation * Math.PI) / 180);
        // A cut is drawn as the hole it will be: dark, the frame showing round it.
        if (d.cut) {
          ctx.globalAlpha = 0.55;
          ctx.filter = "brightness(0.15)";
        }
        // Drawn about its own middle, which the translation above has made the origin.
        drawDecoration(ctx, images[i], { ...d, x: 0, y: 0, rotation: 0 }, 0, s);
        ctx.restore();
      });

      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = "rgba(34,211,238,0.85)";
      ctx.lineWidth = 1;
      if (caught.x !== undefined) {
        ctx.beginPath();
        ctx.moveTo(toX(caught.x), 0);
        ctx.lineTo(toX(caught.x), viewH);
        ctx.stroke();
      }
      if (caught.y !== undefined) {
        ctx.beginPath();
        ctx.moveTo(0, toY(caught.y));
        ctx.lineTo(viewW, toY(caught.y));
        ctx.stroke();
      }
      ctx.restore();

      if (selected !== null && decorations[selected]) {
        const d = decorations[selected];
        const box = decorationBox(d);
        const hw = (box.w * s) / 2;
        const hh = (box.h * s) / 2;
        ctx.save();
        ctx.translate(toX(d.x), toY(d.y));
        ctx.rotate((d.rotation * Math.PI) / 180);
        ctx.strokeStyle = "#22d3ee";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);

        ctx.beginPath();
        ctx.moveTo(0, -hh);
        ctx.lineTo(0, -hh - TURN_HANDLE_PX);
        ctx.stroke();

        ctx.fillStyle = "#22d3ee";
        ctx.beginPath();
        ctx.arc(0, -hh - TURN_HANDLE_PX, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(hw - 6, hh - 6, 12, 12);

        // The cross in the top corner takes it away.
        ctx.fillStyle = "#ef4444";
        ctx.beginPath();
        ctx.arc(hw, -hh, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(hw - 4, -hh - 4);
        ctx.lineTo(hw + 4, -hh + 4);
        ctx.moveTo(hw + 4, -hh - 4);
        ctx.lineTo(hw - 4, -hh + 4);
        ctx.stroke();
        ctx.restore();
      }
    })();

    return () => {
      live = false;
    };
  }, [decorations, selected, width, height, corner, rail, win, pocket, view, viewW, viewH, caught]);

  // The wheel has to be a native listener: React's is passive, and a passive
  // one cannot stop the page scrolling under the pointer.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const box = canvas.getBoundingClientRect();
      const px = ((e.clientX - box.left) / box.width) * viewW;
      const py = ((e.clientY - box.top) / box.height) * viewH;

      // The point under the pointer stays under it.
      const wx = v.cx + (px - viewW / 2) / (base * v.zoom);
      const wy = v.cy - (py - viewH / 2) / (base * v.zoom);
      const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v.zoom * Math.exp(-e.deltaY * 0.0015)));
      setView({
        zoom,
        cx: wx - (px - viewW / 2) / (base * zoom),
        cy: wy + (py - viewH / 2) / (base * zoom),
      });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [base, viewW, viewH]);

  /** Pointer position in canvas pixels. */
  function px(e: React.PointerEvent): { x: number; y: number } {
    const box = canvasRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - box.left) / box.width) * viewW,
      y: ((e.clientY - box.top) / box.height) * viewH,
    };
  }

  /** Pointer position on the holder, in mm. */
  function mm(p: { x: number; y: number }): { x: number; y: number } {
    return { x: view.cx + (p.x - viewW / 2) / s, y: view.cy - (p.y - viewH / 2) / s };
  }

  /** Where a point of the selected decoration's own box is on screen, in px. */
  function boxPoint(d: Decoration, lx: number, ly: number): { x: number; y: number } {
    const a = (d.rotation * Math.PI) / 180;
    return {
      x: toX(d.x) + lx * Math.cos(a) - ly * Math.sin(a),
      y: toY(d.y) + lx * Math.sin(a) + ly * Math.cos(a),
    };
  }

  /** The topmost decoration whose turned box holds the point. */
  function hit(p: { x: number; y: number }): number {
    const m = mm(p);
    for (let i = decorations.length - 1; i >= 0; i--) {
      const d = decorations[i];
      const box = decorationBox(d);
      const a = (d.rotation * Math.PI) / 180;
      const dx = m.x - d.x;
      const dy = -(m.y - d.y);
      const u = dx * Math.cos(a) + dy * Math.sin(a);
      const v = -dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(u) <= box.w / 2 && Math.abs(v) <= box.h / 2) return i;
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

    // The selected decoration's handles come first: they stand outside its box.
    if (selected !== null && decorations[selected]) {
      const d = decorations[selected];
      const box = decorationBox(d);
      const hw = (box.w * s) / 2;
      const hh = (box.h * s) / 2;
      const near = (a: { x: number; y: number }) => Math.hypot(a.x - p.x, a.y - p.y) <= GRAB_PX;
      if (near(boxPoint(d, hw, -hh))) {
        flush(decorations.filter((_, i) => i !== selected));
        onSelect(null);
        return;
      }
      if (near(boxPoint(d, hw, hh))) {
        drag.current = {
          kind: "size",
          index: selected,
          startSize: d.size,
          startDist: Math.hypot(p.x - toX(d.x), p.y - toY(d.y)),
        };
        return;
      }
      if (near(boxPoint(d, 0, -hh - TURN_HANDLE_PX))) {
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
      let x = Math.max(-M, Math.min(width + M, m.x + d.dx));
      let y = Math.max(-M, Math.min(height + M, m.y + d.dy));

      // Catch on a guide when close to one; Alt holds it off, for fine placing.
      const found: { x?: number; y?: number } = {};
      if (!e.altKey) {
        for (const g of guides.x) if (Math.abs(x - g) <= SNAP_MM) { x = g; found.x = g; break; }
        for (const g of guides.y) if (Math.abs(y - g) <= SNAP_MM) { y = g; found.y = g; break; }
      }
      setCaught((prev) => (prev.x === found.x && prev.y === found.y ? prev : found));
      patch(() => ({ x, y }));
    } else if (d.kind === "size") {
      // Scaled by how much further from the middle the handle is than it was
      // when it was taken, which is the same for an icon and for text.
      patch((it) => {
        const dist = Math.hypot(p.x - toX(it.x), p.y - toY(it.y));
        const next = d.startSize * (dist / Math.max(1, d.startDist));
        return { size: Math.max(2, Math.min(isText(it) ? 80 : 140, Math.round(next * 2) / 2)) };
      });
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
    setCaught({});
    if (draft) flush(draft);
  }

  return (
    <div ref={hostRef} style={{ position: "absolute", inset: 0 }}>
      <canvas
        ref={canvasRef}
        style={{
          width: viewW,
          height: viewH,
          display: "block",
          touchAction: "none",
          cursor: "grab",
        }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
      <div
        style={{
          position: "absolute",
          left: 10,
          bottom: 8,
          right: 10,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 11,
          color: "rgba(226,232,240,0.7)",
          pointerEvents: "none",
        }}
      >
        <span>{t("Wheel zooms · drag the background to move the view · Alt while dragging skips the guides")}</span>
        <button
          className="btn"
          style={{ padding: "1px 10px", fontSize: 11, pointerEvents: "auto" }}
          onClick={() => setView(rest())}
        >{t("Reset view")}</button>
      </div>
    </div>
  );
}
