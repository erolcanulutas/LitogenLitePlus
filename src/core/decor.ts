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
 * An icon may reach past the frame, or over its window. The part over the
 * frame is raised on its face; a part with nothing under it has nothing to
 * stand on, so it is made thicker, reaching back into the frame's front layer,
 * and joined to it along the edge. It never goes further back than that layer,
 * so it cannot pass behind the face the picture rests against.
 *
 * An icon can instead be cut clean through the frame, so light shows through
 * its shape. A cut that would leave a piece of the frame floating — the inside
 * of an O — is joined back to the rest by a narrow bridge.
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
  /** Cut clean through the frame instead of being raised on it. */
  cut?: boolean;
};

type Rect = { x0: number; x1: number; y0: number; y1: number };

/** What the decorations need to know about the holder they are on. */
export type DecorGeom = {
  /** The frame's width and height, in mm. */
  W: number;
  H: number;
  /** Radius of the frame's outer corners. */
  corner: number;
  /** The window the picture shows through, and the pocket behind it. */
  window: Rect;
  pocket: Rect;
  /** Height of the rail the legs stand on, below which nothing is cut. */
  rail: number;
  /** The front face, and how thick the layer in front of the picture is. */
  frontZ: number;
  lip: number;
};

/** How heights follow the icon's own colours. */
export type ReliefMode = "flat" | "lightHigher" | "darkHigher";

/** Pixels in the mask for each millimetre of the holder. */
export const MASK_PX_PER_MM = 6;

/** How far past the frame an icon may be taken, on every side, in mm. */
export const OVERHANG_MM = 40;

/** How far a raised shape sinks into the face it stands on, so the two overlap, in mm. */
const EMBED_MM = 0.3;

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
  /** Pixels covered by an icon with nothing under it: past the frame, or over its window. */
  beyond: Uint8Array;
  /** Pixels to cut clean through the frame, after bridging what would float. */
  cutOut: Uint8Array;
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
 * @param rootDepth  How far back from the face a part with nothing under it
 *                   starts: the thickness of the frame's front layer.
 */
export function buildRelief(
  mask: DecorMask,
  frontZ: number,
  height: number,
  mode: ReliefMode,
  rootDepth: number,
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

  // On the frame the shapes stand on its face; with nothing under them they
  // start back in the front layer, so that they are joined to the frame.
  const layers: [Uint8Array, number][] = [
    [mask.onFrame, frontZ - EMBED_MM],
    [mask.beyond, frontZ - rootDepth],
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

/**
 * The outlines of the cuts, as closed loops in the frame's own millimetres.
 *
 * Only outer outlines: a cut is never allowed to leave an island inside it, so
 * there are no holes to speak of.
 */
export function cutLoops(mask: DecorMask): [number, number][][] {
  let any = false;
  for (let i = 0; i < mask.cutOut.length; i++) {
    if (mask.cutOut[i]) {
      any = true;
      break;
    }
  }
  if (!any) return [];

  const { w, h } = mask;
  const floorPx = (MIN_FEATURE_MM * MASK_PX_PER_MM) ** 2;
  const vec = vectorise(
    new Float64Array(w * h), w, h, [0, 1], 1.2, undefined, floorPx, undefined, 2, mask.cutOut,
  );

  const loops: [number, number][][] = [];
  for (const ring of vec.regions[1]?.rings ?? []) {
    if (ring.area <= 0 || ring.x.length < 3) continue;
    const loop: [number, number][] = [];
    for (let i = 0; i < ring.x.length; i++) {
      loop.push([
        mask.originX + ring.x[i] * mask.spanX,
        mask.originY + (1 - ring.y[i]) * mask.spanY,
      ]);
    }
    loops.push(clean(loop));
  }
  return loops.filter((l) => l.length >= 3);
}

/**
 * A loop with nothing in it the triangulator would drop.
 *
 * Triangulating a face leaves out repeated points and points on a straight run,
 * so a wall built on every point of the loop would have vertices the face does
 * not, and a seam would open along each. The loop is given only the points that
 * both will keep.
 */
function clean(loop: [number, number][]): [number, number][] {
  let pts = loop;
  for (let pass = 0; pass < 4; pass++) {
    const next: [number, number][] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = next.length > 0 ? next[next.length - 1] : pts[(i + pts.length - 1) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) continue;
      const turn = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      const run = Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(c[0] - b[0], c[1] - b[1]);
      if (run > 0 && Math.abs(turn) / run < 1e-6) continue;
      next.push(b);
    }
    if (next.length === pts.length) break;
    pts = next;
  }
  return pts;
}
