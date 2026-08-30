import { MeshBuilder, type Mesh } from "./mesh";
import { extrudeRegion } from "./extrude";
import { vectorise } from "./vectorise";
import { boxOf, coverOf, erode, placeIn } from "./stencil";

/**
 * A terraced relief built from the picture's shapes rather than its brightness.
 *
 * Same idea as the inlay, standing up instead of lying flat. Each tone is
 * traced out of the picture as a closed outline and extruded from the bed to
 * that tone's own plateau, so what the printer lays down at any height is the
 * artwork's own shape at that height and the steps between plateaus fall
 * exactly on the lines the artist drew.
 *
 * The tones do not overlap — a pixel is one tone — so the columns stand side
 * by side and their union is the terraced solid, with each column closed in
 * its own right. Where two of different heights meet they share an upright
 * face; that face is inside the union and buried, and every slicer takes
 * touching solids in its stride.
 *
 * A frame, if there is one, is the band the picture is pulled back from, and
 * it is drawn the same way: as a region of its own, standing full height.
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

  const vec = vectorise(lum, w, h, tones, 0.1, inner);
  const place = placeIn(box);
  const mb = new MeshBuilder(1 << 16);

  for (const region of vec.regions) {
    const z = plateau[region.tone];
    if (!(z > 0)) continue;
    extrudeRegion(mb, region.rings, place, 0, z);
  }

  if (framed) {
    // The band between the two covers, traced the same way anything else is:
    // one tone, everywhere the shape reaches that the picture does not.
    const band = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) band[i] = cover[i] && !inner[i] ? 1 : 0;

    const ring = vectorise(new Float64Array(w * h), w, h, [0], 0.1, band);
    for (const region of ring.regions) {
      extrudeRegion(mb, region.rings, place, 0, frameZ);
    }
  }

  return mb.finish();
}
