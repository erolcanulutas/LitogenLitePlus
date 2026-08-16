import type { Quality } from "./quality";
import type { Mesh } from "./mesh";

export type EmbossSide = "front" | "back";

/** Ids of the registered shape plugins. */
export type ShapeId = "triangle" | "circle" | "hexagon" | "pentagon";

export type Heightmap = {
  w: number;
  hPx: number;
  h: number[][]; // [y][x] in 0..1
};

export type BuildContext = {
  heightmap: Heightmap; // cropped/resized output of the editor
  minT: number;
  maxT: number;
  frameMm: number;
  emboss: EmbossSide;
};

export type ShapeBuildParams = {
  // common
  minT: number;
  maxT: number;
  frameMm: number;
  emboss: EmbossSide;

  // size (mm)
  widthMm: number;

  // heightmap width; shapes scale their mesh density against it
  resolution: number;

  // global quality preset
  quality: Quality;

  /**
   * Sampling radius as a multiple of the mesh cell, 0.4 to 3.
   *
   * A mesh cell can only place an edge on a cell boundary, so a hard edge in
   * the image lands within half a cell of where it belongs and its outline
   * comes out serrated. Sampling wider than one cell spreads the height change
   * over several cells, turning that near-vertical wall into a ramp the
   * wobble disappears into. It costs no triangles; it costs sharpness.
   *
   * Photos want roughly 1 — their edges are soft already. Logos and line art
   * want 1.5 to 3, where the stair-stepping is what you notice first.
   */
  smoothing: number;

  /**
   * Brightness bands for terraced ("graphic") output, or 0 for a smooth
   * surface.
   *
   * Smooth samples the picture as a continuous heightfield, which is what a
   * photograph wants. Terraced quantises it and cuts the surface along the
   * resulting contours, so edges land exactly where the artwork puts them
   * rather than rounding to the nearest mesh cell — the same treatment the
   * shape outline already gets. That is what line art and logos want.
   */
  levels: number;
};

export type ShapePlugin = {
  id: string;
  label: string;

  /** Editor crop ratio (W/H). Triangle needs 2/sqrt(3), circle 1, etc. */
  cropRatio: number;

  build: (ctx: BuildContext, params: ShapeBuildParams) => Mesh;
};
