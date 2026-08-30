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

export type ImageEditorHandle = {
  reset: () => void;
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
    }));

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
        octx.restore();

        onImageData(octx.getImageData(0, 0, OUT_W, OUT_H));
      }, 150);
    };

    /* ---------------------------------------------
     * Main Draw Loop
     * --------------------------------------------- */
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

      // 5. Output generation
      triggerOutputGeneration(dw, dh);
    }, [image, crop, rotate, flipH, flipV, shapeId, cropRatio, viewScale,
        frameMm, widthMm, bgColor, detail, freeRatio]);

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
