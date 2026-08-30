import { MeshBuilder, type Mesh } from "./mesh";
import { BASE_BODY, toneBody, type InlaySpan } from "./inlay";
import { extrudeRegion } from "./extrude";
import { vectorise } from "./vectorise";
import { boxOf, coverOf, placeIn } from "./stencil";

/**
 * How far a boundary may be moved to lose the pixel staircase, in pixels.
 *
 * A step is half a pixel deep, so this is comfortably enough to flatten one.
 * What it really sets is the most rounding a corner the artist drew can take,
 * because a corner spends the whole budget and then stops: at the resolutions
 * traced here that is a few hundredths of a millimetre on the print.
 */
const SMOOTH_PX = 1.2;

/**
 * Smallest feature kept, in millimetres.
 *
 * Under about this the printer has nothing to lay the colour down with — a
 * single line from a 0.4mm nozzle is wider — so a speck this size is a colour
 * change that cannot happen, and quantising a busy edge leaves a scattering of
 * them. Held in millimetres rather than pixels so it means the same thing
 * whatever the picture is traced at.
 */
const MIN_FEATURE_MM = 0.25;

/**
 * An inlay built from the picture's shapes rather than from its brightness.
 *
 * The slab underneath is the shape's own, taken from the mesh it already
 * builds. What sits in its top layers is not: each tone is traced out of the
 * picture as a closed outline and extruded as its own solid, so a tone is
 * exactly where the artist put it and nowhere else.
 *
 * The difference that matters is at a boundary. Deciding tones by thresholding
 * a brightness field puts every tone whose brightness lies between two others
 * along the line where those two meet — white next to black is drawn as a
 * climb through every value in between, and a tone sitting at one of those
 * values gets a stripe. Tracing regions there is one line between white and
 * black with nothing in it.
 *
 * The shape's edge is handled the same way as everything else: pixels the slab
 * does not reach belong to no tone, so the outermost outline runs along the
 * slab's own edge and the tones stop where it stops.
 */
export function buildVectorInlay(
  base: Mesh,
  lum: Float64Array,
  w: number,
  h: number,
  tones: readonly number[],
  span: InlaySpan,
): Mesh {
  const box = boxOf(base, BASE_BODY);
  if (!box) return base;

  const cover = coverOf(base, box, w, h, BASE_BODY);
  const perPx = (box.maxX - box.minX) / w;
  const floorPx = (MIN_FEATURE_MM / perPx) ** 2;
  const vec = vectorise(lum, w, h, tones, SMOOTH_PX, cover, floorPx);

  const { positions: p, triangleCount: count, tags } = base;
  const mb = new MeshBuilder(count + 1);

  mb.setTag(BASE_BODY);
  for (let t = 0; t < count; t++) {
    if (tags && tags[t] !== BASE_BODY) continue;
    const o = t * 9;
    mb.addTriangle(
      p[o], p[o + 1], p[o + 2],
      p[o + 3], p[o + 4], p[o + 5],
      p[o + 6], p[o + 7], p[o + 8],
    );
  }

  const place = placeIn(box);
  for (const region of vec.regions) {
    mb.setTag(toneBody(region.tone));
    extrudeRegion(mb, region.rings, place, span.baseZ, span.topZ);
  }

  return mb.finish();
}
