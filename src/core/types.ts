import type { Quality } from "./quality";

export type Vec3 = [number, number, number];

export type Tri = [Vec3, Vec3, Vec3];

export type EmbossSide = "front" | "back";

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

  // quality: mesh density hint
  resolution: number;

  // global quality preset
  quality: Quality;
};

export type ShapePlugin = {
  id: string;
  label: string;

  // editor crop ratio (W/H). triangle needs 2/sqrt(3), circle 1, etc.
  cropRatio: number;

  // build triangles
  build: (ctx: BuildContext, params: ShapeBuildParams) => Tri[];
};
