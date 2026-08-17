import type { BuildContext, ShapeBuildParams, ShapePlugin } from "../core/types";
import type { Mesh } from "../core/mesh";
import { buildRadialMesh } from "../core/radial";
import { buildAreaSampler, sampleHeightFiltered } from "../core/sample";
import { radialCellMm } from "../core/quality";

/** Rings across the flat frame band. It is flat, so a handful is plenty. */
const FRAME_RINGS = 4;

export const CircleShape: ShapePlugin = {
  id: "circle",
  label: "Circle",
  cropRatio: 1.0,

  build: (ctx: BuildContext, params: ShapeBuildParams): Mesh => {
    const { heightmap, minT, maxT, frameMm, emboss } = ctx;
    const { widthMm, quality, smoothing, levels, splitZs } = params;

    const range = maxT - minT;

    const outerRadius = widthMm / 2;
    const innerRadius = (widthMm - 2 * frameMm) / 2;
    const hasFrame = frameMm > 0.05 && innerRadius > 0;

    const sampler = buildAreaSampler(heightmap);
    const pxPerMm = heightmap.w / (2 * outerRadius);

    return buildRadialMesh({
      perimeterMm: 2 * Math.PI * outerRadius,
      radiusMm: outerRadius,
      targetCellMm: radialCellMm(quality),
      innerFraction: hasFrame ? innerRadius / outerRadius : 1,
      frameRings: hasFrame ? FRAME_RINGS : 0,
      frameHeight: maxT,
      splitZs,

      angularMultiple: 4,

      boundaryAt: (s) => {
        const theta = s * Math.PI * 2;
        return {
          x: Math.cos(theta) * outerRadius,
          y: Math.sin(theta) * outerRadius,
        };
      },

      levels,

      lumAt: (x, y, footprintMm) => {
        const u = (x + outerRadius) / (2 * outerRadius);
        const v = (outerRadius - y) / (2 * outerRadius);
        return sampleHeightFiltered(sampler, u, v, smoothing * footprintMm * pxPerMm);
      },

      heightOf: (lum) =>
        emboss === "back" ? maxT - lum * range : minT + lum * range,
    });
  },
};
