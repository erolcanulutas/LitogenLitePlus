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
  | "pick"
  | "text";

export type ImageEditorHandle = {
  reset: () => void;
  /** Steps back through the last dozen things painted, and forward again. */
  undoPaint: () => void;
  redoPaint: () => void;
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
  /** Boxes and ovals come out solid, or as an outline of the brush's width. */
  shapeFill?: boolean;
  /** 0..1. Anything under one lets what is underneath show through. */
  opacity?: number;
  /** 0..1 of the brush's own width, as how far its edge is feathered. */
  softness?: number;
  fontFamily?: string;
  /** Cap height on screen, like the brush width, so the zoom does not move it. */
  fontSize?: number;
  onPickColor?: (hex: string) => void;
  onImageData: (img: ImageData | null) => void;
};

/* ---------------------------------------------
 * Math Helpers
 * --------------------------------------------- */

/** How far past the picture the paint reaches, as a multiple of its size. */
const PAINT_SPAN = 2;
/** Longest side of the paint layer, whatever the picture's own resolution. */
const PAINT_MAX = 4096;

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
      shapeFill = true, opacity = 1, softness = 0,
      fontFamily = "Arial", fontSize = 48,
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
        const ctx = layer?.getContext("2d", { willReadFrequently: true });
        const back = undoRef.current.pop();
        if (!layer || !ctx || !back) return;
        redoRef.current.push(ctx.getImageData(0, 0, layer.width, layer.height));
        ctx.putImageData(back, 0, 0);
        drawRef.current?.();
      },
      redoPaint: () => {
        const layer = paintRef.current;
        const ctx = layer?.getContext("2d", { willReadFrequently: true });
        const forward = redoRef.current.pop();
        if (!layer || !ctx || !forward) return;
        undoRef.current.push(ctx.getImageData(0, 0, layer.width, layer.height));
        ctx.putImageData(forward, 0, 0);
        drawRef.current?.();
      },
      clearPaint: () => {
        const layer = paintRef.current;
        const ctx = layer?.getContext("2d", { willReadFrequently: true });
        if (!layer || !ctx) return;
        undoRef.current.push(ctx.getImageData(0, 0, layer.width, layer.height));
        redoRef.current = [];
        ctx.clearRect(0, 0, layer.width, layer.height);
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
          octx.drawImage(
            paintRef.current,
            (-dwBg * PAINT_SPAN) / 2, (-dhBg * PAINT_SPAN) / 2,
            dwBg * PAINT_SPAN, dhBg * PAINT_SPAN,
          );
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
    const redoRef = useRef<ImageData[]>([]);
    /** Paint-layer pixels per picture pixel. */
    const paintScaleRef = useRef(1);
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

    /**
     * The shape being worked on, in the picture's own pixels.
     *
     * It stays after the button comes up rather than being stamped down, with
     * a box and grips round it, so it can be nudged and resized like anything
     * else drawn on a canvas. It goes onto the paint layer when it is finished
     * with: a press of Enter, a change of tool, or a click somewhere else.
     */
    const pendingRef = useRef<
      {
        kind: "line" | "rect" | "ellipse" | "text";
        from: { x: number; y: number };
        to: { x: number; y: number };
        /** Only for text: what it says. The box is what it wraps to. */
        body?: string;
      } | null
    >(null);

    /** Which grip is being dragged, and what the shape looked like before. */
    /** Lets an effect put the working shape down when the tool changes. */
    const settleRef = useRef<(() => boolean) | null>(null);

    /**
     * Where the text box is, and what is in it.
     *
     * A real textarea parked over the canvas rather than a caret drawn on it:
     * that is selection, the clipboard, a native cursor and every keyboard
     * anyone has, for free, and it can be dragged to size by its own corner.
     * What it is showing is what will be laid down — same face, same size.
     */
    const [textAt, setTextAt] = useState<
      { x: number; y: number; w?: number; h?: number } | null
    >(null);
    const [draft, setDraft] = useState("");
    const boxRef = useRef<HTMLTextAreaElement>(null);
    const settleTextRef = useRef<(() => void) | null>(null);

    const grabRef = useRef<
      | {
          mode: "new" | "move" | "grip";
          gx: -1 | 0 | 1;
          gy: -1 | 0 | 1;
          orig: { from: { x: number; y: number }; to: { x: number; y: number } };
          at: { x: number; y: number };
        }
      | null
    >(null);

    useEffect(() => {
      undoRef.current = [];
      redoRef.current = [];
      if (!image) {
        paintRef.current = null;
        return;
      }
      // Twice the picture across and twice down, centred on it, because the
      // backdrop is part of what gets printed and a brush that stopped at the
      // picture's edge could not touch it. Capped, because at a photograph's
      // own resolution four times its area is a great deal of canvas for
      // something that is only ever downsampled into the crop.
      const spanW = image.naturalWidth * PAINT_SPAN;
      const spanH = image.naturalHeight * PAINT_SPAN;
      const k = Math.min(1, PAINT_MAX / Math.max(spanW, spanH));

      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(spanW * k));
      c.height = Math.max(1, Math.round(spanH * k));
      paintRef.current = c;
      paintScaleRef.current = k;
    }, [image]);

    /** Picture pixels to paint-layer pixels. */
    const toLayer = (p: { x: number; y: number }) => {
      const k = paintScaleRef.current;
      const iw = image?.naturalWidth ?? 0;
      const ih = image?.naturalHeight ?? 0;
      const edge = (PAINT_SPAN - 1) / 2;
      return { x: (p.x + iw * edge) * k, y: (p.y + ih * edge) * k };
    };

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

    /** Brush width in paint-layer pixels, from its width on screen. */
    const brushInPicture = () => {
      const { dw } = fitRef.current;
      if (!image || !(dw > 0)) return 1;
      const perPixel = (dw / image.naturalWidth) * viewScale;
      return Math.max(1, ((paintSize ?? 24) / Math.max(1e-6, perPixel)) * paintScaleRef.current);
    };

    /** Every tool but the crop frame draws, and they all draw the same way. */
    const dragsAShape = tool === "line" || tool === "rect" || tool === "ellipse";
    /** Only the freehand tools want a ring; a shape shows itself as it is drawn. */
    const showsRing = tool === "brush" || tool === "erase";

    const dressUp = (ctx: CanvasRenderingContext2D) => {
      ctx.globalCompositeOperation = tool === "erase" ? "destination-out" : "source-over";
      ctx.globalAlpha = Math.max(0.02, Math.min(1, opacity));
      ctx.strokeStyle = paintColor ?? "#ffffff";
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = brushInPicture();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // Feathering costs a blur of the whole stroke, so it is left off
      // entirely rather than set to zero — a filter of "blur(0px)" still puts
      // the canvas through the slow path.
      const feather = softness * brushInPicture() * 0.25;
      if (feather > 0.4) ctx.filter = `blur(${feather.toFixed(2)}px)`;
    };

    /** The text as it will be stamped, in paint-layer pixels. */
    const textInPicture = () => {
      const { dw } = fitRef.current;
      if (!image || !(dw > 0)) return 1;
      const perPixel = (dw / image.naturalWidth) * viewScale;
      return Math.max(1, (fontSize / Math.max(1e-6, perPixel)) * paintScaleRef.current);
    };

    const layOutText = (ctx: CanvasRenderingContext2D) => {
      ctx.font = `${textInPicture()}px ${fontFamily}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    };

    const strokeTo = (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const layer = paintRef.current;
      const ctx = layer?.getContext("2d");
      if (!ctx) return;

      const a = toLayer(from);
      const b = toLayer(to);

      ctx.save();
      dressUp(ctx);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();
    };

    /** A line, box or oval between two corners, in the picture's own pixels. */
    const shapePath = (
      ctx: CanvasRenderingContext2D,
      kind: "line" | "rect" | "ellipse",
      a: { x: number; y: number },
      b: { x: number; y: number },
    ) => {
      ctx.beginPath();
      if (kind === "line") {
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      } else if (kind === "rect") {
        ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      } else {
        ctx.ellipse(
          (a.x + b.x) / 2, (a.y + b.y) / 2,
          Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2,
          0, 0, Math.PI * 2,
        );
      }
    };

    const commitShape = (
      kind: "line" | "rect" | "ellipse",
      from: { x: number; y: number },
      to: { x: number; y: number },
    ) => {
      const ctx = paintRef.current?.getContext("2d");
      if (!ctx) return;
      ctx.save();
      dressUp(ctx);
      shapePath(ctx, kind, toLayer(from), toLayer(to));
      if (kind === "line" || !shapeFill) ctx.stroke();
      else ctx.fill();
      ctx.restore();
    };

    /** The eight grips round a box, or the two ends of a line. */
    const gripsOf = (p: {
      kind: "line" | "rect" | "ellipse" | "text";
      from: { x: number; y: number };
      to: { x: number; y: number };
    }) => {
      if (p.kind === "line") {
        return [
          { gx: -1 as const, gy: -1 as const, x: p.from.x, y: p.from.y },
          { gx: 1 as const, gy: 1 as const, x: p.to.x, y: p.to.y },
        ];
      }

      const x0 = Math.min(p.from.x, p.to.x);
      const x1 = Math.max(p.from.x, p.to.x);
      const y0 = Math.min(p.from.y, p.to.y);
      const y1 = Math.max(p.from.y, p.to.y);
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;

      const out: { gx: -1 | 0 | 1; gy: -1 | 0 | 1; x: number; y: number }[] = [];
      for (const gy of [-1, 0, 1] as const) {
        for (const gx of [-1, 0, 1] as const) {
          if (gx === 0 && gy === 0) continue;
          out.push({
            gx, gy,
            x: gx < 0 ? x0 : gx > 0 ? x1 : mx,
            y: gy < 0 ? y0 : gy > 0 ? y1 : my,
          });
        }
      }
      return out;
    };

    /** The other way round: a point in the picture, on the screen. */
    const toScreen = (p: { x: number; y: number }) => {
      const { w: W, h: H } = viewRef.current;
      const { dw, dh } = fitRef.current;
      if (!image || !(dw > 0)) return { x: 0, y: 0 };

      const lx = (p.x / image.naturalWidth) * dw - dw / 2;
      const ly = (p.y / image.naturalHeight) * dh - dh / 2;

      const rad = deg2rad(rotate);
      const fx = flipH ? -lx : lx;
      const fy = flipV ? -ly : ly;

      const rx = fx * Math.cos(rad) - fy * Math.sin(rad);
      const ry = fx * Math.sin(rad) + fy * Math.cos(rad);

      return { x: rx * viewScale + W / 2, y: ry * viewScale + H / 2 };
    };

    /** A screen distance in the picture's own pixels, for hit testing. */
    const slackInPicture = (screenPx: number) => {
      const { dw } = fitRef.current;
      if (!image || !(dw > 0)) return screenPx;
      return screenPx / ((dw / image.naturalWidth) * viewScale);
    };

    /** Where a drag leaves the shape, given which grip it started on. */
    const afterGrab = (
      grab: NonNullable<typeof grabRef.current>,
      p: { x: number; y: number },
    ) => {
      const dx = p.x - grab.at.x;
      const dy = p.y - grab.at.y;
      const { from, to } = grab.orig;

      if (grab.mode === "move") {
        return {
          from: { x: from.x + dx, y: from.y + dy },
          to: { x: to.x + dx, y: to.y + dy },
        };
      }

      // A grip moves the corner it sits on and leaves the opposite one alone;
      // an edge grip moves one axis only.
      const next = { from: { ...from }, to: { ...to } };
      const lowX = from.x <= to.x;
      const lowY = from.y <= to.y;

      if (grab.gx < 0) {
        if (lowX) next.from.x = from.x + dx;
        else next.to.x = to.x + dx;
      } else if (grab.gx > 0) {
        if (lowX) next.to.x = to.x + dx;
        else next.from.x = from.x + dx;
      }

      if (grab.gy < 0) {
        if (lowY) next.from.y = from.y + dy;
        else next.to.y = to.y + dy;
      } else if (grab.gy > 0) {
        if (lowY) next.to.y = to.y + dy;
        else next.from.y = from.y + dy;
      }

      return next;
    };

    /** One snapshot per thing done, so undo steps back the way it was drawn. */
    const remember = () => {
      const layer = paintRef.current;
      const lctx = layer?.getContext("2d", { willReadFrequently: true });
      if (!layer || !lctx) return;
      undoRef.current.push(lctx.getImageData(0, 0, layer.width, layer.height));
      if (undoRef.current.length > 12) undoRef.current.shift();
      // Doing something new is where a branch that was undone stops being
      // reachable, so that is where the way forward is dropped.
      redoRef.current = [];
    };

    /** Puts the shape being worked on down onto the paint layer. */
    const settle = () => {
      const p = pendingRef.current;
      if (!p) return false;
      pendingRef.current = null;
      if (p.kind === "text" ? !p.body?.trim() : Math.abs(p.to.x - p.from.x) < 0.5 && Math.abs(p.to.y - p.from.y) < 0.5) {
        return false;
      }
      remember();
      if (p.kind === "text") commitText(p.from, p.to, p.body ?? "");
      else commitShape(p.kind, p.from, p.to);
      return true;
    };

    settleRef.current = settle;

    /** Puts whatever is in the text box down, and takes the box away. */
    const settleText = () => {
      if (!textAt) return;
      const body = draft;
      const box = boxRef.current;
      const wide = slackInPicture(box?.offsetWidth ?? 240);
      const tall = slackInPicture(box?.offsetHeight ?? 80);

      setTextAt(null);
      setDraft("");

      // It becomes the working object rather than paint, so it can still be
      // moved and resized. It only reaches the layer when it is finished with.
      if (body.trim()) {
        pendingRef.current = {
          kind: "text",
          from: textAt,
          to: { x: textAt.x + wide, y: textAt.y + tall },
          body,
        };
        drawRef.current?.();
      }
    };

    settleTextRef.current = settleText;

    /**
     * Lays the typed text down, wrapped to the width of the box it was typed
     * in, with its top-left corner where the box was.
     *
     * Mirrored first if the picture is, because the paint goes down with the
     * picture and would otherwise come out back to front — which is the one
     * thing text cannot get away with.
     */
    const layText = (
      ctx: CanvasRenderingContext2D,
      from: { x: number; y: number },
      to: { x: number; y: number },
      body: string,
    ) => {
      const size = textInPicture();
      const corner = toLayer({ x: Math.min(from.x, to.x), y: Math.min(from.y, to.y) });
      const wide = Math.max(size, Math.abs(toLayer(to).x - toLayer(from).x));

      layOutText(ctx);
      ctx.textBaseline = "top";
      ctx.save();
      ctx.translate(corner.x, corner.y);
      ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);

      let line = 0;
      for (const para of body.split("\n")) {
        let run = "";
        for (const word of para.split(" ")) {
          const test = run ? `${run} ${word}` : word;
          if (run && ctx.measureText(test).width > wide) {
            ctx.fillText(run, 0, line * size * 1.2);
            line++;
            run = word;
          } else {
            run = test;
          }
        }
        ctx.fillText(run, 0, line * size * 1.2);
        line++;
      }

      ctx.restore();
    };

    /**
     * Lays the text down for good, wrapped to its box.
     *
     * Mirrored on the way if the picture is, because the paint goes down with
     * the picture and would otherwise come out back to front — which is the
     * one thing text cannot get away with.
     */
    const commitText = (
      from: { x: number; y: number },
      to: { x: number; y: number },
      body: string,
    ) => {
      const ctx = paintRef.current?.getContext("2d");
      if (!ctx || !body.trim()) return;
      ctx.save();
      dressUp(ctx);
      layText(ctx, from, to, body);
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

      const at = toLayer(seed);
      const sx = Math.floor(at.x);
      const sy = Math.floor(at.y);
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) return;

      const flat = document.createElement("canvas");
      flat.width = w;
      flat.height = h;
      const fctx = flat.getContext("2d", { willReadFrequently: true });
      if (!fctx) return;

      // What the eye sees, in the order it is stacked: backdrop, then the
      // picture over its own part of it, then the paint over both. Without the
      // backdrop the margin round the picture would read as transparent black
      // and a fill started out there would stop at the picture's edge.
      fctx.fillStyle = bgColor;
      fctx.fillRect(0, 0, w, h);

      const spot = imageInLayer();
      fctx.drawImage(image, spot.x, spot.y, spot.w, spot.h);
      fctx.drawImage(layer, 0, 0);

      const src = fctx.getImageData(0, 0, w, h).data;
      const out = lctx.getImageData(0, 0, w, h);
      const dst = out.data;

      const seedAt = (sy * w + sx) * 4;
      const r0 = src[seedAt], g0 = src[seedAt + 1], b0 = src[seedAt + 2];

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

    /** Where the picture sits inside the paint layer. */
    const imageInLayer = () => {
      const k = paintScaleRef.current;
      const iw = image?.naturalWidth ?? 0;
      const ih = image?.naturalHeight ?? 0;
      const edge = (PAINT_SPAN - 1) / 2;
      return { x: iw * edge * k, y: ih * edge * k, w: iw * k, h: ih * k };
    };

    /** The colour under a point: backdrop, picture and paint, as seen. */
    const pickAt = (p: { x: number; y: number }): string | null => {
      const layer = paintRef.current;
      if (!image || !layer) return null;

      const c = document.createElement("canvas");
      c.width = 1;
      c.height = 1;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;

      const at = toLayer(p);
      const spot = imageInLayer();

      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, 1, 1);
      ctx.drawImage(image, spot.x - at.x, spot.y - at.y, spot.w, spot.h);
      ctx.drawImage(layer, -at.x, -at.y);

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
        ctx.drawImage(
          paintRef.current,
          (-dw * PAINT_SPAN) / 2, (-dh * PAINT_SPAN) / 2,
          dw * PAINT_SPAN, dh * PAINT_SPAN,
        );
      }
      // Drawn exactly where it will land, so there is nothing to be surprised
      // by once the button comes up.
      const layer = paintRef.current;
      const inLayer = (run: (c: CanvasRenderingContext2D) => void) => {
        if (!layer) return;
        ctx.save();
        ctx.translate((-dw * PAINT_SPAN) / 2, (-dh * PAINT_SPAN) / 2);
        ctx.scale((dw * PAINT_SPAN) / layer.width, (dh * PAINT_SPAN) / layer.height);
        dressUp(ctx);
        run(ctx);
        ctx.restore();
      };

      const work = pendingRef.current;
      if (work && work.kind === "text") {
        inLayer((c) => layText(c, work.from, work.to, work.body ?? ""));
      } else if (work) {
        inLayer((c) => {
          shapePath(c, work.kind as "line" | "rect" | "ellipse", toLayer(work.from), toLayer(work.to));
          if (work.kind === "line" || !shapeFill) c.stroke();
          else c.fill();
        });
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

      // 5. The working shape's box and grips, in screen units so they stay the
      // size a pointer can hit however far the view is zoomed.
      const shaped = pendingRef.current;
      if (shaped) {
        const toScreenPt = (p: { x: number; y: number }) => {
          const lx = (p.x / image.naturalWidth) * dw - dw / 2;
          const ly = (p.y / image.naturalHeight) * dh - dh / 2;

          const rad2 = deg2rad(rotate);
          const fx = flipH ? -lx : lx;
          const fy = flipV ? -ly : ly;
          const rx = fx * Math.cos(rad2) - fy * Math.sin(rad2);
          const ry = fx * Math.sin(rad2) + fy * Math.cos(rad2);

          return {
            x: (rx + W / 2 - W / 2) * viewScale + W / 2,
            y: (ry + H / 2 - H / 2) * viewScale + H / 2,
          };
        };

        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(255,255,255,0.85)";

        const a1 = toScreenPt(shaped.from);
        const b1 = toScreenPt(shaped.to);
        ctx.strokeRect(
          Math.min(a1.x, b1.x), Math.min(a1.y, b1.y),
          Math.abs(b1.x - a1.x), Math.abs(b1.y - a1.y),
        );
        ctx.setLineDash([]);

        for (const g of gripsOf(shaped)) {
          const p = toScreenPt({ x: g.x, y: g.y });
          ctx.fillStyle = "#ffffff";
          ctx.strokeStyle = "rgba(0,0,0,0.85)";
          ctx.beginPath();
          ctx.rect(p.x - 4, p.y - 4, 8, 8);
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      }

      // 6. The brush, so its width is something you can see rather than guess.
      // Drawn after the zoom has been put back, so the pointer's scene position
      // has to come forward to the screen with it.
      if (showsRing && hoverRef.current) {
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

      // 7. Output generation
      if (ringOnlyRef.current) ringOnlyRef.current = false;
      else triggerOutputGeneration(dw, dh);
    }, [image, crop, rotate, flipH, flipV, shapeId, cropRatio, viewScale,
        frameMm, widthMm, bgColor, detail, freeRatio, tool, paintColor, paintSize,
        shapeFill, opacity, softness, fontFamily, fontSize]);

    useEffect(() => {
      drawRef.current = draw;
    }, [draw]);

    // Changing tool is one of the ways of saying you are done with a shape.
    useEffect(() => {
      settleTextRef.current?.();
      if (settleRef.current?.()) drawRef.current?.();
    }, [tool]);

    // Enter puts it down, Escape throws it away. Read through refs so the
    // listener does not have to be torn down and put back on every render.
    useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
        const target = e.target as HTMLElement | null;
        if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
        if (!pendingRef.current) return;

        if (e.key === "Enter") {
          e.preventDefault();
          settleRef.current?.();
          drawRef.current?.();
        } else if (e.key === "Escape") {
          e.preventDefault();
          pendingRef.current = null;
          drawRef.current?.();
        }
      };

      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
    }, []);

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

        // A shape already on the go takes the click first: on a grip it is
        // resized, inside it is moved, and anywhere else means it is finished
        // with and the click starts the next one.
        const working = pendingRef.current;
        if (working) {
          const slack = slackInPicture(HANDLE_SIZE + 6);
          const grip = gripsOf(working).find(
            (g) => Math.hypot(g.x - at.x, g.y - at.y) <= slack,
          );

          if (grip) {
            grabRef.current = {
              mode: "grip", gx: grip.gx, gy: grip.gy,
              orig: { from: working.from, to: working.to }, at,
            };
            return;
          }

          const x0 = Math.min(working.from.x, working.to.x) - slack;
          const x1 = Math.max(working.from.x, working.to.x) + slack;
          const y0 = Math.min(working.from.y, working.to.y) - slack;
          const y1 = Math.max(working.from.y, working.to.y) + slack;

          if (at.x >= x0 && at.x <= x1 && at.y >= y0 && at.y <= y1) {
            grabRef.current = {
              mode: "move", gx: 0, gy: 0,
              orig: { from: working.from, to: working.to }, at,
            };
            return;
          }

          settle();
        }

        if (tool === "text") {
          settleText();
          setTextAt(at);
          setDraft("");
          return;
        }

        if (tool === "fill") {
          remember();
          floodFrom(at);
          draw();
          return;
        }

        if (dragsAShape) {
          pendingRef.current = { kind: tool, from: at, to: at };
          grabRef.current = {
            mode: "new", gx: 1, gy: 1, orig: { from: at, to: at }, at,
          };
          ringOnlyRef.current = true;
          draw();
          return;
        }

        remember();
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

        const grab = grabRef.current;
        const working = pendingRef.current;
        if (grab && working && at) {
          // Nothing is on the layer yet, so the crop does not need handing
          // over again for any of this.
          const next =
            grab.mode === "new"
              ? { from: grab.orig.from, to: at }
              : afterGrab(grab, at);
          pendingRef.current = { kind: working.kind, from: next.from, to: next.to };
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

    /** Text already placed goes back into a box to be retyped. */
    const handleDoubleClick = (e: React.MouseEvent) => {
      if (tool !== "text" || !image) return;

      const work = pendingRef.current;
      if (!work || work.kind !== "text") return;

      const rect = containerRef.current!.getBoundingClientRect();
      const { w: W, h: H } = viewRef.current;
      const scene = {
        x: (e.clientX - rect.left - W / 2) / viewScale + W / 2,
        y: (e.clientY - rect.top - H / 2) / viewScale + H / 2,
      };
      const at = toPicture(scene.x, scene.y);
      if (!at) return;

      const x0 = Math.min(work.from.x, work.to.x);
      const x1 = Math.max(work.from.x, work.to.x);
      const y0 = Math.min(work.from.y, work.to.y);
      const y1 = Math.max(work.from.y, work.to.y);
      if (at.x < x0 || at.x > x1 || at.y < y0 || at.y > y1) return;

      const onScreen = (v: number) => {
        const { dw } = fitRef.current;
        if (!image || !(dw > 0)) return v;
        return v * (dw / image.naturalWidth) * viewScale;
      };

      pendingRef.current = null;
      setDraft(work.body ?? "");
      setTextAt({
        x: x0,
        y: y0,
        w: Math.max(90, onScreen(x1 - x0)),
        h: Math.max(34, onScreen(y1 - y0)),
      });
      draw();
    };

    const handlePointerUp = () => {
      dragRef.current = null;
      grabRef.current = null;

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

    // The freehand tools draw their own ring and it is the better pointer, so
    // the system one gets out of the way. Everything else wants to be aimed.
    const cursor =
      tool === "brush" || tool === "erase"
        ? "none"
        : tool === "crop" || tool === "pick"
          ? "crosshair"
          : "default";

    return (
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          touchAction: "none",
          cursor,
          overflow: "hidden",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onDoubleClick={handleDoubleClick}
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

        {textAt && tool === "text" && (() => {
          const at = toScreen(textAt);
          return (
            <div
              className="textBoxWrap"
              style={{
                left: at.x,
                top: at.y,
                transform: `rotate(${rotate}deg)`,
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <textarea
                ref={boxRef}
                className="textBox"
                autoFocus
                value={draft}
                spellCheck={false}
                placeholder="Type here"
                style={{
                  font: `${fontSize * viewScale}px ${fontFamily}`,
                  color: paintColor,
                  ...(textAt.w ? { width: textAt.w } : {}),
                  ...(textAt.h ? { height: textAt.h } : {}),
                }}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Escape") {
                    setTextAt(null);
                    setDraft("");
                  } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    settleText();
                  }
                }}
              />
              <div className="textBoxBar">
                <button
                  className="autoBtn"
                  onClick={settleText}
                  title="Put it on the picture — it stays movable until you change tool (Ctrl+Enter)"
                >
                  Place
                </button>
                <button
                  className="autoBtn"
                  onClick={() => {
                    setTextAt(null);
                    setDraft("");
                  }}
                  title="Throw it away (Esc)"
                >
                  Cancel
                </button>
              </div>
            </div>
          );
        })()}
      </div>
    );
  }
);

export default ImageEditor;
