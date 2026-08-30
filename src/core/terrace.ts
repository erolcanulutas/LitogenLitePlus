import type { MeshBuilder } from "./mesh";

/**
 * Terraced ("graphic") surfacing.
 *
 * A heightfield grid can only place an edge on a cell boundary, so a hard edge
 * in the artwork lands within half a cell of where it belongs and comes out
 * serrated. The shape outline does not suffer from this because it is explicit
 * geometry — vertices are placed *on* the boundary curve. This does the same
 * for the picture: it puts vertices on the picture's own contours.
 *
 * Brightness varies linearly across a triangle, so the set of points at a
 * given brightness is exactly a straight segment. Cutting each triangle along
 * those segments therefore yields edges that are exact, not rounded to the
 * grid. Two triangles sharing an edge compute its crossing from the same pair
 * of corner values, so the cuts line up and the surface stays closed.
 *
 * The result is a stack of flat plateaus joined by vertical walls — which is
 * what line art wants. Photographs do not; they should stay on the smooth
 * path.
 */

/** Polygon carrying brightness per vertex, so clipping can interpolate it. */
export type Poly = {
  x: number[];
  y: number[];
  l: number[];
};

const EPS = 1e-9;

/**
 * The luminance boundaries between bands, ascending.
 *
 * Even spacing is only right when the artwork's tones happen to be evenly
 * spaced. They rarely are: a logo drawn in black, one red and white puts its
 * red at 0.29, which even thirds cannot separate from black at all and even
 * quarters separate by 0.036 — close enough to the boundary that averaging a
 * thin feature over a mesh cell tips it into the wrong band and the feature
 * disappears. Supplying the boundaries measured from the picture instead puts
 * each cut halfway between the tones it divides, which is as much room as the
 * artwork allows.
 *
 * Falls back to even spacing when nothing was measured, so a photograph and
 * any older setting behave exactly as before.
 */
export function bandCuts(
  levels: number,
  cuts?: readonly number[],
): readonly number[] {
  if (cuts && cuts.length === levels - 1) return cuts;
  const out: number[] = [];
  for (let k = 1; k < levels; k++) out.push(k / levels);
  return out;
}

/** Which band a brightness falls in, given those boundaries. */
export function bandOfLum(l: number, cuts: readonly number[]): number {
  let k = 0;
  while (k < cuts.length && l >= cuts[k]) k++;
  return k;
}

/** Keeps the part of `p` on one side of brightness `t`. */
export function clipByLum(p: Poly, t: number, keepAbove: boolean): Poly {
  const out: Poly = { x: [], y: [], l: [] };
  const n = p.x.length;
  if (n === 0) return out;

  const inside = (l: number) => (keepAbove ? l >= t - EPS : l <= t + EPS);

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const li = p.l[i];
    const lj = p.l[j];
    const ii = inside(li);
    const ij = inside(lj);

    if (ii) {
      out.x.push(p.x[i]);
      out.y.push(p.y[i]);
      out.l.push(li);
    }

    if (ii !== ij) {
      const d = lj - li;
      const s = Math.abs(d) < EPS ? 0 : (t - li) / d;
      out.x.push(p.x[i] + (p.x[j] - p.x[i]) * s);
      out.y.push(p.y[i] + (p.y[j] - p.y[i]) * s);
      out.l.push(t);
    }
  }

  return out;
}

/** Emits a flat polygon at height z, wound counter-clockwise (facing +Z). */
export function fanFlat(mb: MeshBuilder, p: Poly, z: number) {
  const n = p.x.length;
  if (n < 3) return;

  for (let i = 1; i + 1 < n; i++) {
    const ax = p.x[0], ay = p.y[0];
    const bx = p.x[i], by = p.y[i];
    const cx = p.x[i + 1], cy = p.y[i + 1];

    // Drop slivers; they carry no area and upset slicers.
    if (Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) <= 1e-12) continue;

    mb.addTriangle(ax, ay, z, bx, by, z, cx, cy, z);
  }
}

/**
 * The picture's brightness anywhere on the surface, as the vertices read it.
 *
 * Given one, a contour crossing is placed *on* the contour instead of being
 * guessed by interpolating between two corners. See `crossingOn`.
 */
export type LumField = (x: number, y: number) => number;

/** Steps spent putting a crossing on the contour. Converges long before this. */
const REFINE_STEPS = 10;

/**
 * Where an edge crosses brightness `t`.
 *
 * Interpolating linearly between the two corner values lands within a few
 * microns of the contour, which sounds close enough and is not: the chords
 * between crossings are only about 0.08mm long, so a 3µm sideways error turns
 * into a few degrees of direction change, and it changes sign from one chord
 * to the next because consecutive crossings sit on different families of mesh
 * edge. The surface then turns a little one way and a little the other all
 * along a step, and reads as a comb.
 *
 * The frame does not have this problem, because its edge is not guessed —
 * `boundaryAt` puts vertices on the boundary curve itself, so consecutive
 * faces along a straight side are exactly coplanar. Solving for the crossing
 * against the brightness field does the same thing here.
 *
 * Two triangles share this edge and have to place the point identically or
 * the surface opens, so the solve is run in a canonical direction: whichever
 * triangle asks, the inputs are the same and so is the answer.
 */
export function crossingOn(
  x0: number, y0: number, l0: number,
  x1: number, y1: number, l1: number,
  t: number,
  field: LumField | undefined,
): { x: number; y: number } {
  if (x1 < x0 || (x1 === x0 && y1 < y0)) {
    return crossingOn(x1, y1, l1, x0, y0, l0, t, field);
  }

  const d = l1 - l0;
  let s = Math.abs(d) < EPS ? 0.5 : (t - l0) / d;
  s = Math.max(0, Math.min(1, s));

  if (field) {
    let a = 0;
    let b = 1;
    let ga = field(x0, y0) - t;
    let gb = field(x1, y1) - t;

    if (ga === 0) return { x: x0, y: y0 };
    if (gb === 0) return { x: x1, y: y1 };

    // Only solve when the ends really do straddle it. They normally do — the
    // corner values came from this same field — but a guard costs nothing and
    // keeps a surprise from throwing the point off the edge entirely.
    if ((ga < 0) !== (gb < 0)) {
      for (let i = 0; i < REFINE_STEPS; i++) {
        const x = x0 + (x1 - x0) * s;
        const y = y0 + (y1 - y0) * s;
        const g = field(x, y) - t;
        if (g === 0) break;

        if ((g < 0) === (ga < 0)) {
          a = s;
          ga = g;
        } else {
          b = s;
          gb = g;
        }

        const den = gb - ga;
        let next = Math.abs(den) < EPS ? (a + b) / 2 : a + (-ga * (b - a)) / den;
        if (!(next > a && next < b)) next = (a + b) / 2;

        const moved = Math.abs(next - s);
        s = next;
        if (moved < 1e-12) break;
      }
    }
  }

  return { x: x0 + (x1 - x0) * s, y: y0 + (y1 - y0) * s };
}

/**
 * The triangle's outline with every contour crossing carried as a real vertex.
 *
 * Splitting the edges up front is what keeps the plateaus and the step faces
 * agreeing: both are built from these same points, so a plateau's edge and the
 * face that rises from it are the same line, and neither has to re-derive it.
 * A crossing vertex holds the cut's brightness exactly, so clipping finds it
 * by value rather than interpolating towards it a second time.
 */
export function outlineWithCrossings(
  ax: number, ay: number, al: number,
  bx: number, by: number, bl: number,
  cx: number, cy: number, cl: number,
  cuts: readonly number[],
  lo: number,
  hi: number,
  field: LumField | undefined,
): Poly {
  const out: Poly = { x: [], y: [], l: [] };

  const side = (
    x0: number, y0: number, l0: number,
    x1: number, y1: number, l1: number,
  ) => {
    out.x.push(x0);
    out.y.push(y0);
    out.l.push(l0);

    const hits: { s: number; t: number }[] = [];
    for (let k = lo + 1; k <= hi; k++) {
      const t = cuts[k - 1];
      if ((l0 < t && l1 >= t) || (l1 < t && l0 >= t)) {
        const d = l1 - l0;
        hits.push({ s: Math.abs(d) < EPS ? 0.5 : (t - l0) / d, t });
      }
    }
    hits.sort((p, q) => p.s - q.s);

    for (const h of hits) {
      const p = crossingOn(x0, y0, l0, x1, y1, l1, h.t, field);
      out.x.push(p.x);
      out.y.push(p.y);
      out.l.push(h.t);
    }
  };

  side(ax, ay, al, bx, by, bl);
  side(bx, by, bl, cx, cy, cl);
  side(cx, cy, cl, ax, ay, al);

  return out;
}

/**
 * Cuts one surface triangle into level bands and emits them, together with the
 * vertical walls that join them.
 *
 * @param cuts       Brightness boundaries between bands, ascending. One
 *                   fewer than there are bands; see bandCuts.
 * @param heightOf   Band index -> surface height in mm. Must be monotonic.
 * @param field      Optional brightness field. Given one, crossings are placed
 *                   on the contour rather than interpolated to it.
 */
export function emitTerracedTriangle(
  mb: MeshBuilder,
  ax: number, ay: number, al: number,
  bx: number, by: number, bl: number,
  cx: number, cy: number, cl: number,
  cuts: readonly number[],
  heightOf: (band: number) => number,
  field?: LumField,
): void {
  const levels = cuts.length + 1;

  const ba = bandOfLum(al, cuts);
  const bb = bandOfLum(bl, cuts);
  const bc = bandOfLum(cl, cuts);

  const lo = Math.min(ba, bb, bc);
  const hi = Math.max(ba, bb, bc);

  if (lo === hi) {
    fanFlat(mb, { x: [ax, bx, cx], y: [ay, by, cy], l: [al, bl, cl] }, heightOf(lo));
    return;
  }

  const tri = outlineWithCrossings(
    ax, ay, al, bx, by, bl, cx, cy, cl, cuts, lo, hi, field,
  );

  // One flat plateau per band the triangle touches.
  for (let k = lo; k <= hi; k++) {
    let band = tri;
    if (k > 0) band = clipByLum(band, cuts[k - 1], true);
    if (k < levels - 1) band = clipByLum(band, cuts[k], false);
    fanFlat(mb, band, heightOf(k));
  }

  // A vertical wall at every band boundary the triangle actually crosses.
  for (let k = lo + 1; k <= hi; k++) {
    const t = cuts[k - 1];

    // The crossings are already vertices of the outline, holding the cut's
    // brightness exactly, so the wall stands on the same points the plateaus
    // were cut to rather than on a second guess at where they were.
    const px: number[] = [];
    const py: number[] = [];
    for (let i = 0; i < tri.x.length; i++) {
      if (tri.l[i] === t) {
        px.push(tri.x[i]);
        py.push(tri.y[i]);
      }
    }

    if (px.length !== 2) continue;

    const zLow = heightOf(k - 1);
    const zHigh = heightOf(k);
    if (Math.abs(zHigh - zLow) < EPS) continue;

    // Reference point on the band-k side (the corners at or above t).
    let refX = 0, refY = 0, refCount = 0;
    if (al >= t) { refX += ax; refY += ay; refCount++; }
    if (bl >= t) { refX += bx; refY += by; refCount++; }
    if (cl >= t) { refX += cx; refY += cy; refCount++; }
    if (refCount === 0) continue;
    refX /= refCount;
    refY /= refCount;

    let x0 = px[0], y0 = py[0], x1 = px[1], y1 = py[1];

    // The wall separates solid from air, so it must face whichever side is
    // *lower*. Which side that is depends on emboss direction, not on
    // brightness — so key off the heights, not the levels.
    const refSideIsHigher = zHigh > zLow;

    const midX = (x0 + x1) / 2;
    const midY = (y0 + y1) / 2;
    // With the quad wound bottom-edge-first, its normal is (dy, -dx).
    const facesAwayFromRef =
      (y1 - y0) * (midX - refX) - (x1 - x0) * (midY - refY) > 0;

    if (facesAwayFromRef !== refSideIsHigher) {
      [x0, x1] = [x1, x0];
      [y0, y1] = [y1, y0];
    }

    const zA = Math.min(zLow, zHigh);
    const zB = Math.max(zLow, zHigh);
    mb.addQuad(x0, y0, zA, x1, y1, zA, x1, y1, zB, x0, y0, zB);
  }
}
