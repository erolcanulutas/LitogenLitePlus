/// <reference lib="webworker" />

import { imageToHeightmap } from "../core/heightmap";
import { writeBinarySTL } from "../core/stl_writer";
import { writeColored3MF } from "../core/3mf_writer";
import { splitMeshAtZ } from "../core/split_mesh";
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
  splitHeightMm: number;
  smoothing: number;
  levels: number;
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
    }
  | { id: number; ok: false; error: string };

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

/**
 * Shapes are generated lying flat, with z as thickness. Printing wants them
 * standing up, so rotate -90° about X: (x, y, z) -> (x, -z, y), then drop the
 * result onto the bed.
 *
 * This is a real rotation. It used to be (x, y, z) -> (-x, -z, y), which has
 * determinant -1 — a mirror. That flipped the handedness of every triangle, so
 * the generators compensated by winding their faces inward and by sampling the
 * heightmap at (1 - u). Three compensating errors that cancelled out. The
 * rotation is now proper, faces are wound outward, and the shapes sample at u.
 */
function orientForPrinting(positions: Float32Array, floatCount: number): void {
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

    const buildParams = {
      widthMm: msg.widthMm,
      resolution: hmRaw.w,
      minT: msg.minT,
      maxT: msg.maxT,
      frameMm: msg.frameMm,
      emboss: msg.emboss,
      quality: msg.quality,
      smoothing: clamp(msg.smoothing ?? 1, 0.4, 3),
      levels: msg.levels >= 2 ? Math.round(clamp(msg.levels, 2, 16)) : 0,
    };

    const shape = getShape(msg.shapeId);
    const mesh = shape.build(buildCtx, buildParams);

    // TODO: splitting is shape-agnostic now; the pentagon-only gate is a
    // leftover and should be opened up to every shape.
    const wantsSplit =
      msg.shapeId === "pentagon" &&
      msg.splitHeightMm > 0 &&
      msg.splitHeightMm < msg.maxT;

    if (wantsSplit) {
      // Split while the mesh is still flat: splitHeightMm is a thickness.
      const split = splitMeshAtZ(mesh, msg.splitHeightMm);
      orientForPrinting(split.positions, split.triangleCount * 9);

      const file = await writeColored3MF(split);
      const preview = split.positions.slice(0, split.triangleCount * 9);

      const res: JobResponse = {
        id: msg.id,
        ok: true,
        file,
        extension: "3mf",
        preview: preview.buffer,
        previewTriangles: split.triangleCount,
      };
      (self as unknown as Worker).postMessage(res, {
        transfer: [file, preview.buffer],
      });
      return;
    }

    orientForPrinting(mesh.positions, mesh.triangleCount * 9);
    const file = writeBinarySTL(mesh);
    const preview = mesh.positions.slice(0, mesh.triangleCount * 9);

    const res: JobResponse = {
      id: msg.id,
      ok: true,
      file,
      extension: "stl",
      preview: preview.buffer,
      previewTriangles: mesh.triangleCount,
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
