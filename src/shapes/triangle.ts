import type { BuildContext, ShapeBuildParams, ShapePlugin } from "../core/types";
import { MeshBuilder, type Mesh } from "../core/mesh";
import { sampleHeightBilinear } from "../core/sample";
import { triangleDensity } from "../core/quality";

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
    const { widthMm, resolution, quality } = params;

    const { subdivMul } = triangleDensity(quality);
    const N = Math.max(8, Math.floor(resolution * subdivMul));

    const side = widthMm;
    const hTri = (side * Math.sqrt(3)) / 2;
    const range = maxT - minT;

    // Centroid at the origin.
    const ax = -side / 2, ay = -hTri / 3;
    const bx = side / 2, by = -hTri / 3;
    const cx = 0, cy = (2 * hTri) / 3;

    const thicknessAt = (u: number, v: number, w: number, x: number, y: number) => {
      if (frameMm > 0 && Math.min(u, v, w) * hTri <= frameMm) return maxT;

      const uu = (x + side / 2) / side;
      const vv = ((2 * hTri) / 3 - y) / hTri;
      const lum = sampleHeightBilinear(heightmap, uu, vv);

      return emboss === "back" ? maxT - lum * range : minT + lum * range;
    };

    // top (N^2) + base fan (3N) + rim (6N)
    const mb = new MeshBuilder(N * N + 9 * N);

    // Boundary loop, counter-clockwise: A->B, B->C, C->A. Shared by the base
    // fan and the rim so both reference identical vertices.
    const edgeCount = 3 * N;
    const edgeX = new Float64Array(edgeCount);
    const edgeY = new Float64Array(edgeCount);
    const edgeZ = new Float64Array(edgeCount);

    let prev = new Float64Array((N + 1) * 3);
    let cur = new Float64Array((N + 1) * 3);

    const fillRow = (r: number, out: Float64Array) => {
      const w = r / N;
      const cols = N - r;
      for (let c = 0; c <= cols; c++) {
        const v = c / N;
        const u = 1 - w - v;
        const x = u * ax + v * bx + w * cx;
        const y = u * ay + v * by + w * cy;
        const o = c * 3;
        out[o] = x;
        out[o + 1] = y;
        out[o + 2] = thicknessAt(u, v, w, x, y);
      }
    };

    const recordBoundary = (r: number, row: Float64Array) => {
      const cols = N - r;

      if (r === 0) {
        for (let c = 0; c < N; c++) {
          const o = c * 3;
          edgeX[c] = row[o];
          edgeY[c] = row[o + 1];
          edgeZ[c] = row[o + 2];
        }
      }
      if (r < N) {
        // B -> C edge, at column N - r.
        const o = cols * 3;
        const i = N + r;
        edgeX[i] = row[o];
        edgeY[i] = row[o + 1];
        edgeZ[i] = row[o + 2];
      }
      if (r >= 1) {
        // C -> A edge, at column 0, walked from C back down to A.
        const i = 3 * N - r;
        edgeX[i] = row[0];
        edgeY[i] = row[1];
        edgeZ[i] = row[2];
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
        const o0 = c * 3;
        const o1 = (c + 1) * 3;

        // t00 -> t10 -> t01 faces +Z.
        mb.addTriangle(
          prev[o0], prev[o0 + 1], prev[o0 + 2],
          prev[o1], prev[o1 + 1], prev[o1 + 2],
          cur[o0], cur[o0 + 1], cur[o0 + 2],
        );

        if (c + 1 < cols) {
          mb.addTriangle(
            prev[o1], prev[o1 + 1], prev[o1 + 2],
            cur[o1], cur[o1 + 1], cur[o1 + 2],
            cur[o0], cur[o0 + 1], cur[o0 + 2],
          );
        }
      }

      const swap = prev;
      prev = cur;
      cur = swap;
    }

    // --- flat base, one fan from the centroid ------------------------------
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
      mb.addQuad(
        edgeX[i], edgeY[i], edgeZ[i],
        edgeX[i], edgeY[i], 0,
        edgeX[j], edgeY[j], 0,
        edgeX[j], edgeY[j], edgeZ[j],
      );
    }

    return mb.finish();
  },
};
