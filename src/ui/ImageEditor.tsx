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

type DragMode = "move" | "resize" | "rotate" | null;

type DragState = {
  mode: DragMode;
  startX: number;
  startY: number;
  startCrop: Crop;
  startDist?: number;
  startAngle?: number;
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
  /** Frame band width in mm, for showing what it will cover. */
  frameMm: number;
  /** Print width in mm; the frame is only meaningful relative to it. */
  widthMm: number;
  onImageData: (img: ImageData | null) => void;
};

/* ---------------------------------------------
 * Math Helpers
 * --------------------------------------------- */

const HANDLE_SIZE = 8;
const ROT_HANDLE_PFX = 20;
const MIN_WIDTH_RX = 0.05;

function deg2rad(deg: number) {
  return (deg * Math.PI) / 180;
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
      bgColor, frameMm, widthMm, onImageData,
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

    /* ---------------------------------------------
     * Shape Path Drawing
     * --------------------------------------------- */
    const drawShape = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
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
      if (!(frameMm > 0.05) || !(widthMm > 0)) return 1;

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
      }
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
      k: number,
    ) => {
      const dy = shapeId === "triangle" ? (h * (1 - k)) / 6 : 0;
      ctx.save();
      ctx.translate(0, dy);
      drawShape(ctx, w * k, h * k);
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

        const OUT_W = 900;
        const OUT_H = Math.round(OUT_W / cropRatio);

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

      // Backdrop first, so the parts of the crop the photo does not reach look
      // here the way they will come out.
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(deg2rad(crop.rot));
      ctx.fillStyle = bgColor;
      ctx.fillRect(-cropW / 2, -cropH / 2, cropW, cropH);
      ctx.restore();

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
      if (frameScale > 0 && frameScale < 0.999) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(deg2rad(crop.rot));

        ctx.beginPath();
        drawShape(ctx, cropW, cropH);
        drawShapeScaled(ctx, cropW, cropH, frameScale);
        ctx.fillStyle = "rgba(2, 6, 23, 0.55)";
        ctx.fill("evenodd");

        ctx.beginPath();
        drawShapeScaled(ctx, cropW, cropH, frameScale);
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

      const rotY = -cropH / 2 - (ROT_HANDLE_PFX / viewScale);
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
        frameMm, widthMm, bgColor]);

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

      const rotY = -halfH - ROT_HANDLE_PFX / viewScale;
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

      if (
        (Math.abs(lx - -halfW) < tol && Math.abs(ly - -halfH) < tol) ||
        (Math.abs(lx - halfW) < tol && Math.abs(ly - -halfH) < tol) ||
        (Math.abs(lx - halfW) < tol && Math.abs(ly - halfH) < tol) ||
        (Math.abs(lx - -halfW) < tol && Math.abs(ly - halfH) < tol)
      ) {
        const dist = Math.hypot(lx, ly);
        dragRef.current = {
          mode: "resize",
          startX: x,
          startY: y,
          startCrop: { ...crop },
          startDist: dist,
        };
        return;
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

      const { mode, startX, startY, startCrop, startDist, startAngle } =
        dragRef.current;

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
        newW = Math.max(MIN_WIDTH_RX, Math.min(newW, 2.0));
        setCrop({ ...startCrop, w: newW });
      } else if (mode === "rotate" && startAngle !== undefined) {
        const ccx = W / 2 + startCrop.cx * dw;
        const ccy = H / 2 + startCrop.cy * dw;
        const curAngle = Math.atan2(y - ccy, x - ccx);
        const deltaRad = curAngle - startAngle;
        const deltaDeg = (deltaRad * 180) / Math.PI;
        setCrop({ ...startCrop, rot: startCrop.rot + deltaDeg });
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
            background: "#020617",
            display: "block",
          }}
        />
      </div>
    );
  }
);

export default ImageEditor;
