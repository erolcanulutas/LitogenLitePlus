import type { BuildContext, ShapeBuildParams, ShapePlugin } from "../core/types";
import type { Mesh } from "../core/mesh";
import { buildRadialMesh } from "../core/radial";
import { sampleHeightBilinear } from "../core/sample";
import { radialDensity } from "../core/quality";

/** Rings used for the flat frame band. It is flat, so a handful is plenty. */
const FRAME_RINGS = 5;

export const CircleShape: ShapePlugin = {
  id: "circle",
  label: "Circle",
  cropRatio: 1.0,

  build: (ctx: BuildContext, params: ShapeBuildParams): Mesh => {
    const { heightmap, minT, maxT, frameMm, emboss } = ctx;
    const { widthMm, quality } = params;

    const q = radialDensity(quality);
    const range = maxT - minT;

    const outerRadius = widthMm / 2;
    const innerRadius = (widthMm - 2 * frameMm) / 2;
    const hasFrame = frameMm > 0.05 && innerRadius > 0;

    const angularCount = Math.max(72, Math.floor(heightmap.w * q.angMul));
    const imageRings = Math.max(10, q.radial);

    return buildRadialMesh({
      angularCount,
      imageRings,
      frameRings: hasFrame ? FRAME_RINGS : 0,
      innerFraction: hasFrame ? innerRadius / outerRadius : 1,
      frameHeight: maxT,

      boundaryAt: (i) => {
        const theta = (i / angularCount) * Math.PI * 2;
        return {
          x: Math.cos(theta) * outerRadius,
          y: Math.sin(theta) * outerRadius,
        };
      },

      heightAt: (x, y) => {
        const u = (x + outerRadius) / (2 * outerRadius);
        const v = (outerRadius - y) / (2 * outerRadius);
        const lum = sampleHeightBilinear(heightmap, u, v);
        return emboss === "back" ? maxT - lum * range : minT + lum * range;
      },
    });
  },
};
