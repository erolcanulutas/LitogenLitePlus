import type { MeshBuilder } from "./mesh";
import { earcut } from "./triangulate";

/**
 * Small convex solids, built face by face.
 *
 * The holder and the stand are made of prisms, frusta and pockets. Everything
 * here is convex in cross-section, which is what lets a wall decide which way
 * it faces from one point: the middle of the loop it runs along. A wall of a
 * pocket faces that point, the wall of a body faces away from it.
 */

export type V3 = [number, number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function centroid(...loops: V3[][]): V3 {
  let x = 0, y = 0, z = 0, n = 0;
  for (const l of loops) {
    for (const p of l) {
      x += p[0];
      y += p[1];
      z += p[2];
      n++;
    }
  }
  return [x / n, y / n, z / n];
}

/** A triangle facing `toward`, whatever order it was given in. */
function tri(mb: MeshBuilder, a: V3, b: V3, c: V3, toward: V3) {
  const n = cross(sub(b, a), sub(c, a));
  if (dot(n, n) < 1e-18) return;
  if (dot(n, toward) >= 0) mb.addTriangle(...a, ...b, ...c);
  else mb.addTriangle(...a, ...c, ...b);
}

/**
 * A flat face, with holes if it has them, facing along `n`.
 *
 * Flattened onto the plane it lies in by dropping the axis `n` mostly points
 * along, which loses nothing for a face that is flat.
 */
export function cap(mb: MeshBuilder, outer: V3[], holes: V3[][], n: V3): void {
  const ax = [Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])];
  const drop = ax[0] >= ax[1] && ax[0] >= ax[2] ? 0 : ax[1] >= ax[2] ? 1 : 2;
  const keep = [0, 1, 2].filter((k) => k !== drop);

  const all = [outer, ...holes];
  const pts: V3[] = [];
  const flat: number[] = [];
  const starts: number[] = [];
  for (let r = 0; r < all.length; r++) {
    if (r > 0) starts.push(pts.length);
    for (const p of all[r]) {
      pts.push(p);
      flat.push(p[keep[0]], p[keep[1]]);
    }
  }

  const idx = earcut(Float64Array.from(flat), starts);
  for (let i = 0; i + 2 < idx.length; i += 3) {
    tri(mb, pts[idx[i]], pts[idx[i + 1]], pts[idx[i + 2]], n);
  }
}

/**
 * The side between two loops of the same length, point for point.
 *
 * @param away  true when the solid is on the inside of the loops, so the wall
 *              faces away from their middle; false for a pocket, whose wall
 *              faces the empty middle.
 */
export function wall(mb: MeshBuilder, a: V3[], b: V3[], away: boolean): void {
  const mid = centroid(a, b);
  const n = a.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const q = centroid([a[i], a[j], b[j], b[i]]);
    const out = sub(q, mid);
    const toward: V3 = away ? out : [-out[0], -out[1], -out[2]];
    tri(mb, a[i], a[j], b[j], toward);
    tri(mb, a[i], b[j], b[i], toward);
  }
}

/** A convex solid with the same outline top and bottom, or a taper between. */
export function frustum(mb: MeshBuilder, bottom: V3[], top: V3[]): void {
  const mid = centroid(bottom, top);
  const nb = cross(sub(bottom[1], bottom[0]), sub(bottom[2], bottom[0]));
  const away = (p: V3[]) => {
    const d = sub(centroid(p), mid);
    return dot(nb, d) >= 0 ? nb : ([-nb[0], -nb[1], -nb[2]] as V3);
  };
  const up = away(top);
  cap(mb, top, [], up);
  cap(mb, bottom, [], [-up[0], -up[1], -up[2]]);
  wall(mb, bottom, top, true);
}

/** Points of a polygon in the xz plane lifted to 3D at height `y`. */
export const atY = (poly: [number, number][], y: number): V3[] =>
  poly.map(([x, z]) => [x, y, z]);

/** Points of a polygon in the xy plane lifted to 3D at height `z`. */
export const atZ = (poly: [number, number][], z: number): V3[] =>
  poly.map(([x, y]) => [x, y, z]);

/** Keeps the part of a convex polygon where `keep(p)` is not negative. */
export function clip(
  poly: [number, number][],
  keep: (p: [number, number]) => number,
): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ka = keep(a);
    const kb = keep(b);
    if (ka >= 0) out.push(a);
    if ((ka >= 0) !== (kb >= 0)) {
      const t = ka / (ka - kb);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
}

/** A rectangle centred on `c`, `len` along `u` and `wid` across it. */
export function rect(
  c: [number, number],
  u: [number, number],
  len: number,
  wid: number,
): [number, number][] {
  const p: [number, number] = [-u[1], u[0]];
  const hl = len / 2;
  const hw = wid / 2;
  return [
    [c[0] - u[0] * hl - p[0] * hw, c[1] - u[1] * hl - p[1] * hw],
    [c[0] + u[0] * hl - p[0] * hw, c[1] + u[1] * hl - p[1] * hw],
    [c[0] + u[0] * hl + p[0] * hw, c[1] + u[1] * hl + p[1] * hw],
    [c[0] - u[0] * hl + p[0] * hw, c[1] - u[1] * hl + p[1] * hw],
  ];
}

/** A circle as a polygon, counting from the +x axis. */
export function circle(r: number, segments = 72): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}

/**
 * The wall round a hole of any shape, between two heights.
 *
 * `wall` decides which way a quad faces from the middle of the loop, which only
 * holds for a convex one. A cut-out is as awkward as its picture, so this takes
 * the loop's own winding instead: the solid is outside the loop and the wall
 * faces in, into the hole.
 */
export function holeWall(
  mb: MeshBuilder,
  loop: readonly [number, number][],
  z0: number,
  z1: number,
): void {
  let area = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  // For a counter-clockwise loop the inside is on the left of every edge.
  const side = area >= 0 ? 1 : -1;

  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    const into: V3 = [-(b[1] - a[1]) * side, (b[0] - a[0]) * side, 0];
    const a0: V3 = [a[0], a[1], z0];
    const b0: V3 = [b[0], b[1], z0];
    const a1: V3 = [a[0], a[1], z1];
    const b1: V3 = [b[0], b[1], z1];
    tri(mb, a0, b0, b1, into);
    tri(mb, a0, b1, a1, into);
  }
}

/** A rectangle with its corners rounded, counter-clockwise from the lower left. */
export function roundedBox(
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  radius: number,
  segments = 10,
): [number, number][] {
  const r = Math.max(0, Math.min(radius, (x1 - x0) / 2, (y1 - y0) / 2));
  if (r < 1e-6) return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

  const out: [number, number][] = [];
  // Each corner's arc, starting where the previous side meets it.
  const corners: [number, number, number][] = [
    [x1 - r, y0 + r, -Math.PI / 2],
    [x1 - r, y1 - r, 0],
    [x0 + r, y1 - r, Math.PI / 2],
    [x0 + r, y0 + r, Math.PI],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= segments; i++) {
      const a = a0 + (i / segments) * (Math.PI / 2);
      out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  return out;
}
