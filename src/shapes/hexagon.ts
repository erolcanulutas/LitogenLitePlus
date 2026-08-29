import { squashLum } from "../core/squash";
import { bandCuts } from "../core/terrace";
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
  // Corners sit left and right, so the bounding box is 2/sqrt(3) wider than
  // it is tall.
  cropRatio: 2.0 / Math.sqrt(3),

  build: (ctx: BuildContext, params: ShapeBuildParams): Mesh => {
    const { heightmap, minT, maxT, frameMm, emboss } = ctx;
    const { widthMm, quality, smoothing, levels, splitZs, toneZs, toneCuts, squash } = params;

    const range = maxT - minT;

    // widthMm is the leftmost-to-rightmost distance, matching the label in the
    // panel and every other shape. For a hexagon that is corner to corner, so
    // it is the circumdiameter — not the flat-to-flat distance this used to
    // take it for, which came out 2/sqrt(3) (15.5%) too wide.
    const circumradius = widthMm / 2;
    const apothem = circumradius * (Math.sqrt(3) / 2);

    const frameSize = Math.max(0, frameMm);
    const innerApothem = Math.max(0, apothem - frameSize);
    const hasFrame = frameSize > 0.001;

    const corners = Array.from({ length: SIDES }, (_, s) => {
      const a = (s * Math.PI) / 3;
      return { x: Math.cos(a) * circumradius, y: Math.sin(a) * circumradius };
    });

    const totalW = 2 * circumradius;
    const totalH = 2 * apothem;

    const cuts = bandCuts(levels, toneCuts);
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
      splitZs,

      angularMultiple: SIDES,
      boundaryAt: polygonBoundary(corners),

      levels,
      toneZs,
      toneCuts,

      lumAt: (x, y, footprintMm) => {
        const u = clamp01((x + circumradius) / totalW);
        const v = clamp01(1 - (y + apothem) / totalH);
        // Squeezed first, so everything downstream — the vertex heights, the
        // bands, the contour solve — reads one field and reads it the same.
        return squashLum(
          squash,
          u,
          v,
          sampleHeightFiltered(sampler, u, v, smoothing * footprintMm * pxPerMm),
          cuts,
        );
      },

      heightOf: (lum) =>
        emboss === "back" ? maxT - lum * range : minT + lum * range,
    });
  },
};
