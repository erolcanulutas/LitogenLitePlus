import type { BuildContext, ShapeBuildParams, ShapePlugin } from "../core/types";
import type { Mesh } from "../core/mesh";
import { buildRadialMesh, polygonBoundary } from "../core/radial";
import { sampleHeightBilinear } from "../core/sample";
import { radialDensity } from "../core/quality";

const SIDES = 5;
const RADIAL_FACTOR = 0.8;

const COS18 = Math.cos(Math.PI / 10);
const COS36 = Math.cos(Math.PI / 5);

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Regular pentagon, flat edge at the bottom.
 *
 * widthMm is the bounding-box width (leftmost to rightmost point), which for
 * this orientation is 2·cos18°·R. The outline is bbox-centred so it lines up
 * with the crop the editor draws.
 */
export const PentagonShape: ShapePlugin = {
  id: "pentagon",
  label: "Pentagon",
  cropRatio: (2 * COS18) / (1 + COS36),

  build: (ctx: BuildContext, params: ShapeBuildParams): Mesh => {
    const { heightmap, minT, maxT, frameMm, emboss } = ctx;
    const { widthMm, resolution, quality } = params;

    const q = radialDensity(quality);
    const range = maxT - minT;

    const R = Math.max(0.01, widthMm) / (2 * COS18);
    const bboxW = 2 * COS18 * R;
    const bboxH = (1 + COS36) * R;
    const apothem = R * COS36;

    const frameSize = Math.max(0, frameMm);
    const innerApothem = apothem - frameSize;
    const hasFrame = frameSize > 0.001 && innerApothem > 0.0001;
    const innerFraction = hasFrame ? innerApothem / apothem : 1;

    const totalRings = Math.max(10, Math.floor(q.radial * RADIAL_FACTOR));
    const perEdge = Math.max(4, Math.floor((resolution * q.angMul) / SIDES));
    const imageRings = hasFrame
      ? Math.floor(totalRings * innerFraction)
      : totalRings;

    // Vertex-up rotated by 36° puts one edge flat along the bottom.
    const theta0 = -Math.PI / 2 + Math.PI / SIDES;
    const raw = Array.from({ length: SIDES }, (_, k) => {
      const theta = theta0 + (k * 2 * Math.PI) / SIDES;
      return { x: Math.cos(theta) * R, y: Math.sin(theta) * R };
    });

    // Re-centre on the bounding box, matching ImageEditor's outline.
    const xs = raw.map((p) => p.x);
    const ys = raw.map((p) => p.y);
    const offX = (Math.min(...xs) + Math.max(...xs)) / 2;
    const offY = (Math.min(...ys) + Math.max(...ys)) / 2;
    const corners = raw.map((p) => ({ x: p.x - offX, y: p.y - offY }));

    return buildRadialMesh({
      angularCount: SIDES * perEdge,
      imageRings,
      frameRings: totalRings - imageRings,
      innerFraction,
      frameHeight: maxT,

      boundaryAt: polygonBoundary(corners, perEdge),

      heightAt: (x, y) => {
        const u = clamp01((x + bboxW / 2) / bboxW);
        const v = clamp01(1 - (y + bboxH / 2) / bboxH);
        const lum = sampleHeightBilinear(heightmap, u, v);
        return emboss === "back" ? maxT - lum * range : minT + lum * range;
      },
    });
  },
};
