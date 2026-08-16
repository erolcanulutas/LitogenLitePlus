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
};

export type ShapePlugin = {
  id: string;
  label: string;

  /** Editor crop ratio (W/H). Triangle needs 2/sqrt(3), circle 1, etc. */
  cropRatio: number;

  build: (ctx: BuildContext, params: ShapeBuildParams) => Mesh;
};
