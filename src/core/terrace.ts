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
type Poly = {
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
function clipByLum(p: Poly, t: number, keepAbove: boolean): Poly {
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
function fanFlat(mb: MeshBuilder, p: Poly, z: number) {
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
 * Cuts one surface triangle into level bands and emits them, together with the
 * vertical walls that join them.
 *
 * @param cuts       Brightness boundaries between bands, ascending. One
 *                   fewer than there are bands; see bandCuts.
 * @param heightOf   Band index -> surface height in mm. Must be monotonic.
 */
export function emitTerracedTriangle(
  mb: MeshBuilder,
  ax: number, ay: number, al: number,
  bx: number, by: number, bl: number,
  cx: number, cy: number, cl: number,
  cuts: readonly number[],
  heightOf: (band: number) => number,
): void {
  const levels = cuts.length + 1;

  const ba = bandOfLum(al, cuts);
  const bb = bandOfLum(bl, cuts);
  const bc = bandOfLum(cl, cuts);

  const lo = Math.min(ba, bb, bc);
  const hi = Math.max(ba, bb, bc);

  const tri: Poly = { x: [ax, bx, cx], y: [ay, by, cy], l: [al, bl, cl] };

  if (lo === hi) {
    fanFlat(mb, tri, heightOf(lo));
    return;
  }

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

    // Brightness is linear here, so the level set is a single segment: find
    // where it meets the triangle's edges.
    const px: number[] = [];
    const py: number[] = [];

    const edge = (x0: number, y0: number, l0: number, x1: number, y1: number, l1: number) => {
      if ((l0 < t && l1 >= t) || (l1 < t && l0 >= t)) {
        const s = (t - l0) / (l1 - l0);
        px.push(x0 + (x1 - x0) * s);
        py.push(y0 + (y1 - y0) * s);
      }
    };

    edge(ax, ay, al, bx, by, bl);
    edge(bx, by, bl, cx, cy, cl);
    edge(cx, cy, cl, ax, ay, al);

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
