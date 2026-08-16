import type { BuildContext, ShapeBuildParams, ShapePlugin } from "../core/types";
import type { Mesh } from "../core/mesh";
import { buildRadialMesh, polygonBoundary } from "../core/radial";
import { buildAreaSampler, sampleHeightFiltered } from "../core/sample";
import { radialDensity } from "../core/quality";

const SIDES = 6;

/** Polygons need fewer rings than a circle to look the same. */
const RADIAL_FACTOR = 0.8;

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
    const { widthMm, resolution, quality } = params;

    const q = radialDensity(quality);
    const range = maxT - minT;

    const apothem = widthMm / 2;
    const circumradius = apothem * (2 / Math.sqrt(3));

    const frameSize = Math.max(0, frameMm);
    const innerApothem = Math.max(0, apothem - frameSize);
    const hasFrame = frameSize > 0.001;
    const innerFraction = hasFrame ? innerApothem / apothem : 1;

    const totalRings = Math.max(10, Math.floor(q.radial * RADIAL_FACTOR));
    const perEdge = Math.max(4, Math.floor((resolution * q.angMul) / SIDES));
    const imageRings = hasFrame
      ? Math.floor(totalRings * innerFraction)
      : totalRings;

    const corners = Array.from({ length: SIDES }, (_, s) => {
      const a = (s * Math.PI) / 3;
      return { x: Math.cos(a) * circumradius, y: Math.sin(a) * circumradius };
    });

    const totalW = 2 * circumradius;
    const totalH = 2 * apothem;

    const sampler = buildAreaSampler(heightmap);
    const pxPerMm = heightmap.w / totalW;

    return buildRadialMesh({
      angularCount: SIDES * perEdge,
      imageRings,
      frameRings: totalRings - imageRings,
      innerFraction,
      frameHeight: maxT,

      boundaryAt: polygonBoundary(corners, perEdge),

      heightAt: (x, y, footprintMm) => {
        const u = clamp01((x + circumradius) / totalW);
        const v = clamp01(1 - (y + apothem) / totalH);
        const lum = sampleHeightFiltered(sampler, u, v, 0.5 * footprintMm * pxPerMm);
        return emboss === "back" ? maxT - lum * range : minT + lum * range;
      },
    });
  },
};
