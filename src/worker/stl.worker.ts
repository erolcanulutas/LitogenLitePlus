/// <reference lib="webworker" />

import { imageToHeightmap } from "../core/heightmap";
import { writeBinarySTL } from "../core/stl_writer";
import { writeColored3MF } from "../core/3mf_writer";
import type { ColoredTri } from "../core/3mf_writer";
import type { EmbossSide, Tri, Vec3 } from "../core/types";
import { getShape } from "../shapes";
import type { Quality } from "../core/quality";
import { makeLithophaneColoredTriangles } from "../core/split_mesh";

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
};

type JobResponse =
  | { id: number; ok: true; file: ArrayBuffer; extension: "stl" | "3mf" }
  | { id: number; ok: false; error: string };

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function rotateTrisVertical(tris: Tri[]): Tri[] {
  let minZ = Infinity;

  const out: Tri[] = tris.map((tri) =>
    tri.map((v) => {
      let x = v[0];
      let y = v[2];
      const z = v[1];

      x = -x;
      y = -y;

      const nv: Vec3 = [x, y, z];
      minZ = Math.min(minZ, z);
      return nv;
    }) as Tri
  );

  if (isFinite(minZ) && minZ !== 0) {
    for (const tri of out) {
      for (const v of tri) {
        v[2] -= minZ;
      }
    }
  }

  return out;
}

function rotateColoredTrisVertical(items: ColoredTri[]): ColoredTri[] {
  const rawTris = items.map((item) => item.tri);
  const rotatedTris = rotateTrisVertical(rawTris);

  return items.map((item, i) => ({
    materialIndex: item.materialIndex,
    tri: rotatedTris[i],
  }));
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
      1200
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
    };

    const shape = getShape(msg.shapeId);
    const trisRaw = shape.build(buildCtx, buildParams);

    if (
      msg.shapeId === "pentagon" &&
      msg.splitHeightMm > 0 &&
      msg.splitHeightMm < msg.maxT
    ) {
      const coloredRaw = makeLithophaneColoredTriangles(
        trisRaw,
        msg.splitHeightMm,
        msg.maxT
      );

      const coloredRotated = rotateColoredTrisVertical(coloredRaw);
      const file = await writeColored3MF(coloredRotated);

      const res: JobResponse = {
        id: msg.id,
        ok: true,
        file,
        extension: "3mf",
      };

      (self as any).postMessage(res, { transfer: [file] });
      return;
    }

    const tris = rotateTrisVertical(trisRaw);
    const file = writeBinarySTL(tris);

    const res: JobResponse = {
      id: msg.id,
      ok: true,
      file,
      extension: "stl",
    };

    (self as any).postMessage(res, { transfer: [file] });
  } catch (e: any) {
    const res: JobResponse = {
      id: (ev.data && (ev.data as any).id) ?? -1,
      ok: false,
      error: e?.message ? String(e.message) : "Unknown error",
    };

    (self as any).postMessage(res);
  }
};