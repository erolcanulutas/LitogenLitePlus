import { BASE_BODY, emitInlayRim, emitInlayTriangle } from "../core/inlay";
import { squashLum } from "../core/squash";
import type { BuildContext, ShapeBuildParams, ShapePlugin } from "../core/types";
import { MeshBuilder, type Mesh } from "../core/mesh";
import { buildAreaSampler, sampleHeightFiltered } from "../core/sample";
import { bandCuts, bandOfLum, emitTerracedTriangle } from "../core/terrace";
import { emitWallColumn } from "../core/wall";
import { triangleCellMm } from "../core/quality";

/** Matches the ceiling in core/radial.ts: N^2 triangles must stay bounded. */
const MAX_SUBDIVISIONS = 2000;

/** Stride of the row buffers: x, y, z, brightness. */
const STRIDE = 4;

/**
 * Equilateral triangle, built on a barycentric grid.
 *
 * Unlike the ring-based shapes this one subdivides in two directions at once,
 * so it keeps its own generator. The flat underside is still just one fan from
 * the centroid, and the rim is stitched from the same boundary vertices the
 * fan uses, so the two always agree.
 */
export const TriangleShape: ShapePlugin = {
  id: "triangle",
  label: "Triangle (equilateral)",
  cropRatio: 2.0 / Math.sqrt(3),

  build: (ctx: BuildContext, params: ShapeBuildParams): Mesh => {
    const { heightmap, minT, maxT, frameMm, emboss } = ctx;
    const { widthMm, quality, smoothing, levels, splitZs, toneZs, toneCuts, squash, inlay } = params;

    const N = Math.min(
      MAX_SUBDIVISIONS,
      Math.max(8, Math.round(widthMm / triangleCellMm(quality))),
    );

    const side = widthMm;
    const hTri = (side * Math.sqrt(3)) / 2;
    const range = maxT - minT;

    // Centroid at the origin.
    const ax = -side / 2, ay = -hTri / 3;
    const bx = side / 2, by = -hTri / 3;
    const cx = 0, cy = (2 * hTri) / 3;

    const sampler = buildAreaSampler(heightmap);
    // The barycentric grid steps by side/N in both directions, so every vertex
    // stands in for a cell that wide. Filter over it instead of point sampling.
    const footprintPx = smoothing * (side / N) * (heightmap.w / side);

    const terraced = levels >= 2;
    const inlaid = inlay != null && terraced;
    const cuts = bandCuts(levels, toneCuts);
    const heightOf = (lum: number) =>
      emboss === "back" ? maxT - lum * range : minT + lum * range;
    // Whatever the panel set for this tone, or evenly spaced if it has not
    // been touched. Either way it must not increase with the band index, or
    // the terrace walls come out facing the wrong way.
    const bandHeight = (band: number) =>
      toneZs[band] ?? heightOf((band + 0.5) / levels);
    const heightForLum = (l: number) =>
      inlaid
        ? inlay!.topZ
        : terraced
          ? bandHeight(bandOfLum(l, cuts))
          : heightOf(l);

    // Brightness everywhere, with no frame mask on it, so the terracing can
    // solve for where a contour actually runs. See core/terrace.ts.
    const field = terraced
      ? (x: number, y: number) => {
          const uu = (x + side / 2) / side;
          const vv = ((2 * hTri) / 3 - y) / hTri;
          return squashLum(
            squash,
            uu,
            vv,
            sampleHeightFiltered(sampler, uu, vv, footprintPx),
            cuts,
          );
        }
      : undefined;

    /** Brightness at a grid point, or -1 inside the flat frame band. */
    const lumAt = (u: number, v: number, w: number, x: number, y: number) => {
      if (!inlay && frameMm > 0 && Math.min(u, v, w) * hTri <= frameMm) return -1;

      const uu = (x + side / 2) / side;
      const vv = ((2 * hTri) / 3 - y) / hTri;
      return squashLum(
        squash,
        uu,
        vv,
        sampleHeightFiltered(sampler, uu, vv, footprintPx),
        cuts,
      );
    };

    // top (N^2) + base fan (3N) + rim (6N), with headroom for terrace cuts.
    const base = N * N + 9 * N;
    const mb = new MeshBuilder(terraced ? Math.round(base * 1.4) : base);

    const emitSurface = (
      x0: number, y0: number, z0: number, l0: number,
      x1: number, y1: number, z1: number, l1: number,
      x2: number, y2: number, z2: number, l2: number,
    ) => {
      if (inlaid && l0 >= 0 && l1 >= 0 && l2 >= 0) {
        emitInlayTriangle(mb, x0, y0, l0, x1, y1, l1, x2, y2, l2, cuts, inlay!, field);
      } else if (terraced && l0 >= 0 && l1 >= 0 && l2 >= 0) {
        emitTerracedTriangle(mb, x0, y0, l0, x1, y1, l1, x2, y2, l2, cuts, bandHeight, field);
      } else {
        mb.addTriangle(x0, y0, z0, x1, y1, z1, x2, y2, z2);
      }
    };

    // Boundary loop, counter-clockwise: A->B, B->C, C->A. Shared by the base
    // fan and the rim so both reference identical vertices.
    const edgeCount = 3 * N;
    const edgeX = new Float64Array(edgeCount);
    const edgeY = new Float64Array(edgeCount);
    const edgeZ = new Float64Array(edgeCount);
    const edgeL = new Float64Array(edgeCount);

    let prev = new Float64Array((N + 1) * STRIDE);
    let cur = new Float64Array((N + 1) * STRIDE);

    const fillRow = (r: number, out: Float64Array) => {
      const w = r / N;
      const cols = N - r;
      for (let c = 0; c <= cols; c++) {
        const v = c / N;
        const u = 1 - w - v;
        const x = u * ax + v * bx + w * cx;
        const y = u * ay + v * by + w * cy;
        const o = c * STRIDE;
        const lum = lumAt(u, v, w, x, y);
        out[o] = x;
        out[o + 1] = y;
        out[o + 2] = lum < 0 ? maxT : heightForLum(lum);
        out[o + 3] = lum;
      }
    };

    const recordBoundary = (r: number, row: Float64Array) => {
      const cols = N - r;

      if (r === 0) {
        for (let c = 0; c < N; c++) {
          const o = c * STRIDE;
          edgeX[c] = row[o];
          edgeY[c] = row[o + 1];
          edgeZ[c] = row[o + 2];
          edgeL[c] = row[o + 3];
          edgeL[c] = row[o + 3];
        }
      }
      if (r < N) {
        const o = cols * STRIDE;
        const i = N + r;
        edgeX[i] = row[o];
        edgeY[i] = row[o + 1];
        edgeZ[i] = row[o + 2];
        edgeL[i] = row[o + 3];
        edgeL[i] = row[o + 3];
      }
      if (r >= 1) {
        const i = 3 * N - r;
        edgeX[i] = row[0];
        edgeY[i] = row[1];
        edgeZ[i] = row[2];
        edgeL[i] = row[3];
      }
    };

    fillRow(0, prev);
    recordBoundary(0, prev);

    // --- top surface -------------------------------------------------------
    for (let r = 0; r < N; r++) {
      fillRow(r + 1, cur);
      recordBoundary(r + 1, cur);

      const cols = N - r;
      for (let c = 0; c < cols; c++) {
        const o0 = c * STRIDE;
        const o1 = (c + 1) * STRIDE;

        // t00 -> t10 -> t01 faces +Z.
        emitSurface(
          prev[o0], prev[o0 + 1], prev[o0 + 2], prev[o0 + 3],
          prev[o1], prev[o1 + 1], prev[o1 + 2], prev[o1 + 3],
          cur[o0], cur[o0 + 1], cur[o0 + 2], cur[o0 + 3],
        );

        if (c + 1 < cols) {
          emitSurface(
            prev[o1], prev[o1 + 1], prev[o1 + 2], prev[o1 + 3],
            cur[o1], cur[o1 + 1], cur[o1 + 2], cur[o1 + 3],
            cur[o0], cur[o0 + 1], cur[o0 + 2], cur[o0 + 3],
          );
        }
      }

      const swap = prev;
      prev = cur;
      cur = swap;
    }

    // --- flat base, one fan from the centroid ------------------------------
    if (inlaid) mb.setTag(BASE_BODY);
    for (let i = 0; i < edgeCount; i++) {
      const j = (i + 1) % edgeCount;
      mb.addTriangle(
        0, 0, 0,
        edgeX[j], edgeY[j], 0,
        edgeX[i], edgeY[i], 0,
      );
    }

    // --- rim ---------------------------------------------------------------
    for (let i = 0; i < edgeCount; i++) {
      const j = (i + 1) % edgeCount;
      if (inlaid) {
        emitInlayRim(
          mb,
          edgeX[i], edgeY[i], edgeL[i],
          edgeX[j], edgeY[j], edgeL[j],
          cuts, inlay!, field,
        );
        continue;
      }

      emitWallColumn(
        mb,
        edgeX[i], edgeY[i], edgeZ[i],
        edgeX[j], edgeY[j], edgeZ[j],
        splitZs,
      );
    }

    return mb.finish();
  },
};
