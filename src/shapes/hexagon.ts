import type { BuildContext, ShapeBuildParams, ShapePlugin } from "../core/types";
import type { Mesh } from "../core/mesh";
import { buildRadialMesh, polygonBoundary } from "../core/radial";
import { buildAreaSampler, sampleHeightFiltered } from "../core/sample";
import { radialCellMm } from "../core/quality";

const SIDES = 6;
const FRAME_RINGS = 4;

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export const HexagonShape: ShapePlugin = {
  id: "hexagon",
  label: "Hexagon",
  // widthMm is the flat-to-flat distance, so width/height = 2/sqrt(3).
  cropRatio: 2.0 / Math.sqrt(3),

  build: (ctx: BuildContext, params: ShapeBuildParams): Mesh => {
    const { heightmap, minT, maxT, frameMm, emboss } = ctx;
    const { widthMm, quality, smoothing, levels } = params;

    const range = maxT - minT;

    const apothem = widthMm / 2;
    const circumradius = apothem * (2 / Math.sqrt(3));

    const frameSize = Math.max(0, frameMm);
    const innerApothem = Math.max(0, apothem - frameSize);
    const hasFrame = frameSize > 0.001;

    const corners = Array.from({ length: SIDES }, (_, s) => {
      const a = (s * Math.PI) / 3;
      return { x: Math.cos(a) * circumradius, y: Math.sin(a) * circumradius };
    });

    const totalW = 2 * circumradius;
    const totalH = 2 * apothem;

    const sampler = buildAreaSampler(heightmap);
    const pxPerMm = heightmap.w / totalW;

    return buildRadialMesh({
      // A regular hexagon's side equals its circumradius.
      perimeterMm: SIDES * circumradius,
      radiusMm: apothem,
      targetCellMm: radialCellMm(quality),
      innerFraction: hasFrame ? innerApothem / apothem : 1,
      frameRings: hasFrame ? FRAME_RINGS : 0,
      frameHeight: maxT,

      boundaryAt: polygonBoundary(corners),

      levels,

      lumAt: (x, y, footprintMm) => {
        const u = clamp01((x + circumradius) / totalW);
        const v = clamp01(1 - (y + apothem) / totalH);
        return sampleHeightFiltered(sampler, u, v, smoothing * footprintMm * pxPerMm);
      },

      heightOf: (lum) =>
        emboss === "back" ? maxT - lum * range : minT + lum * range,
    });
  },
};
