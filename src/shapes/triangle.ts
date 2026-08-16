import type {
  BuildContext,
  ShapeBuildParams,
  ShapePlugin,
  Tri,
  Vec3,
} from "../core/types";
import { sampleHeightBilinear } from "../core/sample";
import { qualityParams } from "../core/quality";

/* -------------------------------------------------
 * Helpers
 * ------------------------------------------------- */

function addTri(tris: Tri[], a: Vec3, b: Vec3, c: Vec3) {
  tris.push([a, b, c]);
}

/* -------------------------------------------------
 * Triangle shape plugin
 * ------------------------------------------------- */

export const TriangleShape: ShapePlugin = {
  id: "triangle",
  label: "Triangle (equilateral)",
  cropRatio: 2.0 / Math.sqrt(3),

  build: (ctx: BuildContext, params: ShapeBuildParams): Tri[] => {
    const { heightmap, minT, maxT, frameMm, emboss } = ctx;
    const { widthMm, resolution, quality } = params;

    /* ---------------------------------------------
     * TRIANGLE-ONLY QUALITY REMAP
     *
     * draft  -> custom low
     * normal -> OLD draft
     * high   -> OLD normal
     * OLD high is NEVER used
     * --------------------------------------------- */

    let q;
    if (quality === "draft") {
      // brand new ultra-light triangle draft
      q = {
        angMul: 0.45,
        radial: 60,
        ringAngMax: 0, // unused for triangle
      };
    } else if (quality === "normal") {
      // normal = OLD draft
      q = qualityParams("draft");
    } else {
      // high = OLD normal
      q = qualityParams("normal");
    }

    const tris: Tri[] = [];

    const side = widthMm;
    const hTri = (side * Math.sqrt(3)) / 2;
    const range = maxT - minT;

    // Triangle vertices (centroid at origin)
    const A: [number, number] = [-side / 2, -hTri / 3];
    const B: [number, number] = [side / 2, -hTri / 3];
    const C: [number, number] = [0, (2 * hTri) / 3];

    function thicknessAt(u: number, v: number, w: number): number {
      const distToEdge = Math.min(u, v, w) * hTri;

      if (frameMm > 0 && distToEdge <= frameMm) {
        return maxT;
      }

      const x = u * A[0] + v * B[0] + w * C[0];
      const y = u * A[1] + v * B[1] + w * C[1];

      const uu = (x + side / 2) / side;
      const vv = ((2 * hTri) / 3 - y) / hTri;

      const lum = sampleHeightBilinear(heightmap, 1 - uu, vv);

      return emboss === "back"
        ? maxT - lum * range
        : minT + lum * range;
    }

    // subdivision count
    const N = Math.max(8, Math.floor(resolution * q.angMul));

    const topVerts: Vec3[][] = [];
    const botVerts: Vec3[][] = [];

    for (let r = 0; r <= N; r++) {
      const rowTop: Vec3[] = [];
      const rowBot: Vec3[] = [];

      const w = r / N;
      const count = N - r;

      for (let c = 0; c <= count; c++) {
        const v = c / N;
        const u = 1 - w - v;

        const x = u * A[0] + v * B[0] + w * C[0];
        const y = u * A[1] + v * B[1] + w * C[1];
        const z = thicknessAt(u, v, w);

        rowTop.push([x, y, z]);
        rowBot.push([x, y, 0]);
      }

      topVerts.push(rowTop);
      botVerts.push(rowBot);
    }

    // top & bottom
    for (let r = 0; r < N; r++) {
      const cols = N - r;

      for (let c = 0; c < cols; c++) {
        const t00 = topVerts[r][c];
        const t10 = topVerts[r][c + 1];
        const t01 = topVerts[r + 1][c];

        addTri(tris, t00, t01, t10);

        if (c + 1 < topVerts[r + 1].length) {
          addTri(tris, t10, t01, topVerts[r + 1][c + 1]);
        }

        const b00 = botVerts[r][c];
        const b10 = botVerts[r][c + 1];
        const b01 = botVerts[r + 1][c];

        addTri(tris, b00, b10, b01);

        if (c + 1 < botVerts[r + 1].length) {
          addTri(tris, b10, botVerts[r + 1][c + 1], b01);
        }
      }
    }

    // walls
    for (let c = 0; c < N; c++) {
      addTri(tris, topVerts[0][c], botVerts[0][c], botVerts[0][c + 1]);
      addTri(tris, topVerts[0][c], botVerts[0][c + 1], topVerts[0][c + 1]);
    }

    for (let r = 0; r < N; r++) {
      addTri(tris, topVerts[r][0], botVerts[r][0], botVerts[r + 1][0]);
      addTri(tris, topVerts[r][0], botVerts[r + 1][0], topVerts[r + 1][0]);
    }

    for (let r = 0; r < N; r++) {
      const c0 = N - r;
      const c1 = N - r - 1;

      addTri(tris, topVerts[r][c0], botVerts[r][c0], botVerts[r + 1][c1]);
      addTri(tris, topVerts[r][c0], botVerts[r + 1][c1], topVerts[r + 1][c1]);
    }

    return tris;
  },
};
