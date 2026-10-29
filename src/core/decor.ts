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
 *
 * An icon may reach past the frame. The part over the frame is raised on its
 * face; the part beyond it has nothing to stand on, so it is made a little
 * thicker, reaching back into the frame's thickness, and joined to it along the
 * edge.
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

/** How heights follow the icon's own colours. */
export type ReliefMode = "flat" | "lightHigher" | "darkHigher";

/** Pixels in the mask for each millimetre of the holder. */
export const MASK_PX_PER_MM = 6;

/** How far past the frame an icon may be taken, on every side, in mm. */
export const OVERHANG_MM = 40;

/** How far back into the frame an overhanging part reaches, in mm. */
export const OVERHANG_ROOT_MM = 2;

/** Steps a colour-following relief is made of. */
export const RELIEF_STEPS = 3;

/**
 * Smallest feature kept, in mm. Under about this the nozzle has nothing to lay
 * down, and tracing a busy edge leaves specks of it.
 */
const MIN_FEATURE_MM = 0.5;

/** The share of the full height the lowest step stands at. */
const LOWEST_STEP = 0.4;

/**
 * Height of each step, as a share of the full relief height, lowest tone first.
 *
 * Flat is one step at full height. Following colour, the steps climb from
 * LOWEST_STEP to 1 in the direction the mode names, so even the lowest part
 * stands clear of the face.
 */
export function stepHeights(mode: ReliefMode): number[] {
  if (mode === "flat") return [1];
  const up = Array.from(
    { length: RELIEF_STEPS },
    (_, k) => LOWEST_STEP + ((1 - LOWEST_STEP) * k) / (RELIEF_STEPS - 1),
  );
  // Tones are numbered dark to light.
  return mode === "lightHigher" ? up : up.reverse();
}

/** What a set of icons covers, as pixels of one canvas. */
export type DecorMask = {
  /** Pixels covered by an icon and over the frame's face, outside the window. */
  onFrame: Uint8Array;
  /** Pixels covered by an icon and beyond the frame, above the table. */
  beyond: Uint8Array;
  /** Which colour step each pixel is, dark to light, from 0. */
  steps: Uint8Array;
  w: number;
  h: number;
  /** Where the canvas's left edge and bottom edge are, in holder mm. */
  originX: number;
  originY: number;
  /** What the canvas spans, in mm. */
  spanX: number;
  spanY: number;
};

/**
 * The raised shapes for a mask, as a mesh standing on the front face.
 *
 * @param frontZ  The front face the shapes stand on.
 * @param height  How far they rise at the most.
 */
export function buildRelief(
  mask: DecorMask,
  frontZ: number,
  height: number,
  mode: ReliefMode,
): Mesh {
  const mb = new MeshBuilder(256);
  if (height <= 0) return mb.finish();

  const heights = stepHeights(mode);
  const { w, h } = mask;
  const floorPx = (MIN_FEATURE_MM * MASK_PX_PER_MM) ** 2;
  const lum = new Float64Array(w * h);

  const place = (u: number, v: number) => ({
    x: mask.originX + u * mask.spanX,
    y: mask.originY + (1 - v) * mask.spanY,
  });

  // On the frame the shapes stand on its face; beyond it they start a little
  // way back inside the frame's thickness, so that they are joined to it.
  const layers: [Uint8Array, number][] = [
    [mask.onFrame, frontZ],
    [mask.beyond, frontZ - OVERHANG_ROOT_MM],
  ];

  for (const [where, baseZ] of layers) {
    let any = false;
    for (let i = 0; i < where.length; i++) {
      if (where[i]) {
        any = true;
        break;
      }
    }
    if (!any) continue;

    // The tone of a pixel is its step; a flat relief is all one step.
    const labels = new Uint8Array(w * h);
    if (heights.length > 1) {
      for (let i = 0; i < labels.length; i++) labels[i] = Math.min(heights.length - 1, mask.steps[i]);
    }

    const vec = vectorise(
      lum, w, h, heights.map((_, k) => k), 1.2, where, floorPx, undefined, 2, labels,
    );

    for (const region of vec.regions) {
      if (region.rings.length === 0) continue;
      extrudeRegion(mb, region.rings, place, baseZ, frontZ + height * heights[region.tone]);
    }
  }

  return mb.finish();
}
