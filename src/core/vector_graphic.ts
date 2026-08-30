import { MeshBuilder, type Mesh } from "./mesh";
import { extrudeRegion } from "./extrude";
import { vectorise, OUTSIDE } from "./vectorise";
import { boxOf, coverOf, erode, placeIn } from "./stencil";

/**
 * How far a boundary may be moved to lose the pixel staircase, in pixels.
 *
 * A step is half a pixel deep, so this is comfortably enough to flatten one.
 * What it really sets is the most rounding a corner the artist drew can take,
 * because a corner spends the whole budget and then stops: at the resolutions
 * traced here that is a few hundredths of a millimetre on the print.
 */
const SMOOTH_PX = 1.2;

/** Smallest feature kept, in millimetres. See core/vector_inlay.ts. */
const MIN_FEATURE_MM = 0.25;

/**
 * A terraced relief built from the picture's shapes rather than its brightness.
 *
 * Same idea as the inlay, standing up instead of lying flat. Each tone is
 * traced out of the picture as a closed outline and stands at its own plateau,
 * so what the printer lays down at any height is the artwork's own shape at
 * that height and the steps between plateaus fall on the lines the artist drew.
 *
 * It is one solid, not a tone's worth of separate ones. That distinction is the
 * whole of this file's difficulty. The tones tile the shape, so a column per
 * tone does enclose the right volume and each column does close on its own —
 * but along every step two columns then raise a full-height wall on the same
 * line facing opposite ways. Buried, so the volume is right; hidden, so it
 * looks right; and a slicer taking a layer through it finds a closed loop of
 * nothing there and traces a perimeter round it, on every layer, hundreds of
 * times over.
 *
 * So along a step only the taller side raises a wall, and it raises it from the
 * shorter side's plateau rather than from the floor. The floors still meet edge
 * to edge and the lids still stop where the walls start, because both sides are
 * built from the same traced curve. What comes out is a single closed surface.
 *
 * A frame, if there is one, is traced with the tones rather than beside them,
 * as a label of its own standing full height. Traced separately it would give
 * two curves along the line it shares with the picture, and everything caught
 * between two nearly-identical curves is a sliver belonging to neither.
 */
export function buildVectorGraphic(
  shape: Mesh,
  lum: Float64Array,
  w: number,
  h: number,
  tones: readonly number[],
  /** Plateau height of each tone in millimetres, darkest first. */
  plateau: readonly number[],
  /** How far the picture is held back from the shape's edge, in millimetres. */
  frameMm: number,
  frameZ: number,
): Mesh {
  const box = boxOf(shape);
  if (!box) return shape;

  const cover = coverOf(shape, box, w, h);
  const pxPerMm = w / (box.maxX - box.minX);
  const framed = frameMm > 0.001;
  const inner = framed ? erode(cover, w, h, frameMm * pxPerMm) : cover;

  const heights = [...plateau];
  let stamp: { where: Uint8Array; label: number } | undefined;

  if (framed) {
    const band = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) band[i] = cover[i] && !inner[i] ? 1 : 0;
    stamp = { where: band, label: heights.length };
    heights.push(frameZ);
  }

  const floorPx = (MIN_FEATURE_MM * pxPerMm) ** 2;
  const vec = vectorise(lum, w, h, tones, SMOOTH_PX, cover, floorPx, stamp);

  const zOf = (label: number) => (label === OUTSIDE ? 0 : (heights[label] ?? 0));

  // Which tone owns each stretch of boundary.
  //
  // Every boundary belongs to two tones and both build it from the same traced
  // curve, so the very same pair of points appears in both their outlines, one
  // way round in each. Looking the pair up backwards therefore names the tone
  // on the other side exactly — no sampling, no tolerance, and nothing to be
  // wrong about near a corner. Not finding it means there is no tone over
  // there: that stretch is the outside of the shape.
  const owner = new Map<string, number>();
  const key = (ax: number, ay: number, bx: number, by: number) =>
    `${ax},${ay},${bx},${by}`;

  for (const region of vec.regions) {
    for (const r of region.rings) {
      const n = r.x.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        owner.set(key(r.x[i], r.y[i], r.x[j], r.y[j]), region.tone);
      }
    }
  }

  // Every height anything stands at, so a wall spanning two steps is cut where
  // its neighbours' walls stop.
  const steps = [...new Set(heights)].sort((a, b) => a - b);

  const place = placeIn(box);
  const mb = new MeshBuilder(1 << 16);

  for (const region of vec.regions) {
    const top = zOf(region.tone);
    if (!(top > 0)) continue;

    // How far down this stretch of wall has to reach to meet its neighbour.
    // The wall is only raised where this tone is the taller of the two; the
    // shorter side raises nothing, so the step is walled once rather than
    // twice.
    const wallBase = (ua: number, va: number, ub: number, vb: number) => {
      let other = owner.get(key(ub, vb, ua, va));
      if (other === undefined || other === region.tone) {
        other = owner.get(key(ua, va, ub, vb));
      }
      if (other === region.tone) return null;

      const foot = other === undefined ? 0 : zOf(other);
      return foot < top ? foot : null;
    };

    extrudeRegion(mb, region.rings, place, 0, top, wallBase, steps);
  }

  return mb.finish();
}
