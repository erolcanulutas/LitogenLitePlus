/// <reference lib="webworker" />
import { buildBandSquash } from "../core/squash";
import { bandCuts } from "../core/terrace";
import { radialCellMm } from "../core/quality";

import { imageToHeightmap } from "../core/heightmap";
import { writeBinarySTL } from "../core/stl_writer";
import { writeColored3MF } from "../core/3mf_writer";
import { splitMeshAtLevels } from "../core/split_mesh";
import { groupByBody } from "../core/inlay";
import { buildVectorInlay } from "../core/vector_inlay";
import { buildVectorGraphic } from "../core/vector_graphic";
import { fitTonesFor } from "../core/tones";
import type { EmbossSide } from "../core/types";
import { getShape } from "../shapes";
import type { Quality } from "../core/quality";

type JobRequest = {
  id: number;
  shapeId: string;
  image: ImageData;
  widthMm: number;
  heightMm: number;
  layerHeight: number;
  minT: number;
  maxT: number;
  frameMm: number;
  emboss: EmbossSide;
  quality: Quality;
  /** Colour-band boundaries in mm. Empty means a single-colour STL. */
  splitHeightsMm: number[];
  /** One CSS colour per band, so one more than splitHeightsMm. */
  colors: string[];
  /** Surface height per brightness band, darkest first. Empty means evenly. */
  toneHeightsMm: number[];
  smoothing: number;
  levels: number;
  toneCuts?: number[];
  /**
   * Layers of solid colour under the picture, and layers the picture is set
   * into above it. Present means an inlay: one flat slab with the tones side
   * by side in its top layers, rather than a relief.
   */
  inlayBaseLayers?: number;
  inlayTopLayers?: number;
  /**
   * Trace each tone out of the picture as a closed outline and give it its own
   * solid, rather than deciding tones by thresholds on brightness. Applies to
   * an inlay and to a terraced relief; see core/vectorise.ts.
   */
  vector?: boolean;
  /** "vertical" stands the model up; "flat" leaves it lying down. */
  orientation: "vertical" | "flat";
};

type JobResponse =
  | {
      id: number;
      ok: true;
      file: ArrayBuffer;
      extension: "stl" | "3mf";
      /** Copy of the exported triangles, for the on-page preview. */
      preview: ArrayBuffer;
      previewTriangles: number;
      /** Start triangle of each colour band, so the preview can tint them. */
      previewBands: number[];
    }
  | { id: number; ok: false; error: string };

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

/**
 * Shapes are generated lying flat, with z as thickness and the base already on
 * z = 0 — which is exactly the "flat" print orientation, so that case needs no
 * work at all.
 *
 * Standing the model up is a -90° rotation about X: (x, y, z) -> (x, -z, y),
 * then drop onto the bed.
 *
 * That is a real rotation. It used to be (x, y, z) -> (-x, -z, y), which has
 * determinant -1 — a mirror. That flipped the handedness of every triangle, so
 * the generators compensated by winding their faces inward and by sampling the
 * heightmap at (1 - u). Three compensating errors that cancelled out. The
 * rotation is now proper, faces are wound outward, and the shapes sample at u.
 */
function orientForPrinting(
  positions: Float32Array,
  floatCount: number,
  upright: boolean,
): void {
  if (!upright) return;

  let minZ = Infinity;

  for (let i = 0; i < floatCount; i += 3) {
    const y = positions[i + 1];
    positions[i + 1] = -positions[i + 2];
    positions[i + 2] = y;
    if (y < minZ) minZ = y;
  }

  if (Number.isFinite(minZ) && minZ !== 0) {
    for (let i = 2; i < floatCount; i += 3) positions[i] -= minZ;
  }
}

/** Longest side the picture is traced at, in pixels. */
const TRACE_MAX = 1600;

/**
 * Redraws the inlay's tones as traced regions.
 *
 * Traced off its own copy of the picture rather than off the heightmap. The
 * heightmap is sized for a relief — a couple of samples per printed layer,
 * around a thousand rows — and a region's edge is a line rather than a height,
 * so it shows every pixel it was traced from as a step. Two or three times the
 * resolution costs a few tens of milliseconds here and puts the steps below
 * anything a printer or the preview can show.
 */
async function tracePicture(
  src: ImageData,
  levels: number,
  floor: number,
): Promise<{ lum: Float64Array; w: number; h: number; tones: number[] } | null> {
  const aspect = src.width / src.height;
  const long = Math.max(floor, Math.min(TRACE_MAX, Math.max(src.width, src.height)));
  const w = Math.max(8, Math.round(aspect >= 1 ? long : long * aspect));
  const h = Math.max(8, Math.round(aspect >= 1 ? long / aspect : long));

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, w, h);

  const bitmap = await createImageBitmap(src);
  ctx.drawImage(bitmap, 0, 0, src.width, src.height, 0, 0, w, h);
  bitmap.close();

  const img = ctx.getImageData(0, 0, w, h);
  const lum = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    lum[i] =
      (0.2126 * img.data[o] + 0.7152 * img.data[o + 1] + 0.0722 * img.data[o + 2]) / 255;
  }

  return { lum, w, h, tones: fitTonesFor(img, levels) };
}

self.onmessage = async (ev: MessageEvent<JobRequest>) => {
  try {
    const msg = ev.data;

    if (!msg.image || msg.image.width === 0 || msg.image.height === 0) {
      throw new Error("Invalid image data");
    }

    if (msg.layerHeight <= 0) {
      throw new Error("Invalid layer height");
    }

    const targetRows = clamp(
      Math.round((msg.heightMm / msg.layerHeight) * 2),
      400,
      1200,
    );

    const src = msg.image;
    const aspect = src.width / src.height;

    const targetH = targetRows;
    const targetW = Math.max(8, Math.round(targetH * aspect));

    const canvas = new OffscreenCanvas(targetW, targetH);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    if (!ctx) throw new Error("Failed to create OffscreenCanvas context");

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.clearRect(0, 0, targetW, targetH);

    const bitmap = await createImageBitmap(src);
    ctx.drawImage(bitmap, 0, 0, src.width, src.height, 0, 0, targetW, targetH);
    bitmap.close();

    const hiResImage = ctx.getImageData(0, 0, targetW, targetH);
    const hmRaw = imageToHeightmap(hiResImage);

    const buildCtx = {
      heightmap: { w: hmRaw.w, hPx: hmRaw.hPx, h: hmRaw.h },
      minT: msg.minT,
      maxT: msg.maxT,
      frameMm: msg.frameMm,
      emboss: msg.emboss,
    };

    // Strictly increasing, strictly inside the model, and far enough apart to
    // leave a band with actual thickness.
    const cuts: number[] = [];
    for (const h of [...(msg.splitHeightsMm ?? [])].sort((a, b) => a - b)) {
      if (!(h > 0) || h >= msg.maxT) continue;
      if (cuts.length > 0 && h - cuts[cuts.length - 1] < 1e-3) continue;
      cuts.push(h);
    }

    const smoothing = clamp(msg.smoothing ?? 1, 0.4, 3);

    // An inlay is measured in layers, not millimetres: the point of it is that
    // the filament changes on a layer the printer actually lands on.
    const inlayBase = Math.max(1, Math.round(msg.inlayBaseLayers ?? 0));
    const inlayTop = Math.max(1, Math.round(msg.inlayTopLayers ?? 0));
    const inlaid = (msg.inlayBaseLayers ?? 0) >= 1 && (msg.inlayTopLayers ?? 0) >= 1;
    const inlay = inlaid
      ? {
          baseZ: +(inlayBase * msg.layerHeight).toFixed(4),
          topZ: +((inlayBase + inlayTop) * msg.layerHeight).toFixed(4),
        }
      : null;
    const levels = msg.levels >= 2 ? Math.round(clamp(msg.levels, 2, 16)) : 0;
    const toneCuts = msg.toneCuts ?? [];

    // Which runs of which bands are only the ramp between their neighbours.
    // Worked out once, off the heightmap, because it is a question about
    // regions and cannot be answered a point at a time.
    const squash =
      levels >= 2
        ? buildBandSquash(
            hmRaw,
            bandCuts(levels, toneCuts),
            msg.widthMm / hmRaw.w,
            smoothing * radialCellMm(msg.quality) * (hmRaw.w / msg.widthMm),
          )
        : null;

    const buildParams = {
      widthMm: msg.widthMm,
      heightMm: msg.heightMm,
      resolution: hmRaw.w,
      minT: msg.minT,
      maxT: msg.maxT,
      frameMm: msg.frameMm,
      emboss: msg.emboss,
      quality: msg.quality,
      smoothing,
      levels,
      toneZs: msg.toneHeightsMm ?? [],
      toneCuts,
      squash,
      inlay,
      vector: msg.vector !== false,
      splitZs: cuts,
    };

    // With regions on the tones are redrawn from their own outlines, so the
    // picture is traced first and what the shape is asked for depends on
    // whether the trace came back. The inlay keeps the shape's slab and gets
    // new tones on top of it; the relief is rebuilt outright, one column per
    // tone, and only needs the shape for its outline — so it is not asked to
    // terrace a surface that is about to be thrown away.
    const wantsRegions =
      buildParams.vector && levels >= 2 && (inlay !== null || (msg.toneHeightsMm?.length ?? 0) > 0);
    const pic = wantsRegions ? await tracePicture(msg.image, levels, hmRaw.w) : null;

    const shape = getShape(msg.shapeId);
    let mesh = shape.build(
      buildCtx,
      pic && !inlay ? { ...buildParams, levels: 0, toneZs: [], vector: false } : buildParams,
    );

    if (pic) {
      if (inlay) {
        mesh = buildVectorInlay(mesh, pic.lum, pic.w, pic.h, pic.tones, inlay);
      } else {
        const range = msg.maxT - msg.minT;
        const even = (band: number) => {
          const l = (band + 0.5) / levels;
          return msg.emboss === "back" ? msg.maxT - l * range : msg.minT + l * range;
        };
        const plateau = Array.from(
          { length: levels },
          (_, band) => msg.toneHeightsMm?.[band] ?? even(band),
        );
        mesh = buildVectorGraphic(
          mesh, pic.lum, pic.w, pic.h, pic.tones,
          plateau, msg.frameMm, msg.maxT,
        );
      }
    }

    const upright = msg.orientation !== "flat";

    if (inlay) {
      // The bodies are already separate — side by side, not stacked — so there
      // is nothing to cut. They only have to be gathered.
      const { banded, kept } = groupByBody(mesh, levels + 1);
      orientForPrinting(banded.positions, banded.triangleCount * 9, upright);

      const all = msg.colors ?? [];
      const file = await writeColored3MF(banded, kept.map((b) => all[b] ?? "#cccccc"));
      const preview = banded.positions.slice(0, banded.triangleCount * 9);

      const res: JobResponse = {
        id: msg.id,
        ok: true,
        file,
        extension: "3mf",
        preview: preview.buffer,
        previewTriangles: banded.triangleCount,
        previewBands: banded.bandStarts,
      };
      (self as unknown as Worker).postMessage(res, {
        transfer: [file, preview.buffer],
      });
      return;
    }

    if (cuts.length > 0) {
      // Split while the mesh is still flat: the cuts are thicknesses.
      const split = splitMeshAtLevels(mesh, cuts);
      orientForPrinting(split.positions, split.triangleCount * 9, upright);

      const file = await writeColored3MF(split, msg.colors ?? []);
      const preview = split.positions.slice(0, split.triangleCount * 9);

      const res: JobResponse = {
        id: msg.id,
        ok: true,
        file,
        extension: "3mf",
        preview: preview.buffer,
        previewTriangles: split.triangleCount,
        previewBands: split.bandStarts,
      };
      (self as unknown as Worker).postMessage(res, {
        transfer: [file, preview.buffer],
      });
      return;
    }

    orientForPrinting(mesh.positions, mesh.triangleCount * 9, upright);
    const file = writeBinarySTL(mesh);
    const preview = mesh.positions.slice(0, mesh.triangleCount * 9);

    const res: JobResponse = {
      id: msg.id,
      ok: true,
      file,
      extension: "stl",
      preview: preview.buffer,
      previewTriangles: mesh.triangleCount,
      previewBands: [0],
    };
    (self as unknown as Worker).postMessage(res, {
      transfer: [file, preview.buffer],
    });
  } catch (e: unknown) {
    const res: JobResponse = {
      id: ev.data?.id ?? -1,
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error",
    };

    (self as unknown as Worker).postMessage(res);
  }
};
