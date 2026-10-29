import { MeshBuilder, type Mesh } from "./mesh";
import { extrudeRegion } from "./extrude";
import { vectorise } from "./vectorise";

/**
 * Pictures put on the holder's frame.
 *
 * An icon is a position, a size and a turn on the front of the holder, in
 * millimetres from its lower left corner as seen from the front. What is made
 * of it is a raised shape standing on the front face: the icons are drawn into
 * a mask, the mask is traced into outlines, and the outlines are given height.
 * The same tracing the inlay uses, so an edge is a straight line between two
 * corners rather than a staircase of pixels.
 */
export type Decoration = {
  /** Which icon, by the name of its file. */
  icon: string;
  /** Centre of the icon, mm from the holder's left edge. */
  x: number;
  /** Centre of the icon, mm up from the holder's bottom edge. */
  y: number;
  /** Longest side of the icon, in mm. */
  size: number;
  /** Turn, in degrees clockwise as seen from the front. */
  rotation: number;
};

/** Pixels in the mask for each millimetre of the holder. */
export const MASK_PX_PER_MM = 6;

/**
 * Smallest feature kept, in mm. Under about this the nozzle has nothing to lay
 * down, and tracing a busy edge leaves specks of it.
 */
const MIN_FEATURE_MM = 0.5;

/**
 * The raised shapes for a mask, as a mesh standing on the front face.
 *
 * @param mask   One where an icon is and nothing else covers it, zero
 *               elsewhere; `w` by `h` pixels covering `widthMm` by `heightMm`.
 * @param baseZ  The front face the shapes stand on.
 * @param height How far they rise.
 */
export function buildRelief(
  mask: Uint8Array,
  w: number,
  h: number,
  widthMm: number,
  heightMm: number,
  baseZ: number,
  height: number,
): Mesh {
  const mb = new MeshBuilder(256);

  let any = false;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) {
      any = true;
      break;
    }
  }
  if (!any || height <= 0) return mb.finish();

  const floorPx = (MIN_FEATURE_MM * MASK_PX_PER_MM) ** 2;
  const lum = new Float64Array(mask.length);
  const vec = vectorise(lum, w, h, [0, 1], 1.2, undefined, floorPx, undefined, 2, mask);

  const region = vec.regions[1];
  if (region && region.rings.length > 0) {
    extrudeRegion(
      mb,
      region.rings,
      (u, v) => ({ x: u * widthMm, y: (1 - v) * heightMm }),
      baseZ,
      baseZ + height,
    );
  }

  return mb.finish();
}
