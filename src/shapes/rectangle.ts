import {
  BASE_BODY,
  emitInlayRim,
  emitInlayRimByTone,
  emitInlayTriangle,
  emitInlayTriangleByTone,
} from "../core/inlay";
import { squashLum } from "../core/squash";
import type { BuildContext, ShapeBuildParams, ShapePlugin } from "../core/types";
import { MeshBuilder, type Mesh } from "../core/mesh";
import { buildAreaSampler, sampleHeightFiltered } from "../core/sample";
import { bandCuts, bandOfLum, emitTerracedTriangle } from "../core/terrace";
import { emitWallColumn } from "../core/wall";
import { gridCellMm } from "../core/quality";

/** Matches the ceilings in core/radial.ts and shapes/triangle.ts. */
const MAX_TRIANGLES = 4_000_000;

/** Stride of the row buffers: x, y, z, brightness. */
const STRIDE = 4;

/**
 * Rectangle, built on a plain grid.
 *
 * The only shape whose proportions are not fixed. The others derive a height
 * from `widthMm` and their own geometry; this one is handed both, because the
 * editor's crop box is what sets them.
 *
 * The frame is handled the way the triangle handles it — grid points within
 * `frameMm` of an edge are held at full thickness — rather than the way the
 * radial shapes do, with a ring placed exactly on the boundary. That puts the
 * band's inner edge within one cell of where it belongs, which at these cell
 * sizes is a fraction of a nozzle width.
 */
export const RectangleShape: ShapePlugin = {
  id: "rectangle",
  label: "Rectangle",
  // A starting point only: freeRatio means the editor may drag it anywhere.
  cropRatio: 1.5,
  freeRatio: true,

  build: (ctx: BuildContext, params: ShapeBuildParams): Mesh => {
    const { heightmap, minT, maxT, frameMm, emboss } = ctx;
    const {
      widthMm, heightMm, quality, smoothing, levels, splitZs, toneZs, toneCuts, squash, inlay, vector,
    } = params;

    const W = Math.max(1, widthMm);
    const H = Math.max(1, heightMm);
    const range = maxT - minT;

    // Cell size is absolute, so cost grows with print area. Relax it rather
    // than let a large panel ask for a mesh that exhausts memory.
    let cell = gridCellMm(quality);
    const estimated = 2 * (W / cell) * (H / cell);
    if (estimated > MAX_TRIANGLES) cell *= Math.sqrt(estimated / MAX_TRIANGLES);

    const nx = Math.max(4, Math.round(W / cell));
    const ny = Math.max(4, Math.round(H / cell));

    const x0 = -W / 2;
    const y0 = -H / 2;
    const dx = W / nx;
    const dy = H / ny;

    const sampler = buildAreaSampler(heightmap);

    /**
     * Which tone a point is, as a number.
     *
     * Read off the same field the surface is built from, so the tone and the
     * boundary between tones agree. Taking it from a map of pixels instead
     * puts the two at odds — the map steps along the grid while the boundary
     * is solved against the field — and the edge comes out ragged where they
     * disagree.
     */
    const toneAt = (x: number, y: number): number => {
      const uu = (x - x0) / W;
      const vv = 1 - (y - y0) / H;
      const l = squashLum(
        squash,
        uu,
        vv,
        sampleHeightFiltered(sampler, uu, vv, footprintPx),
        cuts,
      );
      return bandOfLum(l, cuts);
    };
    const pxPerMm = heightmap.w / W;
    // Each vertex stands in for a cell this wide; filter over it rather than
    // point sampling, so detail finer than the mesh averages in.
    const footprintPx = smoothing * Math.max(dx, dy) * pxPerMm;

    const terraced = levels >= 2;
    const inlaid = inlay != null && terraced;
    const useTone = vector && terraced;
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
          const u = (x - x0) / W;
          const v = 1 - (y - y0) / H;
          return squashLum(
            squash,
            u,
            v,
            sampleHeightFiltered(sampler, u, v, footprintPx),
            cuts,
          );
        }
      : undefined;

    const inset = inlay ? 0 : Math.max(0, frameMm);

    /** Brightness at a grid point, or -1 where the flat frame band covers it. */
    const lumAt = (x: number, y: number): number => {
      if (
        inset > 0 &&
        (x <= x0 + inset ||
          x >= -x0 - inset ||
          y <= y0 + inset ||
          y >= -y0 - inset)
      ) {
        return -1;
      }
      const u = (x - x0) / W;
      const v = 1 - (y - y0) / H;
      return squashLum(
        squash,
        u,
        v,
        sampleHeightFiltered(sampler, u, v, footprintPx),
        cuts,
      );
    };

    const edgeCount = 2 * (nx + ny);
    // top (2 per cell) + base fan + rim (2 per column), with terrace headroom.
    const budget = 2 * nx * ny + 3 * edgeCount;
    const mb = new MeshBuilder(terraced ? Math.round(budget * 1.4) : budget);

    const emitSurface = (
      ax: number, ay: number, az: number, al: number,
      bx: number, by: number, bz: number, bl: number,
      cx: number, cy: number, cz: number, cl: number,
    ) => {
      if (inlaid && al >= 0 && bl >= 0 && cl >= 0) {
        if (useTone) {
          emitInlayTriangleByTone(
            mb,
            ax, ay, al, toneAt(ax, ay),
            bx, by, bl, toneAt(bx, by),
            cx, cy, cl, toneAt(cx, cy),
            cuts, inlay!, field,
          );
        } else {
          emitInlayTriangle(mb, ax, ay, al, bx, by, bl, cx, cy, cl, cuts, inlay!, field);
        }
      } else if (terraced && al >= 0 && bl >= 0 && cl >= 0) {
        emitTerracedTriangle(mb, ax, ay, al, bx, by, bl, cx, cy, cl, cuts, bandHeight, field);
      } else {
        mb.addTriangle(ax, ay, az, bx, by, bz, cx, cy, cz);
      }
    };

    // Boundary loop, counter-clockwise, in four runs: bottom, right, top,
    // left. The base fan and the rim both read it, so they cannot disagree
    // about where the edge is.
    const edgeX = new Float64Array(edgeCount);
    const edgeY = new Float64Array(edgeCount);
    const edgeZ = new Float64Array(edgeCount);
    const edgeL = new Float64Array(edgeCount);

    const cols = nx + 1;
    let prev = new Float64Array(cols * STRIDE);
    let cur = new Float64Array(cols * STRIDE);

    const fillRow = (j: number, out: Float64Array) => {
      const y = y0 + j * dy;
      for (let i = 0; i <= nx; i++) {
        const x = x0 + i * dx;
        const o = i * STRIDE;
        const lum = lumAt(x, y);
        out[o] = x;
        out[o + 1] = y;
        out[o + 2] = lum < 0 ? maxT : heightForLum(lum);
        out[o + 3] = lum;
      }
    };

    const put = (k: number, row: Float64Array, i: number) => {
      const o = i * STRIDE;
      edgeX[k] = row[o];
      edgeY[k] = row[o + 1];
      edgeZ[k] = row[o + 2];
      edgeL[k] = row[o + 3];
      edgeL[k] = row[o + 3];
    };

    const recordRow = (j: number, row: Float64Array) => {
      if (j === 0) for (let i = 0; i < nx; i++) put(i, row, i);
      if (j < ny) put(nx + j, row, nx);
      if (j === ny) for (let i = 0; i < nx; i++) put(nx + ny + i, row, nx - i);
      if (j >= 1) put(2 * nx + ny + (ny - j), row, 0);
    };

    fillRow(0, prev);
    recordRow(0, prev);

    // --- top surface ---------------------------------------------------------
    for (let j = 0; j < ny; j++) {
      fillRow(j + 1, cur);
      recordRow(j + 1, cur);

      for (let i = 0; i < nx; i++) {
        const a = i * STRIDE;
        const b = (i + 1) * STRIDE;

        // Both wound to face +Z.
        emitSurface(
          prev[a], prev[a + 1], prev[a + 2], prev[a + 3],
          prev[b], prev[b + 1], prev[b + 2], prev[b + 3],
          cur[b], cur[b + 1], cur[b + 2], cur[b + 3],
        );
        emitSurface(
          prev[a], prev[a + 1], prev[a + 2], prev[a + 3],
          cur[b], cur[b + 1], cur[b + 2], cur[b + 3],
          cur[a], cur[a + 1], cur[a + 2], cur[a + 3],
        );
      }

      const swap = prev;
      prev = cur;
      cur = swap;
    }

    // --- flat base, one fan from the centre ----------------------------------
    if (inlaid) mb.setTag(BASE_BODY);
    for (let i = 0; i < edgeCount; i++) {
      const j = (i + 1) % edgeCount;
      mb.addTriangle(0, 0, 0, edgeX[j], edgeY[j], 0, edgeX[i], edgeY[i], 0);
    }

    // --- rim -----------------------------------------------------------------
    for (let i = 0; i < edgeCount; i++) {
      const j = (i + 1) % edgeCount;
      if (inlaid) {
        if (useTone) {
          emitInlayRimByTone(
            mb,
            edgeX[i], edgeY[i], edgeL[i], toneAt(edgeX[i], edgeY[i]),
            edgeX[j], edgeY[j], edgeL[j], toneAt(edgeX[j], edgeY[j]),
            cuts, inlay!, field,
          );
        } else {
          emitInlayRim(mb, edgeX[i], edgeY[i], edgeL[i], edgeX[j], edgeY[j], edgeL[j], cuts, inlay!, field);
        }
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
