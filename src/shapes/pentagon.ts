// src/shapes/pentagon.ts
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

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

/**
 * Regular pentagon (flat-bottom).
 *
 * IMPORTANT:
 * For this shape:
 *   params.widthMm is treated as "max vertex-to-vertex distance" (diameter) = 2R
 *   (same idea as "en uzak iki köşe" / circumcircle diameter)
 *
 * Flat-bottom orientation:
 *   rotate vertex-up by +36° => one edge becomes horizontal at bottom.
 *
 * BBox:
 *   bboxWidth  = 2 cos(18°) R
 *   bboxHeight = (1 + cos(36°)) R
 *
 * cropRatio = bboxWidth / bboxHeight = 2cos18 / (1+cos36)
 *
 * To match editor EXACTLY:
 *   - We bbox-center the pentagon coordinates (subtract bbox midpoints),
 *     same as ImageEditor drawShape() does.
 *   - UV mapping uses bbox-centered coords:
 *       x in [-bboxW/2 .. +bboxW/2]
 *       y in [-bboxH/2 .. +bboxH/2]
 */
export const PentagonShape: ShapePlugin = {
  id: "pentagon",
  label: "Pentagon",
  cropRatio: (2 * Math.cos(Math.PI / 10)) / (1 + Math.cos(Math.PI / 5)),

  build: (ctx: BuildContext, params: ShapeBuildParams): Tri[] => {
    const { heightmap, minT, maxT, frameMm, emboss } = ctx;
    const { widthMm: diameterMm, resolution, quality } = params;

    const q = qualityParams(quality);
    const tris: Tri[] = [];
    const range = maxT - minT;

    const SEGMENTS = 5;

    // angles
    const cos18 = Math.cos(Math.PI / 10);
    const cos36 = Math.cos(Math.PI / 5);

    /* -------------------------------------------------
     * Geometry setup
     * ------------------------------------------------- */

	const d = Math.max(0.01, diameterMm);

	// Interpret widthMm as bbox width (left-to-right), not vertex-to-vertex
	// bboxW = 2*cos18*R  =>  R = bboxW / (2*cos18)
	const R = d / (2 * cos18);


    // bbox dimensions for flat-bottom pentagon
    const bboxW = 2 * cos18 * R;
    const bboxH = (1 + cos36) * R;

    // apothem for frame handling (center-to-side)
    const apothem = R * cos36;

    const frameSize = Math.max(0, frameMm);
    const innerApothem = apothem - frameSize;
    const hasFrame = frameSize > 0.001 && innerApothem > 0.0001;
    const imageFraction = hasFrame ? innerApothem / apothem : 1; // 0..1

    /* -------------------------------------------------
     * Build outer vertices (flat-bottom) and bbox-center them
     * ------------------------------------------------- */

    // flat-bottom orientation = vertex-up rotated by +36°
    const rot = Math.PI / 5; // 36°
    const theta0 = -Math.PI / 2 + rot;

    const outerRaw: { x: number; y: number }[] = [];
    for (let k = 0; k < SEGMENTS; k++) {
      const theta = theta0 + (k * 2 * Math.PI) / SEGMENTS;
      outerRaw.push({ x: Math.cos(theta) * R, y: Math.sin(theta) * R });
    }

    // bbox-center (match editor)
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const p of outerRaw) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const offX = (minX + maxX) / 2;
    const offY = (minY + maxY) / 2;

    const outer: { x: number; y: number }[] = outerRaw.map((p) => ({
      x: p.x - offX,
      y: p.y - offY,
    }));

    /* -------------------------------------------------
     * Sampling helper (bbox-centered UV)
     * ------------------------------------------------- */
    function getHeightAt(x: number, y: number, isFrame: boolean): number {
      if (isFrame) return maxT;

      const u = (x + bboxW / 2) / bboxW;
      const v = 1 - (y + bboxH / 2) / bboxH;

      const finalU = clamp(1 - u, 0, 1);
      const finalV = clamp(v, 0, 1);

      const lum = sampleHeightBilinear(heightmap, finalU, finalV);

      return emboss === "back" ? maxT - lum * range : minT + lum * range;
    }

    /* -------------------------------------------------
     * Mesh generation (radial topology)
     * ------------------------------------------------- */

    const RADIAL_STEPS = Math.max(10, Math.floor(q.radial * 0.8));
    const STEPS_PER_SEGMENT = Math.max(
      4,
      Math.floor((resolution * q.angMul) / SEGMENTS)
    );

    const layers: Vec3[][] = [];

    const splitIndex = Math.floor(RADIAL_STEPS * imageFraction);
    const totalRings = RADIAL_STEPS;

    for (let r = 0; r <= totalRings; r++) {
      const row: Vec3[] = [];

      let t_radius: number;

      if (hasFrame) {
        if (r <= splitIndex) {
          t_radius = splitIndex === 0 ? 0 : (r / splitIndex) * imageFraction;
        } else {
          const frameSteps = totalRings - splitIndex;
          const fr = r - splitIndex;
          t_radius = imageFraction + (fr / frameSteps) * (1 - imageFraction);
        }
      } else {
        t_radius = r / totalRings;
      }

      const isRingFrame = hasFrame && r > splitIndex;

      for (let sIdx = 0; sIdx < SEGMENTS; sIdx++) {
        const p1 = outer[sIdx];
        const p2 = outer[(sIdx + 1) % SEGMENTS];

        for (let i = 0; i < STEPS_PER_SEGMENT; i++) {
          const edgeT = i / STEPS_PER_SEGMENT;

          const edgeX = p1.x + (p2.x - p1.x) * edgeT;
          const edgeY = p1.y + (p2.y - p1.y) * edgeT;

          const x = edgeX * t_radius;
          const y = edgeY * t_radius;

          const z = getHeightAt(x, y, isRingFrame);
          row.push([x, y, z]);
        }
      }

      layers.push(row);
    }

    /* -------------------------------------------------
     * Stitch triangles
     * ------------------------------------------------- */
    const vertsPerRow = SEGMENTS * STEPS_PER_SEGMENT;

    for (let r = 0; r < totalRings; r++) {
      for (let i = 0; i < vertsPerRow; i++) {
        const nextI = (i + 1) % vertsPerRow;

        const t0 = layers[r][i];
        const t1 = layers[r][nextI];
        const b0 = layers[r + 1][i];
        const b1 = layers[r + 1][nextI];

        addTri(tris, t0, b0, b1);
        addTri(tris, t0, b1, t1);

        const t0b: Vec3 = [t0[0], t0[1], 0];
        const t1b: Vec3 = [t1[0], t1[1], 0];
        const b0b: Vec3 = [b0[0], b0[1], 0];
        const b1b: Vec3 = [b1[0], b1[1], 0];

        addTri(tris, t0b, b1b, b0b);
        addTri(tris, t0b, t1b, b1b);
      }
    }

    /* -------------------------------------------------
     * Outer wall
     * ------------------------------------------------- */
    const lastRow = layers[layers.length - 1];
    for (let i = 0; i < vertsPerRow; i++) {
      const nextI = (i + 1) % vertsPerRow;

      const topA = lastRow[i];
      const topB = lastRow[nextI];

      const botA: Vec3 = [topA[0], topA[1], 0];
      const botB: Vec3 = [topB[0], topB[1], 0];

      addTri(tris, topA, botB, botA);
      addTri(tris, topA, topB, botB);
    }

    return tris;
  },
};


export function buildPentagonSplit3MFParts(
  ctx: BuildContext,
  params: ShapeBuildParams,
  splitZ: number
): { base: Tri[]; highlight: Tri[] } {
  const full = PentagonShape.build(ctx, params);

  const base: Tri[] = [];
  const highlight: Tri[] = [];

  function clone(v: Vec3): Vec3 {
    return [v[0], v[1], v[2]];
  }

  function areaOk(a: Vec3, b: Vec3, c: Vec3) {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];

    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];

    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;

    return Math.hypot(nx, ny, nz) > 1e-7;
  }

  function addValid(target: Tri[], a: Vec3, b: Vec3, c: Vec3) {
    if (areaOk(a, b, c)) target.push([a, b, c]);
  }

  for (const tri of full) {
    const a = clone(tri[0]);
    const b = clone(tri[1]);
    const c = clone(tri[2]);

    const ab: Vec3 = [a[0], a[1], Math.min(a[2], splitZ)];
    const bb: Vec3 = [b[0], b[1], Math.min(b[2], splitZ)];
    const cb: Vec3 = [c[0], c[1], Math.min(c[2], splitZ)];

    addValid(base, ab, bb, cb);

    const maxZ = Math.max(a[2], b[2], c[2]);

    if (maxZ > splitZ + 1e-7) {
      const ah: Vec3 = [a[0], a[1], Math.max(a[2], splitZ)];
      const bh: Vec3 = [b[0], b[1], Math.max(b[2], splitZ)];
      const ch: Vec3 = [c[0], c[1], Math.max(c[2], splitZ)];

      addValid(highlight, ah, bh, ch);
    }
  }

  return { base, highlight };
}