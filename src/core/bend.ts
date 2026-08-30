import { MeshBuilder, type Mesh } from "./mesh";

/**
 * Wrapping a flat model round a cylinder.
 *
 * The picture is built flat and stays that way through everything that reasons
 * about thickness — the colour bands are planes at a height, the tones are
 * solids between two heights — and is only bent at the very end, as a move of
 * every corner and nothing else. That order matters: bend first and a band cut
 * at 0.8mm would slice the model at a chord instead of following its thickness.
 *
 * The bend is about the axis the picture's own vertical runs along, so once the
 * model is stood up for printing it curves left to right, which is the way a
 * lithophane wraps round a lamp. The relief is on the outside of the curve —
 * light behind it, picture facing out.
 *
 * A move of the corners is all it is, so nothing about the mesh's soundness can
 * change: a closed surface stays closed, and two solids that met exactly still
 * meet exactly, because the same corner goes to the same place whoever owns it.
 * What it cannot do is put a bend in the middle of a triangle. A flat base is
 * one wide fan and a rim panel is one tall quad; bent by their corners alone
 * they come out as chords across the curve rather than on it. So the model is
 * cut into strips across the bend first, which changes where its triangles are
 * but not where its surface is.
 */

/** Largest gap between a chord and the arc it crosses, in millimetres. */
const CHORD_TOLERANCE_MM = 0.02;

/** Radius that wraps `widthMm` of model through `degrees` of arc. */
export function bendRadius(widthMm: number, degrees: number): number {
  const angle = (Math.abs(degrees) * Math.PI) / 180;
  if (!(angle > 1e-6) || !(widthMm > 0)) return 0;
  return widthMm / angle;
}

/** How wide a strip may be before its chord strays off the arc. */
export function stripWidth(radius: number): number {
  return Math.sqrt(8 * radius * CHORD_TOLERANCE_MM);
}

/**
 * Cuts every triangle at the planes x = k·step, keeping both sides.
 *
 * Only triangles wide enough to cross a plane are touched, so a surface that is
 * already finer than the strips comes through untouched and only the few broad
 * faces — the base, the rim — are divided. Two triangles sharing an edge are
 * cut at the same planes and so at the same points along it, which is why this
 * cannot open a seam.
 */
export function stripeX(mesh: Mesh, step: number): Mesh {
  if (!(step > 0)) return mesh;

  const { positions, triangleCount, tags } = mesh;
  const out = new MeshBuilder(triangleCount);
  if (tags) out.setTag(0);

  let poly: number[][] = [];
  let work: number[][][] = [];
  let next: number[][][] = [];
  const left: number[][] = [];
  const right: number[][] = [];

  for (let t = 0; t < triangleCount; t++) {
    const o = t * 9;
    if (tags) out.setTag(tags[t]);

    const ax = positions[o], ay = positions[o + 1], az = positions[o + 2];
    const bx = positions[o + 3], by = positions[o + 4], bz = positions[o + 5];
    const cx = positions[o + 6], cy = positions[o + 7], cz = positions[o + 8];

    const lo = Math.min(ax, bx, cx);
    const hi = Math.max(ax, bx, cx);

    const first = Math.floor(lo / step) + 1;
    const last = Math.ceil(hi / step) - 1;

    if (last < first) {
      out.addTriangle(ax, ay, az, bx, by, bz, cx, cy, cz);
      continue;
    }

    poly = [[ax, ay, az], [bx, by, bz], [cx, cy, cz]];
    work = [poly];

    for (let k = first; k <= last; k++) {
      const cut = k * step;
      next = [];

      for (const p of work) {
        left.length = 0;
        right.length = 0;

        for (let i = 0; i < p.length; i++) {
          const u = p[i];
          const v = p[(i + 1) % p.length];

          if (u[0] <= cut) left.push(u);
          if (u[0] >= cut) right.push(u);

          const straddles = (u[0] < cut && v[0] > cut) || (v[0] < cut && u[0] > cut);
          if (!straddles) continue;

          const f = (cut - u[0]) / (v[0] - u[0]);
          const m = [cut, u[1] + (v[1] - u[1]) * f, u[2] + (v[2] - u[2]) * f];
          left.push(m);
          right.push(m);
        }

        if (left.length >= 3) next.push(left.map((q) => q));
        if (right.length >= 3) next.push(right.map((q) => q));
      }

      if (next.length === 0) break;
      work = next;
    }

    // Every piece is a triangle cut by planes parallel to one another, so it is
    // convex and a fan from its first corner covers it.
    for (const p of work) {
      for (let i = 1; i + 1 < p.length; i++) {
        out.addTriangle(
          p[0][0], p[0][1], p[0][2],
          p[i][0], p[i][1], p[i][2],
          p[i + 1][0], p[i + 1][1], p[i + 1][2],
        );
      }
    }
  }

  return out.finish();
}

/**
 * Wraps the model round a cylinder of `radius`, about the y axis.
 *
 * Distance along x becomes angle, so the base keeps its length and the picture,
 * standing proud of it, is stretched round the outside of the curve. Height is
 * untouched.
 */
export function bendAroundY(
  positions: Float32Array,
  floatCount: number,
  radius: number,
): void {
  if (!(radius > 0)) return;

  for (let i = 0; i < floatCount; i += 3) {
    const x = positions[i];
    const z = positions[i + 2];

    const angle = x / radius;
    const r = radius + z;

    positions[i] = r * Math.sin(angle);
    positions[i + 2] = r * Math.cos(angle) - radius;
  }
}
