import type { ToneLabels } from "./labels";
import type { InlaySpan } from "./inlay";
import type { BandSquash } from "./squash";
import type { Quality } from "./quality";
import type { Mesh } from "./mesh";

export type EmbossSide = "front" | "back";

/** Ids of the registered shape plugins. */
export type ShapeId =
  | "triangle"
  | "circle"
  | "hexagon"
  | "pentagon"
  | "rectangle";

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

  /**
   * Height in mm.
   *
   * Every shape but the rectangle fixes its proportions and derives this from
   * widthMm itself, so they ignore it. The rectangle takes whatever the
   * editor's crop box was dragged to.
   */
  heightMm: number;

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

  /**
   * Surface height in mm for each brightness band, index 0 being the darkest
   * and so the thickest. Empty means the even spacing across minT..maxT that
   * the band count implies.
   *
   * Exposed because the thickness of a tone is what decides which colour band
   * it ends inside, so lining the two up by hand is the only way to get a
   * given tone to come out a given colour.
   */
  toneZs: readonly number[];

  /**
   * Brightness boundaries between the tones, ascending; one fewer than there
   * are tones. Empty falls back to dividing the range evenly.
   */
  toneCuts: readonly number[];

  /**
   * Where a band is only the ramp between its neighbours and should be
   * squeezed shut. See core/squash.ts.
   */
  squash: BandSquash | null;

  /**
   * Build a flat inlay between these heights instead of a relief: the top is
   * one height everywhere and the tones become bodies side by side in the same
   * layers. Null for a relief. See core/inlay.ts.
   */
  inlay: InlaySpan | null;

  /**
   * The picture as tone numbers, for the inlay. Reading tones off brightness
   * cannot help putting a tone between two others along their shared edge;
   * see core/labels.ts.
   */
  labels: ToneLabels | null;

  /**
   * Heights the model will later be cut at for a colour split, ascending.
   *
   * The generator puts a vertex ring on the rim wall at each one so the cuts
   * run along real edges. See core/wall.ts.
   */
  splitZs: readonly number[];
};

export type ShapePlugin = {
  id: string;
  label: string;

  /** Editor crop ratio (W/H). Triangle needs 2/sqrt(3), circle 1, etc. */
  cropRatio: number;

  /**
   * When set, `cropRatio` is only a starting point: the editor lets the crop
   * box be dragged to any proportions and the shape is built to match.
   */
  freeRatio?: boolean;

  build: (ctx: BuildContext, params: ShapeBuildParams) => Mesh;
};
