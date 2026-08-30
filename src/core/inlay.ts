import type { MeshBuilder, Mesh } from "./mesh";
import type { BandedMesh } from "./split_mesh";
import {
  type LumField,
  type Poly,
  bandOfLum,
  clipByLum,
  crossingOn,
  fanFlat,
  outlineWithCrossings,
} from "./terrace";

/**
 * Inlaid colour: one flat slab, the picture set into its top layers.
 *
 * A lithophane says colour with thickness — the bodies are slabs stacked on
 * each other and a plane cut separates them. That is the wrong shape for a
 * coaster or a sign, where the top has to be flat and the filament has to
 * change *within* a layer instead of between two.
 *
 * So the top of the model is one height everywhere, and the picture only
 * decides which body each part of it belongs to. Every tone becomes a solid
 * standing in the same layers as its neighbours: same floor, same ceiling,
 * meeting them edge to edge. A slicer given those as separate bodies changes
 * filament partway across a layer, which is what puts the picture in the
 * surface rather than on it.
 *
 * Nothing here needs the terracing to be redone — the tone regions are cut out
 * by the same contour solve the relief uses, so an inlay's edges are as clean
 * as a relief's, and the band that is only a ramp is squeezed shut before it
 * ever gets here.
 */

/** The two heights an inlay lives between. */
export type InlaySpan = {
  /** Top of the solid base, and the floor every tone stands on. */
  baseZ: number;
  /** The flat top of the whole model. */
  topZ: number;
};

/** Body 0 is the base slab; tone k is body k + 1. */
export const BASE_BODY = 0;
export const toneBody = (band: number) => band + 1;

/** Emits a polygon at `z` wound clockwise, so it faces down. */
function fanFlatDown(mb: MeshBuilder, p: Poly, z: number) {
  const n = p.x.length;
  if (n < 3) return;
  for (let i = 1; i + 1 < n; i++) {
    const ax = p.x[0], ay = p.y[0];
    const bx = p.x[i], by = p.y[i];
    const cx = p.x[i + 1], cy = p.y[i + 1];
    if (Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) <= 1e-12) continue;
    mb.addTriangle(ax, ay, z, cx, cy, z, bx, by, z);
  }
}

/**
 * Cuts one surface triangle into tone regions and stands each on the base.
 *
 * Every region gets a ceiling at `topZ`, a floor at `baseZ` facing the other
 * way, and a wall wherever it meets another tone. The wall is emitted twice,
 * once for each side and facing opposite ways, because the two tones are
 * separate solids that happen to touch — one shared face would leave both of
 * them open.
 *
 * @param cuts     Brightness boundaries between tones, ascending.
 * @param field    Optional brightness field, for placing crossings on the
 *                 contour rather than interpolating to it. See core/terrace.ts.
 */
export function emitInlayTriangle(
  mb: MeshBuilder,
  ax: number, ay: number, al: number,
  bx: number, by: number, bl: number,
  cx: number, cy: number, cl: number,
  cuts: readonly number[],
  span: InlaySpan,
  field?: LumField,
): void {
  const levels = cuts.length + 1;
  const { baseZ, topZ } = span;

  const ba = bandOfLum(al, cuts);
  const bb = bandOfLum(bl, cuts);
  const bc = bandOfLum(cl, cuts);

  const lo = Math.min(ba, bb, bc);
  const hi = Math.max(ba, bb, bc);

  const whole: Poly = { x: [ax, bx, cx], y: [ay, by, cy], l: [al, bl, cl] };

  // The base slab's own ceiling, under everything, whatever the tones do.
  mb.setTag(BASE_BODY);
  fanFlat(mb, whole, baseZ);

  if (lo === hi) {
    mb.setTag(toneBody(lo));
    fanFlat(mb, whole, topZ);
    fanFlatDown(mb, whole, baseZ);
    return;
  }

  const tri = outlineWithCrossings(
    ax, ay, al, bx, by, bl, cx, cy, cl, cuts, lo, hi, field,
  );

  // A band squeezed shut keeps its plateau and its walls even though there is
  // nothing left of it. Dropping them was tried: whether a band comes out
  // degenerate is decided per triangle, and a band can be degenerate in one
  // and not in the one beside it, so the two stop agreeing about what wall
  // stands between them. Left in, the closed band is a body of no volume that
  // costs two unmatched edges in the whole model and nothing else.
  for (let k = lo; k <= hi; k++) {
    let band = tri;
    if (k > 0) band = clipByLum(band, cuts[k - 1], true);
    if (k < levels - 1) band = clipByLum(band, cuts[k], false);

    mb.setTag(toneBody(k));
    fanFlat(mb, band, topZ);
    fanFlatDown(mb, band, baseZ);
  }

  // A wall at every boundary the triangle crosses, one for each side of it.
  for (let k = lo + 1; k <= hi; k++) {
    const t = cuts[k - 1];

    const px: number[] = [];
    const py: number[] = [];
    for (let i = 0; i < tri.x.length; i++) {
      if (tri.l[i] === t) {
        px.push(tri.x[i]);
        py.push(tri.y[i]);
      }
    }
    if (px.length !== 2) continue;

    // Which side the brighter tone is on, so each wall faces out of its body.
    let refX = 0, refY = 0, refCount = 0;
    if (al >= t) { refX += ax; refY += ay; refCount++; }
    if (bl >= t) { refX += bx; refY += by; refCount++; }
    if (cl >= t) { refX += cx; refY += cy; refCount++; }
    if (refCount === 0) continue;
    refX /= refCount;
    refY /= refCount;

    let x0 = px[0], y0 = py[0], x1 = px[1], y1 = py[1];
    const midX = (x0 + x1) / 2;
    const midY = (y0 + y1) / 2;
    const facesAwayFromRef =
      (y1 - y0) * (midX - refX) - (x1 - x0) * (midY - refY) > 0;

    // Put it the way round that faces away from the brighter side. The
    // brighter tone is the one standing on that side, so this is the face on
    // *its* outside; the darker tone gets the same wall reversed.
    if (!facesAwayFromRef) {
      [x0, x1] = [x1, x0];
      [y0, y1] = [y1, y0];
    }

    mb.setTag(toneBody(k));
    mb.addQuad(x0, y0, baseZ, x1, y1, baseZ, x1, y1, topZ, x0, y0, topZ);

    mb.setTag(toneBody(k - 1));
    mb.addQuad(x1, y1, baseZ, x0, y0, baseZ, x0, y0, topZ, x1, y1, topZ);
  }
}

/**
 * Regroups a tagged mesh so every body's triangles sit together.
 *
 * The exporter wants one run of triangles per body and a note of where each
 * starts; the generator produces them interleaved, because it walks the
 * surface once and meets the bodies in whatever order the picture puts them.
 *
 * Bodies that came out empty are dropped, and `kept` says which ones survived
 * so the caller can drop their colours to match.
 */
export function groupByBody(
  mesh: Mesh,
  bodyCount: number,
): { banded: BandedMesh; kept: number[] } {
  const tags = mesh.tags;
  const total = mesh.triangleCount;

  if (!tags) {
    return {
      banded: {
        positions: new Float32Array(mesh.positions),
        triangleCount: total,
        bandStarts: [0],
      },
      kept: [0],
    };
  }

  const counts = new Int32Array(bodyCount);
  for (let i = 0; i < total; i++) counts[tags[i]]++;

  const kept: number[] = [];
  for (let b = 0; b < bodyCount; b++) if (counts[b] > 0) kept.push(b);

  const positions = new Float32Array(total * 9);
  const bandStarts: number[] = [];
  const at = new Int32Array(bodyCount);

  let cursor = 0;
  for (const b of kept) {
    bandStarts.push(cursor);
    at[b] = cursor;
    cursor += counts[b];
  }

  for (let i = 0; i < total; i++) {
    const b = tags[i];
    const dst = at[b]++ * 9;
    positions.set(mesh.positions.subarray(i * 9, i * 9 + 9), dst);
  }

  return { banded: { positions, triangleCount: total, bandStarts }, kept };
}

/**
 * The outside wall of the model, over one segment of the rim.
 *
 * Below the picture it belongs to the base slab; above it belongs to whichever
 * tone reaches the edge there, and the segment is split where the tone changes.
 * The split has to land on the same point the surface put its contour on, or
 * the wall and the ceiling above it stop agreeing and both bodies open, so it
 * is solved the same way rather than interpolated.
 */
export function emitInlayRim(
  mb: MeshBuilder,
  x0: number, y0: number, l0: number,
  x1: number, y1: number, l1: number,
  cuts: readonly number[],
  span: InlaySpan,
  field?: LumField,
): void {
  const { baseZ, topZ } = span;

  const wall = (
    ax: number, ay: number, bx: number, by: number,
    zA: number, zB: number,
  ) => {
    if (Math.abs(zB - zA) < 1e-12) return;
    mb.addQuad(ax, ay, zB, ax, ay, zA, bx, by, zA, bx, by, zB);
  };

  mb.setTag(BASE_BODY);
  wall(x0, y0, x1, y1, 0, baseZ);

  const b0 = bandOfLum(l0, cuts);
  const b1 = bandOfLum(l1, cuts);

  if (b0 === b1) {
    mb.setTag(toneBody(b0));
    wall(x0, y0, x1, y1, baseZ, topZ);
    return;
  }

  // Split at every boundary between the two ends, in the order they are met.
  const lo = Math.min(b0, b1);
  const hi = Math.max(b0, b1);
  const stops: { s: number; t: number }[] = [];
  for (let k = lo + 1; k <= hi; k++) {
    const t = cuts[k - 1];
    if ((l0 < t && l1 >= t) || (l1 < t && l0 >= t)) {
      const d = l1 - l0;
      stops.push({ s: Math.abs(d) < 1e-12 ? 0.5 : (t - l0) / d, t });
    }
  }
  stops.sort((p, q) => p.s - q.s);

  let px = x0;
  let py = y0;
  let pl = l0;
  for (const stop of stops) {
    const p = crossingOn(x0, y0, l0, x1, y1, l1, stop.t, field);
    mb.setTag(toneBody(bandOfLum((pl + stop.t) / 2, cuts)));
    wall(px, py, p.x, p.y, baseZ, topZ);
    px = p.x;
    py = p.y;
    pl = stop.t;
  }
  mb.setTag(toneBody(bandOfLum((pl + l1) / 2, cuts)));
  wall(px, py, x1, y1, baseZ, topZ);
}

/** A point of the split, and whether any neighbouring triangle can see it. */
type Kind = 0 | 1 | 2; // corner, crossing on an edge, invented inside

type Pt = { x: number; y: number; kind: Kind };

/**
 * A fan that keeps every triangle it is given, however thin.
 *
 * The relief drops slivers, because a slicer would rather not see them. A
 * region here cannot afford that: its share of one triangle joins its share of
 * the next along their shared edge, and a piece dropped on one side of that
 * edge leaves the piece on the other side with nothing to meet. Measured, that
 * is not a rounding error — whole regions went missing and the bodies drifted
 * five to fifteen per cent. A triangle of no area costs nothing and holds the
 * seam shut.
 */
function fanKeepAll(mb: MeshBuilder, pts: readonly Pt[], z: number, down: boolean) {
  const n = pts.length;
  if (n < 3) return;
  for (let i = 1; i + 1 < n; i++) {
    if (down) {
      mb.addTriangle(pts[0].x, pts[0].y, z, pts[i + 1].x, pts[i + 1].y, z, pts[i].x, pts[i].y, z);
    } else {
      mb.addTriangle(pts[0].x, pts[0].y, z, pts[i].x, pts[i].y, z, pts[i + 1].x, pts[i + 1].y, z);
    }
  }
}

/**
 * Cuts one surface triangle into tone regions and stands each on the base.
 *
 * **The tones arrive as numbers, not as brightness.** That is the whole
 * difference. Read off a brightness field, a tone lying between two others has
 * to appear wherever those two meet, because the field passes through its
 * values on the way; a white shape on black comes out ringed in it however
 * thin the ring is squeezed. Given a number per corner, an edge whose ends
 * disagree gets exactly one crossing however far apart their tones are, and
 * there is nothing in between for a third tone to occupy.
 *
 * The crossing is still placed against the field, solved for the brightness
 * half way between the two tones, so edges land where the picture puts them
 * rather than stepping along its pixels.
 */
export function emitInlayTriangleByTone(
  mb: MeshBuilder,
  ax: number, ay: number, al: number, ka: number,
  bx: number, by: number, bl: number, kb: number,
  cx: number, cy: number, cl: number, kc: number,
  cuts: readonly number[],
  span: InlaySpan,
  field?: LumField,
): void {
  const { baseZ } = span;

  const A: Pt = { x: ax, y: ay, kind: 0 };
  const B: Pt = { x: bx, y: by, kind: 0 };
  const C: Pt = { x: cx, y: cy, kind: 0 };

  // The base slab owns a ceiling here, facing up out of itself, under
  // everything the tones do above it.
  mb.setTag(BASE_BODY);
  fanKeepAll(mb, [A, B, C], baseZ, false);

  if (ka === kb && kb === kc) {
    emitRegion(mb, [A, B, C], ka, span);
    return;
  }

  /** Where an edge changes tone: one point, whatever the gap between them. */
  const cross = (
    x0: number, y0: number, l0: number, k0: number,
    x1: number, y1: number, l1: number, k1: number,
  ): Pt => {
    const lo = Math.min(k0, k1);
    const hi = Math.max(k0, k1);
    const t = (cuts[lo] + cuts[hi - 1]) / 2;
    const p = crossingOn(x0, y0, l0, x1, y1, l1, t, field);
    return { x: p.x, y: p.y, kind: 1 };
  };

  const pAB = ka !== kb ? cross(ax, ay, al, ka, bx, by, bl, kb) : null;
  const pBC = kb !== kc ? cross(bx, by, bl, kb, cx, cy, cl, kc) : null;
  const pCA = kc !== ka ? cross(cx, cy, cl, kc, ax, ay, al, ka) : null;

  if (pAB && pBC && pCA) {
    // Three tones meet somewhere inside. The middle is this triangle's own,
    // seen by nothing else, so the centroid will do.
    const M: Pt = { x: (ax + bx + cx) / 3, y: (ay + by + cy) / 3, kind: 2 };
    emitRegion(mb, [A, pAB, M, pCA], ka, span);
    emitRegion(mb, [B, pBC, M, pAB], kb, span);
    emitRegion(mb, [C, pCA, M, pBC], kc, span);
    return;
  }

  // One corner stands apart and the other two agree: a corner and a quad.
  if (!pBC) {
    emitRegion(mb, [A, pAB!, pCA!], ka, span);
    emitRegion(mb, [pAB!, B, C, pCA!], kb, span);
  } else if (!pCA) {
    emitRegion(mb, [B, pBC, pAB!], kb, span);
    emitRegion(mb, [pBC, C, A, pAB!], kc, span);
  } else {
    emitRegion(mb, [C, pCA, pBC], kc, span);
    emitRegion(mb, [pCA, A, B, pBC], ka, span);
  }
}

/**
 * One tone's share of a triangle: a ceiling, a floor, and a wall on every side
 * another tone is on the far side of.
 *
 * A side between two of the triangle's own points — a corner, or a crossing on
 * one of its edges — is where the next triangle carries on, and needs no wall.
 * A side between two points this split invented is a boundary between tones,
 * and the region's own winding already says which way it faces.
 */
function emitRegion(
  mb: MeshBuilder,
  pts: readonly Pt[],
  band: number,
  span: InlaySpan,
): void {
  const { baseZ, topZ } = span;

  mb.setTag(toneBody(band));
  fanKeepAll(mb, pts, topZ, false);
  fanKeepAll(mb, pts, baseZ, true);

  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    if (pts[i].kind === 0 || pts[j].kind === 0) continue;

    const x0 = pts[i].x, y0 = pts[i].y;
    const x1 = pts[j].x, y1 = pts[j].y;

    mb.addTriangle(x0, y0, baseZ, x1, y1, baseZ, x1, y1, topZ);
    mb.addTriangle(x0, y0, baseZ, x1, y1, topZ, x0, y0, topZ);
  }
}

/**
 * The outside wall of the model, over one segment of the rim.
 *
 * Below the picture it belongs to the base slab; above it belongs to whichever
 * tone reaches the edge there, split where the tone changes. The split lands
 * on the same point the surface put its boundary on, solved the same way.
 */
export function emitInlayRimByTone(
  mb: MeshBuilder,
  x0: number, y0: number, l0: number, k0: number,
  x1: number, y1: number, l1: number, k1: number,
  cuts: readonly number[],
  span: InlaySpan,
  field?: LumField,
): void {
  const { baseZ, topZ } = span;

  const wall = (
    px: number, py: number, qx: number, qy: number,
    zA: number, zB: number,
  ) => {
    mb.addQuad(px, py, zB, px, py, zA, qx, qy, zA, qx, qy, zB);
  };

  mb.setTag(BASE_BODY);
  wall(x0, y0, x1, y1, 0, baseZ);

  if (k0 === k1) {
    mb.setTag(toneBody(k0));
    wall(x0, y0, x1, y1, baseZ, topZ);
    return;
  }

  const lo = Math.min(k0, k1);
  const hi = Math.max(k0, k1);
  const t = (cuts[lo] + cuts[hi - 1]) / 2;
  const p = crossingOn(x0, y0, l0, x1, y1, l1, t, field);

  mb.setTag(toneBody(k0));
  wall(x0, y0, p.x, p.y, baseZ, topZ);

  mb.setTag(toneBody(k1));
  wall(p.x, p.y, x1, y1, baseZ, topZ);
}

