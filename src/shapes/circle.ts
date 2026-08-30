import { isRamp, squashLum } from "../core/squash";
import { bandOfLum } from "../core/terrace";
import { bandCuts } from "../core/terrace";
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
    const { widthMm, quality, smoothing, levels, splitZs, toneZs, toneCuts, squash, inlay, vector } = params;

    const range = maxT - minT;

    const outerRadius = widthMm / 2;
    const innerRadius = (widthMm - 2 * frameMm) / 2;
    const hasFrame = frameMm > 0.05 && innerRadius > 0 && !inlay;

    const cuts = bandCuts(levels, toneCuts);
    const sampler = buildAreaSampler(heightmap);

    /**
     * Which tone a point is, as a number.
     *
     * Read off the same field the surface is built from, so the tone and the
     * boundary between tones agree. Taking it from a map of pixels instead
     * puts the two at odds — the map steps along the grid while the boundary
     * is solved against the field — and the edge comes out ragged where they
     * disagree.
     */
    const toneAt = (x: number, y: number): number => {
      const uu = (x + outerRadius) / (2 * outerRadius);
      const vv = (outerRadius - y) / (2 * outerRadius);
      const l = squashLum(
        squash,
        uu,
        vv,
        sampleHeightFiltered(sampler, uu, vv, smoothing * radialCellMm(quality) * pxPerMm),
        cuts,
      );
      const k = bandOfLum(l, cuts);
      if (k > 0 && k < levels - 1 && isRamp(squash, uu, vv, k)) {
        return l - cuts[k - 1] < cuts[k] - l ? k - 1 : k + 1;
      }
      return k;
    };
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
      toneZs,
      toneCuts,
      inlay: inlay ?? undefined,
      toneAt: vector ? toneAt : undefined,

      lumAt: (x, y, footprintMm) => {
        const u = (x + outerRadius) / (2 * outerRadius);
        const v = (outerRadius - y) / (2 * outerRadius);
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
