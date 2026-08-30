// src/ui/ImageEditor.tsx
import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from "react";
import type { ShapeId } from "../core/types";

/* ---------------------------------------------
 * Types
 * --------------------------------------------- */

/**
 * The crop, in units of the drawn image rather than the viewport.
 *
 * `w` is a fraction of the image's on-screen width and `cx`/`cy` are offsets
 * from the image's centre in the same unit. Anchoring to the image is what
 * makes the framing independent of the panel: these used to be fractions of
 * the viewport, so anything that changed the panel's size — resizing the
 * window, or switching tabs, which removes the controls strip below — rescaled
 * the image without moving the box and silently re-cropped the picture.
 */
type Crop = {
  cx: number;
  cy: number;
  w: number;
  rot: number;
};

/** "resize" keeps the proportions; "box" drives one or both sides directly. */
type DragMode = "move" | "resize" | "box" | "rotate" | null;

type DragState = {
  mode: DragMode;
  startX: number;
  startY: number;
  startCrop: Crop;
  startDist?: number;
  startAngle?: number;
  /** For "box": which sides the grabbed grip drives. */
  axisX?: boolean;
  axisY?: boolean;
  /** For "box": the ratio when the drag began, so the untouched side holds. */
  startRatio?: number;
};

/**
 * What a drag does.
 *
 * "crop" is the frame around the picture and every other one draws on it.
 * Holding them in one list rather than a paint switch beside the crop is what
 * keeps the two from ever both wanting the same drag.
 */
export type Tool =
  | "crop"
  | "brush"
  | "erase"
  | "line"
  | "rect"
  | "ellipse"
  | "fill"
  | "pick";

export type ImageEditorHandle = {
  reset: () => void;
  /** Undoes the last brush stroke; strokes are kept a dozen deep. */
  undoPaint: () => void;
  clearPaint: () => void;
};

type Props = {
  image: HTMLImageElement | null;
  cropRatio: number; // W / H
  shapeId: ShapeId;
  rotate: number; // IMAGE rotation (background)
  flipH: boolean;
  flipV: boolean;
  /**
   * Colour for anything the photo does not cover.
   *
   * Without it those pixels come out transparent, which reads as luminance 0
   * — solid black — and prints as the thickest, most opaque part of the model.
   * White is usually what is wanted: thin, and light passes through.
   */
  bgColor: string;
  /**
   * How many pixels the crop is handed over as, at most.
   *
   * A relief resamples whatever it is given down to a couple of samples per
   * printed layer, so a modest crop has always been enough for it. Tracing
   * tones as regions does not resample: a boundary is a line, and it is drawn
   * along the pixel grid it was traced from, so every pixel of the crop is a
   * step you can see. That mode asks for a bigger one.
   */
  detail?: number;
  /** Frame band width in mm, for showing what it will cover. */
  frameMm: number;
  /** Print width in mm; the frame is only meaningful relative to it. */
  widthMm: number;
  /**
   * The crop box may be dragged to any proportions rather than being held to
   * `cropRatio`. Side grips appear, and the ratio it ends up at is reported
   * back through `onCropRatioChange` — the shape is built to match it.
   */
  freeRatio?: boolean;
  onCropRatioChange?: (ratio: number) => void;
  /**
   * Rotation step in degrees for the crop box's handle, or 0 to leave it free.
   *
   * Only the drag is quantised. Turning snapping on does not pull an angle
   * that is already off-step into line; the next drag does that.
   */
  snapDeg: number;
  /**
   * Painting straight onto the picture.
   *
   * Kept on a layer of its own, in the picture's own pixels, and stamped over
   * the picture everywhere it is drawn — the panel and the crop handed to the
   * generator both. That is what makes a stroke survive cropping, rotating and
   * flipping: it is part of the picture from then on, not part of the view.
   */
  tool?: Tool;
  paintColor?: string;
  /** Brush width on screen, so it stays the size it looks whatever the zoom. */
  paintSize?: number;
  /** How close a colour has to be for the fill to run into it, 0..255. */
  fillTolerance?: number;
  onPickColor?: (hex: string) => void;
  onImageData: (img: ImageData | null) => void;
};

/* ---------------------------------------------
 * Math Helpers
 * --------------------------------------------- */

const HANDLE_SIZE = 8;
const ROT_HANDLE_PFX = 20;
/**
 * How far inside the top edge the rotation grip goes when there is no room
 * for it outside. Wide enough to keep clear of the top side grip, which sits
 * on the edge itself.
 */
const ROT_HANDLE_INSIDE = 44;
const MIN_WIDTH_RX = 0.05;
/**
 * Largest crop, as a multiple of the drawn image's width.
 *
 * It used to be 2, which is not much room for a rectangle: the plate could
 * never be more than twice the picture across, so anything wanting a small
 * graphic on a wide panel ran into a wall. The number is only here to keep a
 * runaway drag from producing nonsense.
 */
const MAX_WIDTH_RX = 24;

function deg2rad(deg: number) {
  return (deg * Math.PI) / 180;
}

function rotatePoint(x: number, y: number, deg: number) {
  return unrotatePoint(x, y, -deg);
}

function unrotatePoint(x: number, y: number, deg: number) {
  const r = deg2rad(-deg);
  const c = Math.cos(r);
  const s = Math.sin(r);
  return {
    x: x * c - y * s,
    y: x * s + y * c,
  };
}

/* ---------------------------------------------
 * Component
 * --------------------------------------------- */

const ImageEditor = forwardRef<ImageEditorHandle, Props>(
  (
    {
      image, cropRatio, shapeId, rotate, flipH, flipV,
      bgColor, detail, frameMm, widthMm, snapDeg, freeRatio, onCropRatioChange,
      tool = "crop", paintColor, paintSize, fillTolerance, onPickColor,
      onImageData,
    },
    ref
  ) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const debounceTimerRef = useRef<number | null>(null);
    const viewRef = useRef({ w: 1, h: 1 });
    /** On-screen size of the drawn image; the crop is measured against it. */
    const fitRef = useRef({ dw: 1, dh: 1 });

    const DEFAULT_CROP: Crop = {
      cx: 0,
      cy: 0,
      w: 0.8,
      rot: 0,
    };

    const [crop, setCrop] = useState<Crop>(DEFAULT_CROP);
    const [viewScale, setViewScale] = useState(1);

    const dragRef = useRef<DragState | null>(null);

    useImperativeHandle(ref, () => ({
      reset: () => {
        setCrop(DEFAULT_CROP);
        setViewScale(1);
      },
      undoPaint: () => {
        const layer = paintRef.current;
        const back = undoRef.current.pop();
        if (!layer || !back) return;
        layer.getContext("2d")?.putImageData(back, 0, 0);
        drawRef.current?.();
      },
      clearPaint: () => {
        const layer = paintRef.current;
        if (!layer) return;
        undoRef.current = [];
        layer.getContext("2d")?.clearRect(0, 0, layer.width, layer.height);
        drawRef.current?.();
      },
    }));

    // draw() is defined further down; the handle above needs to reach it.
    const drawRef = useRef<(() => void) | null>(null);

    /**
     * Local-space Y of the rotation grip.
     *
     * It normally hangs just outside the top edge. A crop box that fills the
     * view puts it past the edge of the canvas, where it cannot be grabbed at
     * all — and that is the default state, since the box starts at most of the
     * image — so it moves to just inside the edge instead. draw() and the hit
     * test both come through here, so they cannot disagree about it.
     */
    const rotHandleLocalY = (cropH: number, cx: number, cy: number) => {
      const outside = -cropH / 2 - ROT_HANDLE_PFX / viewScale;

      const { w: W, h: H } = viewRef.current;
      const p = rotatePoint(0, outside, crop.rot);
      // Scene to on-screen, undoing the zoom about the view centre.
      const sx = (cx + p.x - W / 2) * viewScale + W / 2;
      const sy = (cy + p.y - H / 2) * viewScale + H / 2;

      const m = HANDLE_SIZE + 6;
      const reachable = sx >= m && sx <= W - m && sy >= m && sy <= H - m;

      return reachable ? outside : -cropH / 2 + ROT_HANDLE_INSIDE / viewScale;
    };

    /* ---------------------------------------------
     * Shape Path Drawing
     * --------------------------------------------- */
    const drawShape = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      if (shapeId === "rectangle") {
        ctx.rect(-w / 2, -h / 2, w, h);
        return;
      }

      if (shapeId === "circle") {
        ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
        return;
      }

      if (shapeId === "triangle") {
        const hh = h / 2;
        const hw = w / 2;
        ctx.moveTo(0, -hh);
        ctx.lineTo(hw, hh);
        ctx.lineTo(-hw, hh);
        ctx.closePath();
        return;
      }

      if (shapeId === "hexagon") {
        const hw = w / 2;
        const hh = h / 2;
        const xOffset = w / 4;

        ctx.moveTo(-hw + xOffset, -hh);
        ctx.lineTo(hw - xOffset, -hh);
        ctx.lineTo(hw, 0);
        ctx.lineTo(hw - xOffset, hh);
        ctx.lineTo(-hw + xOffset, hh);
        ctx.lineTo(-hw, 0);
        ctx.closePath();
        return;
      }

      if (shapeId === "pentagon") {
        // Regular pentagon (flat-bottom), bbox-centered to match STL plugin.
        // IMPORTANT: We flip EDITOR pentagon 180° (leave STL side as-is).
        const SEG = 5;
        const cos18 = Math.cos(Math.PI / 10);

        // Here, w/h are bbox dims of the crop area in editor space.
        // Derive R from bbox width for drawing only.
        const R = (w / 2) / cos18;

        // flat-bottom rotation = +36°, plus 180° editor flip
        const rot = Math.PI / 5; // 36°
        const theta0 = -Math.PI / 2 + rot + Math.PI; // <-- 180° flip

        const pts: { x: number; y: number }[] = [];
        for (let k = 0; k < SEG; k++) {
          const theta = theta0 + (k * 2 * Math.PI) / SEG;
          pts.push({ x: Math.cos(theta) * R, y: Math.sin(theta) * R });
        }

        // bbox-center at (0,0)
        let minX = Infinity,
          maxX = -Infinity,
          minY = Infinity,
          maxY = -Infinity;
        for (const p of pts) {
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
        }
        const offX = (minX + maxX) / 2;
        const offY = (minY + maxY) / 2;

        ctx.moveTo(pts[0].x - offX, pts[0].y - offY);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x - offX, pts[i].y - offY);
        }
        ctx.closePath();
        return;
      }
    };

    /**
     * How far in the frame reaches, as a scale factor on the outline.
     *
     * The generators hold the frame at full thickness for a fixed distance in
     * from the edge, which for these shapes is the outline scaled about its
     * centre. Each one measures that distance differently — a radius for the
     * circle, an apothem for the polygons, an inradius for the triangle — so
     * the factor is derived per shape rather than guessed.
     */
    const frameScale = (() => {
      if (!(frameMm > 0.05) || !(widthMm > 0)) return { kx: 1, ky: 1 };

      // The rectangle is the only shape whose two axes inset by different
      // fractions, because it is the only one whose proportions are free: the
      // band is frameMm wide on every side of a box that is not square.
      if (shapeId === "rectangle") {
        const heightMm = cropRatio > 0 ? widthMm / cropRatio : widthMm;
        return {
          kx: 1 - (2 * frameMm) / widthMm,
          ky: heightMm > 0 ? 1 - (2 * frameMm) / heightMm : 1,
        };
      }

      const k = (() => {
        switch (shapeId) {
          case "circle":
            return 1 - (2 * frameMm) / widthMm;
          case "hexagon":
            return 1 - (4 * frameMm) / (widthMm * Math.sqrt(3));
          case "pentagon":
            return (
              1 -
              (2 * frameMm * Math.cos(Math.PI / 10)) /
                (widthMm * Math.cos(Math.PI / 5))
            );
          case "triangle":
            return 1 - (6 * frameMm) / (widthMm * Math.sqrt(3));
          default:
            return 1;
        }
      })();

      return { kx: k, ky: k };
    })();

    /**
     * Draws the outline scaled about the point the frame shrinks towards.
     *
     * For the triangle that is the incentre, which sits a sixth of the height
     * below the bounding box centre — scaling about the box centre instead
     * would put the band in the wrong place on the sloped edges.
     */
    const drawShapeScaled = (
      ctx: CanvasRenderingContext2D,
      w: number,
      h: number,
      kx: number,
      ky: number,
    ) => {
      const dy = shapeId === "triangle" ? (h * (1 - ky)) / 6 : 0;
      ctx.save();
      ctx.translate(0, dy);
      drawShape(ctx, w * kx, h * ky);
      ctx.restore();
    };

    /* ---------------------------------------------
     * Output Generator (Debounced)
     * --------------------------------------------- */
    const triggerOutputGeneration = (dwBg: number, dhBg: number) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = window.setTimeout(() => {
        if (!image) return;

        // Held to a pixel budget rather than a fixed width: at the ratios a
        // free-form rectangle reaches, a fixed 900 wide would have asked for a
        // 900 x 9000 buffer. At the ratios the fixed shapes use this comes out
        // at the 900 it always was.
        const OUT_AREA = detail ?? 900 * 780;
        const OUT_W = Math.max(64, Math.round(Math.sqrt(OUT_AREA * cropRatio)));
        const OUT_H = Math.max(64, Math.round(OUT_W / cropRatio));

        const outCanvas = new OffscreenCanvas(OUT_W, OUT_H);
        const octx = outCanvas.getContext("2d");
        if (!octx) return;

        const { w: W, h: H } = viewRef.current;

        // Crop is measured against the drawn image, so the same settings give
        // the same output whatever size the panel happens to be.
        const scaleFactor = OUT_W / (crop.w * dwBg);
        const cropPixelX = W / 2 + crop.cx * dwBg;
        const cropPixelY = H / 2 + crop.cy * dwBg;

        // Anything the photo does not reach must still be a real colour.
        octx.fillStyle = bgColor;
        octx.fillRect(0, 0, OUT_W, OUT_H);

        octx.save();
        octx.translate(OUT_W / 2, OUT_H / 2);
        octx.rotate(deg2rad(-crop.rot));
        octx.scale(scaleFactor, scaleFactor);
        octx.translate(-cropPixelX, -cropPixelY);

        octx.translate(W / 2, H / 2);
        octx.rotate(deg2rad(rotate));
        octx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
        octx.drawImage(image, -dwBg / 2, -dhBg / 2, dwBg, dhBg);
        if (paintRef.current) {
          octx.drawImage(paintRef.current, -dwBg / 2, -dhBg / 2, dwBg, dhBg);
        }
        octx.restore();

        onImageData(octx.getImageData(0, 0, OUT_W, OUT_H));
      }, 150);
    };

    /* ---------------------------------------------
     * Main Draw Loop
     * --------------------------------------------- */
    /**
     * The paint, at the picture's own resolution.
     *
     * A layer of its own rather than strokes drawn into the picture, so it can
     * be undone and cleared, and so nothing is lost to being drawn twice.
     */
    const paintRef = useRef<HTMLCanvasElement | null>(null);
    const undoRef = useRef<ImageData[]>([]);
    const strokeRef = useRef<{ x: number; y: number } | null>(null);
    const hoverRef = useRef<{ x: number; y: number } | null>(null);

    /**
     * Set for a redraw that only moved the brush ring.
     *
     * Every draw ends by handing the crop over to the generator, which reads a
     * couple of million pixels back off a canvas. Moving the pointer with the
     * brush on redraws constantly and none of those redraws change the picture,
     * so they skip that last step.
     */
    const ringOnlyRef = useRef(false);

    /** A line, box or oval being dragged out, before the button comes up. */
    const pendingRef = useRef<
      { from: { x: number; y: number }; to: { x: number; y: number } } | null
    >(null);

    useEffect(() => {
      undoRef.current = [];
      if (!image) {
        paintRef.current = null;
        return;
      }
      const c = document.createElement("canvas");
      c.width = image.naturalWidth;
      c.height = image.naturalHeight;
      paintRef.current = c;
    }, [image]);

    /** Where a point in the drawn scene lands in the picture, in its pixels. */
    const toPicture = (x: number, y: number) => {
      const { w: W, h: H } = viewRef.current;
      const { dw, dh } = fitRef.current;
      if (!image || !(dw > 0) || !(dh > 0)) return null;

      const rad = deg2rad(rotate);
      const a = x - W / 2;
      const b = y - H / 2;

      let u = a * Math.cos(rad) + b * Math.sin(rad);
      let v = -a * Math.sin(rad) + b * Math.cos(rad);
      if (flipH) u = -u;
      if (flipV) v = -v;

      return {
        x: ((u + dw / 2) / dw) * image.naturalWidth,
        y: ((v + dh / 2) / dh) * image.naturalHeight,
      };
    };

    /** Brush width in the picture's pixels, from its width on screen. */
    const brushInPicture = () => {
      const { dw } = fitRef.current;
      if (!image || !(dw > 0)) return 1;
      const perPixel = (dw / image.naturalWidth) * viewScale;
      return Math.max(1, (paintSize ?? 24) / Math.max(1e-6, perPixel));
    };

    /** Every tool but the crop frame draws, and they all draw the same way. */
    const paints = tool !== "crop" && tool !== "pick";
    const dragsAShape = tool === "line" || tool === "rect" || tool === "ellipse";

    const dressUp = (ctx: CanvasRenderingContext2D) => {
      ctx.globalCompositeOperation = tool === "erase" ? "destination-out" : "source-over";
      ctx.strokeStyle = paintColor ?? "#ffffff";
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = brushInPicture();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    };

    const strokeTo = (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const layer = paintRef.current;
      const ctx = layer?.getContext("2d");
      if (!ctx) return;

      ctx.save();
      dressUp(ctx);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.restore();
    };

    /** A line, box or oval between two corners, in the picture's own pixels. */
    const shapePath = (
      ctx: CanvasRenderingContext2D,
      a: { x: number; y: number },
      b: { x: number; y: number },
    ) => {
      ctx.beginPath();
      if (tool === "line") {
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      } else if (tool === "rect") {
        ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      } else {
        ctx.ellipse(
          (a.x + b.x) / 2, (a.y + b.y) / 2,
          Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2,
          0, 0, Math.PI * 2,
        );
      }
    };

    const commitShape = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      const ctx = paintRef.current?.getContext("2d");
      if (!ctx) return;
      ctx.save();
      dressUp(ctx);
      shapePath(ctx, a, b);
      if (tool === "line") ctx.stroke();
      else ctx.fill();
      ctx.restore();
    };

    /**
     * Floods outwards from a point over everything close enough in colour.
     *
     * Judged on the picture with the paint already over it, which is the thing
     * on screen, so a fill runs up against an earlier stroke the way it looks
     * as though it should. Big pictures are left alone — two more copies of a
     * forty-megapixel one is not worth a bucket tool.
     */
    const floodFrom = (seed: { x: number; y: number }) => {
      const layer = paintRef.current;
      const lctx = layer?.getContext("2d", { willReadFrequently: true });
      if (!image || !layer || !lctx) return;

      const w = layer.width;
      const h = layer.height;
      if (w * h > 40e6) return;

      const sx = Math.floor(seed.x);
      const sy = Math.floor(seed.y);
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) return;

      const flat = document.createElement("canvas");
      flat.width = w;
      flat.height = h;
      const fctx = flat.getContext("2d", { willReadFrequently: true });
      if (!fctx) return;
      fctx.drawImage(image, 0, 0, w, h);
      fctx.drawImage(layer, 0, 0);

      const src = fctx.getImageData(0, 0, w, h).data;
      const out = lctx.getImageData(0, 0, w, h);
      const dst = out.data;

      const at = (sy * w + sx) * 4;
      const r0 = src[at], g0 = src[at + 1], b0 = src[at + 2];

      const tol = Math.max(0, fillTolerance ?? 40);
      const limit = tol * tol * 3;

      const hex = paintColor ?? "#ffffff";
      const rN = parseInt(hex.slice(1, 3), 16);
      const gN = parseInt(hex.slice(3, 5), 16);
      const bN = parseInt(hex.slice(5, 7), 16);
      const erasing = tool === "erase";

      const done = new Uint8Array(w * h);

      const close = (i: number) => {
        const o = i * 4;
        const dr = src[o] - r0;
        const dg = src[o + 1] - g0;
        const db = src[o + 2] - b0;
        return dr * dr + dg * dg + db * db <= limit;
      };

      const put = (i: number) => {
        const o = i * 4;
        if (erasing) {
          dst[o + 3] = 0;
        } else {
          dst[o] = rN;
          dst[o + 1] = gN;
          dst[o + 2] = bN;
          dst[o + 3] = 255;
        }
        done[i] = 1;
      };

      // A run at a time rather than a pixel at a time. Filling a big flat area
      // pixelwise holds one entry per pixel waiting to be looked at, which for
      // a picture this size is millions; by runs it is a few hundred.
      const stack: number[] = [sx, sy];

      while (stack.length) {
        const y = stack.pop()!;
        const x = stack.pop()!;
        const row = y * w;
        if (done[row + x] || !close(row + x)) continue;

        let lo = x;
        while (lo > 0 && !done[row + lo - 1] && close(row + lo - 1)) lo--;
        let hi = x;
        while (hi + 1 < w && !done[row + hi + 1] && close(row + hi + 1)) hi++;

        for (let i = lo; i <= hi; i++) put(row + i);

        for (const ny of [y - 1, y + 1]) {
          if (ny < 0 || ny >= h) continue;
          const above = ny * w;
          let run = false;
          for (let i = lo; i <= hi; i++) {
            const ok = !done[above + i] && close(above + i);
            if (ok && !run) {
              stack.push(i, ny);
              run = true;
            } else if (!ok) {
              run = false;
            }
          }
        }
      }

      lctx.putImageData(out, 0, 0);
    };

    /** The colour under a point, picture and paint together. */
    const pickAt = (p: { x: number; y: number }): string | null => {
      const layer = paintRef.current;
      if (!image || !layer) return null;

      const c = document.createElement("canvas");
      c.width = 1;
      c.height = 1;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;

      ctx.drawImage(image, -p.x, -p.y, layer.width, layer.height);
      ctx.drawImage(layer, -p.x, -p.y);

      const d = ctx.getImageData(0, 0, 1, 1).data;
      const two = (v: number) => v.toString(16).padStart(2, "0");
      return `#${two(d[0])}${two(d[1])}${two(d[2])}`;
    };

    const draw = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas || !image) return;

      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;

      const { w: W, h: H } = viewRef.current;
      const dpr = window.devicePixelRatio || 1;

      // 1. Setup Canvas
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // The whole canvas carries the backdrop, not just the crop: anything the
      // photo does not cover ends up this colour, and seeing it everywhere
      // makes that obvious while composing.
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, W, H);

      // Zoom
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.scale(viewScale, viewScale);
      ctx.translate(-W / 2, -H / 2);

      // 2. Draw Background Image
      const iw = image.naturalWidth;
      const ih = image.naturalHeight;

      const rad = deg2rad(rotate);
      const absCos = Math.abs(Math.cos(rad));
      const absSin = Math.abs(Math.sin(rad));

      const rotatedW = iw * absCos + ih * absSin;
      const rotatedH = iw * absSin + ih * absCos;
      const scale = Math.min(W / rotatedW, H / rotatedH);

      const dw = iw * scale;
      const dh = ih * scale;
      fitRef.current = { dw, dh };

      // Crop pixels
      const cropW = crop.w * dw;
      const cropH = cropW / cropRatio;
      const cx = W / 2 + crop.cx * dw;
      const cy = H / 2 + crop.cy * dw;

      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate(rad);
      ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
      ctx.drawImage(image, -dw / 2, -dh / 2, dw, dh);
      if (paintRef.current) {
        ctx.drawImage(paintRef.current, -dw / 2, -dh / 2, dw, dh);
      }
      if (pendingRef.current) {
        // Drawn exactly as it will land, so there is nothing to be surprised by
        // when the button comes up.
        const { from, to } = pendingRef.current;
        ctx.save();
        ctx.translate(-dw / 2, -dh / 2);
        ctx.scale(dw / image.naturalWidth, dh / image.naturalHeight);
        dressUp(ctx);
        shapePath(ctx, from, to);
        if (tool === "line") ctx.stroke();
        else ctx.fill();
        ctx.restore();
      }
      ctx.restore();

      // 3. Shadow Mask
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(deg2rad(crop.rot));

      ctx.beginPath();
      drawShape(ctx, cropW, cropH);

      const big = Math.max(W, H) * 3;
      const safeBig = big / Math.min(0.1, viewScale);
      ctx.rect(-safeBig / 2, -safeBig / 2, safeBig, safeBig);

      ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
      ctx.fill("evenodd");
      ctx.restore();

      // 3b. Frame band — the flat border will sit here and hide whatever is
      // under it, so show it before someone frames a detail into it.
      if (
        frameScale.kx > 0 &&
        frameScale.ky > 0 &&
        (frameScale.kx < 0.999 || frameScale.ky < 0.999)
      ) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(deg2rad(crop.rot));

        ctx.beginPath();
        drawShape(ctx, cropW, cropH);
        drawShapeScaled(ctx, cropW, cropH, frameScale.kx, frameScale.ky);
        ctx.fillStyle = "rgba(2, 6, 23, 0.55)";
        ctx.fill("evenodd");

        ctx.beginPath();
        drawShapeScaled(ctx, cropW, cropH, frameScale.kx, frameScale.ky);
        ctx.strokeStyle = "rgba(165, 243, 252, 0.5)";
        ctx.lineWidth = 1 / viewScale;
        ctx.setLineDash([5 / viewScale, 4 / viewScale]);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.restore();
      }

      // 4. Overlay lines
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(deg2rad(crop.rot));

      // A) Shape Outline
      ctx.beginPath();
      ctx.strokeStyle = "#00ffff";
      ctx.lineWidth = 2;
      drawShape(ctx, cropW, cropH);
      ctx.stroke();

      // B) Bounding Box
      ctx.beginPath();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.rect(-cropW / 2, -cropH / 2, cropW, cropH);
      ctx.stroke();

      // C) Controls
      ctx.setLineDash([]);
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1;
      ctx.fillStyle = "#fff";

      const corners = [
        { x: -cropW / 2, y: -cropH / 2 },
        { x: cropW / 2, y: -cropH / 2 },
        { x: cropW / 2, y: cropH / 2 },
        { x: -cropW / 2, y: cropH / 2 },
      ];

      const effHandleSize = HANDLE_SIZE / viewScale;

      corners.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, effHandleSize, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });

      if (freeRatio) {
        // Side grips: one axis each, so the box can be stretched horizontally
        // or vertically without disturbing the other pair of sides.
        [
          { x: -cropW / 2, y: 0 },
          { x: cropW / 2, y: 0 },
          { x: 0, y: -cropH / 2 },
          { x: 0, y: cropH / 2 },
        ].forEach((p) => {
          ctx.beginPath();
          ctx.arc(p.x, p.y, effHandleSize * 0.8, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        });
      }

      const rotY = rotHandleLocalY(cropH, cx, cy);
      ctx.beginPath();
      ctx.moveTo(0, -cropH / 2);
      ctx.lineTo(0, rotY);
      ctx.strokeStyle = "#fff";
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, rotY, effHandleSize, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.restore();
      ctx.restore(); // zoom restore

      // 5. The brush, so its width is something you can see rather than guess.
      // Drawn after the zoom has been put back, so the pointer's scene position
      // has to come forward to the screen with it.
      if (paints && hoverRef.current) {
        const sx = (hoverRef.current.x - W / 2) * viewScale + W / 2;
        const sy = (hoverRef.current.y - H / 2) * viewScale + H / 2;
        const r = ((brushInPicture() * dw) / image.naturalWidth / 2) * viewScale;

        ctx.save();
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(1, r), 0, Math.PI * 2);
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(255,255,255,0.6)";
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(0,0,0,0.8)";
        ctx.stroke();
        ctx.restore();
      }

      // 6. Output generation
      if (ringOnlyRef.current) ringOnlyRef.current = false;
      else triggerOutputGeneration(dw, dh);
    }, [image, crop, rotate, flipH, flipV, shapeId, cropRatio, viewScale,
        frameMm, widthMm, bgColor, detail, freeRatio, tool, paintColor, paintSize]);

    useEffect(() => {
      drawRef.current = draw;
    }, [draw]);

    /* ---------------------------------------------
     * Interaction Logic
     * --------------------------------------------- */

    const handleWheel = (e: React.WheelEvent) => {
      const ZOOM_SPEED = 0.001;
      const newScale = viewScale + -e.deltaY * ZOOM_SPEED;
      const clamped = Math.min(5, Math.max(0.1, newScale));
      setViewScale(clamped);
    };

    const getScenePointerPos = (e: React.PointerEvent) => {
      const rect = containerRef.current!.getBoundingClientRect();
      const rawX = e.clientX - rect.left;
      const rawY = e.clientY - rect.top;

      const { w: W, h: H } = viewRef.current;
      const cx = W / 2;
      const cy = H / 2;

      return {
        x: (rawX - cx) / viewScale + cx,
        y: (rawY - cy) / viewScale + cy,
      };
    };

    const handlePointerDown = (e: React.PointerEvent) => {
      e.preventDefault();
      if (!image) return;

      const { x, y } = getScenePointerPos(e);

      if (tool !== "crop") {
        const at = toPicture(x, y);
        if (!at) return;
        hoverRef.current = { x, y };

        if (tool === "pick") {
          const hex = pickAt(at);
          if (hex) onPickColor?.(hex);
          return;
        }

        // One snapshot per thing done, not per move, so undo steps back the
        // way it was drawn. A dozen is plenty and keeps a big picture's worth
        // of them from sitting in memory.
        const layer = paintRef.current;
        const lctx = layer?.getContext("2d", { willReadFrequently: true });
        if (layer && lctx) {
          undoRef.current.push(lctx.getImageData(0, 0, layer.width, layer.height));
          if (undoRef.current.length > 12) undoRef.current.shift();
        }

        if (tool === "fill") {
          floodFrom(at);
          draw();
          return;
        }

        if (dragsAShape) {
          pendingRef.current = { from: at, to: at };
          ringOnlyRef.current = true;
          draw();
          return;
        }

        strokeRef.current = at;
        strokeTo(at, at);
        draw();
        return;
      }
      const { w: W, h: H } = viewRef.current;
      const { dw } = fitRef.current;

      const cx = W / 2 + crop.cx * dw;
      const cy = H / 2 + crop.cy * dw;
      const cropW = crop.w * dw;
      const cropH = cropW / cropRatio;

      const local = unrotatePoint(x - cx, y - cy, crop.rot);
      const lx = local.x;
      const ly = local.y;

      const halfW = cropW / 2;
      const halfH = cropH / 2;

      const tol = (HANDLE_SIZE + 10) / viewScale;

      const rotY = rotHandleLocalY(cropH, cx, cy);
      const distRot = Math.hypot(lx - 0, ly - rotY);

      if (distRot <= tol) {
        const angle = Math.atan2(y - cy, x - cx);
        dragRef.current = {
          mode: "rotate",
          startX: x,
          startY: y,
          startCrop: { ...crop },
          startAngle: angle,
        };
        return;
      }

      const onCorner =
        Math.abs(Math.abs(lx) - halfW) < tol &&
        Math.abs(Math.abs(ly) - halfH) < tol;

      if (onCorner) {
        dragRef.current = freeRatio
          ? {
              mode: "box",
              startX: x,
              startY: y,
              startCrop: { ...crop },
              axisX: true,
              axisY: true,
              startRatio: cropRatio,
            }
          : {
              mode: "resize",
              startX: x,
              startY: y,
              startCrop: { ...crop },
              startDist: Math.hypot(lx, ly),
            };
        return;
      }

      if (freeRatio) {
        const onSide = Math.abs(Math.abs(lx) - halfW) < tol && Math.abs(ly) < tol;
        const onCap = Math.abs(Math.abs(ly) - halfH) < tol && Math.abs(lx) < tol;

        if (onSide || onCap) {
          dragRef.current = {
            mode: "box",
            startX: x,
            startY: y,
            startCrop: { ...crop },
            axisX: onSide,
            axisY: onCap,
            startRatio: cropRatio,
          };
          return;
        }
      }

      if (lx >= -halfW && lx <= halfW && ly >= -halfH && ly <= halfH) {
        dragRef.current = {
          mode: "move",
          startX: x,
          startY: y,
          startCrop: { ...crop },
        };
      }
    };

    const handlePointerMove = (e: React.PointerEvent) => {
      if (tool !== "crop") {
        const { x, y } = getScenePointerPos(e);
        hoverRef.current = { x, y };
        const at = toPicture(x, y);

        const pending = pendingRef.current;
        if (pending && at) {
          // The shape is not on the layer yet, so nothing has changed and the
          // crop does not need handing over again.
          pendingRef.current = { from: pending.from, to: at };
          ringOnlyRef.current = true;
          draw();
          return;
        }

        const from = strokeRef.current;
        if (from && at) {
          strokeTo(from, at);
          strokeRef.current = at;
        } else {
          ringOnlyRef.current = true;
        }
        draw();
        return;
      }

      if (!dragRef.current) return;
      e.preventDefault();

      const { x, y } = getScenePointerPos(e);
      const { w: W, h: H } = viewRef.current;
      const { dw } = fitRef.current;

      const {
        mode, startX, startY, startCrop, startDist, startAngle,
        axisX, axisY, startRatio,
      } = dragRef.current;

      if (mode === "move") {
        const dx = (x - startX) / dw;
        const dy = (y - startY) / dw;
        setCrop({
          ...startCrop,
          cx: startCrop.cx + dx,
          cy: startCrop.cy + dy,
        });
      } else if (mode === "resize" && startDist !== undefined) {
        const ccx = W / 2 + startCrop.cx * dw;
        const ccy = H / 2 + startCrop.cy * dw;
        const local = unrotatePoint(x - ccx, y - ccy, startCrop.rot);
        const curDist = Math.hypot(local.x, local.y);
        const scale = curDist / startDist;
        let newW = startCrop.w * scale;
        newW = Math.max(MIN_WIDTH_RX, Math.min(newW, MAX_WIDTH_RX));
        setCrop({ ...startCrop, w: newW });
      } else if (mode === "box" && startRatio !== undefined) {
        const ccx = W / 2 + startCrop.cx * dw;
        const ccy = H / 2 + startCrop.cy * dw;
        const local = unrotatePoint(x - ccx, y - ccy, startCrop.rot);

        // Both sides are measured from the centre, the way the proportional
        // resize already works, so the box grows about its middle. The side
        // the grip does not drive is held at the size it started at — hence
        // startRatio, which the live ratio has already moved away from.
        const side = (v: number) =>
          Math.max(MIN_WIDTH_RX, Math.min(MAX_WIDTH_RX, v));
        const nextW = side(axisX ? (2 * Math.abs(local.x)) / dw : startCrop.w);
        const nextH = side(
          axisY ? (2 * Math.abs(local.y)) / dw : startCrop.w / startRatio,
        );

        setCrop({ ...startCrop, w: nextW });
        onCropRatioChange?.(nextW / nextH);
      } else if (mode === "rotate" && startAngle !== undefined) {
        const ccx = W / 2 + startCrop.cx * dw;
        const ccy = H / 2 + startCrop.cy * dw;
        const curAngle = Math.atan2(y - ccy, x - ccx);
        const deltaRad = curAngle - startAngle;
        const deltaDeg = (deltaRad * 180) / Math.PI;
        // Snap the resulting angle, not the delta: quantising the delta would
        // leave whatever offset the box already carried and drift with it.
        const rot = startCrop.rot + deltaDeg;
        setCrop({
          ...startCrop,
          rot: snapDeg > 0 ? Math.round(rot / snapDeg) * snapDeg : rot,
        });
      }
    };

    const handlePointerUp = () => {
      dragRef.current = null;

      const pending = pendingRef.current;
      if (pending) {
        pendingRef.current = null;
        commitShape(pending.from, pending.to);
        draw();
        return;
      }

      if (strokeRef.current) {
        strokeRef.current = null;
        draw();
      }
    };

    useEffect(() => {
      if (!containerRef.current) return;
      const ro = new ResizeObserver((entries) => {
        const r = entries[0].contentRect;
        viewRef.current = { w: r.width, h: r.height };
        draw();
      });
      ro.observe(containerRef.current);
      return () => ro.disconnect();
    }, [draw]);

    useEffect(() => {
      draw();
    }, [draw]);

    return (
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          touchAction: "none",
          cursor: "crosshair",
          overflow: "hidden",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onWheel={handleWheel}
      >
        <canvas
          ref={canvasRef}
          style={{
            width: "100%",
            height: "100%",
            borderRadius: 12,
            display: "block",
          }}
        />
      </div>
    );
  }
);

export default ImageEditor;
