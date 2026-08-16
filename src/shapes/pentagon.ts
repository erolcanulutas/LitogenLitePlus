import type { BuildContext, ShapeBuildParams, ShapePlugin } from "../core/types";
import type { Mesh } from "../core/mesh";
import { buildRadialMesh, polygonBoundary } from "../core/radial";
import { buildAreaSampler, sampleHeightFiltered } from "../core/sample";
import { radialCellMm } from "../core/quality";

const SIDES = 5;
const FRAME_RINGS = 4;

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
    const { widthMm, quality, smoothing, levels, splitZ } = params;

    const range = maxT - minT;

    const R = Math.max(0.01, widthMm) / (2 * COS18);
    const bboxW = 2 * COS18 * R;
    const bboxH = (1 + COS36) * R;
    const apothem = R * COS36;

    const frameSize = Math.max(0, frameMm);
    const innerApothem = apothem - frameSize;
    const hasFrame = frameSize > 0.001 && innerApothem > 0.0001;

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

    const sampler = buildAreaSampler(heightmap);
    const pxPerMm = heightmap.w / bboxW;

    return buildRadialMesh({
      perimeterMm: SIDES * 2 * R * Math.sin(Math.PI / SIDES),
      radiusMm: apothem,
      targetCellMm: radialCellMm(quality),
      innerFraction: hasFrame ? innerApothem / apothem : 1,
      frameRings: hasFrame ? FRAME_RINGS : 0,
      frameHeight: maxT,
      splitZ,

      boundaryAt: polygonBoundary(corners),

      levels,

      lumAt: (x, y, footprintMm) => {
        const u = clamp01((x + bboxW / 2) / bboxW);
        const v = clamp01(1 - (y + bboxH / 2) / bboxH);
        return sampleHeightFiltered(sampler, u, v, smoothing * footprintMm * pxPerMm);
      },

      heightOf: (lum) =>
        emboss === "back" ? maxT - lum * range : minT + lum * range,
    });
  },
};
