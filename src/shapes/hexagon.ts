import type {
  BuildContext,
  ShapeBuildParams,
  ShapePlugin,
  Tri,
  Vec3,
} from "../core/types";
import { sampleHeightBilinear } from "../core/sample";
import { qualityParams } from "../core/quality";

/* -------------------------------------------------
 * Helpers
 * ------------------------------------------------- */
function addTri(tris: Tri[], a: Vec3, b: Vec3, c: Vec3) {
  tris.push([a, b, c]);
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

/* -------------------------------------------------
 * HEXAGON SHAPE PLUGIN (Radial Topology + Correct UV)
 * ------------------------------------------------- */
export const HexagonShape: ShapePlugin = {
  id: "hexagon",
  label: "Hexagon",
  // Flat-to-flat ratio: 2 / sqrt(3)
  cropRatio: 2.0 / Math.sqrt(3),

  build: (ctx: BuildContext, params: ShapeBuildParams): Tri[] => {
    const { heightmap, minT, maxT, frameMm, emboss } = ctx;
    const { widthMm, resolution, quality } = params;

    const q = qualityParams(quality);
    const tris: Tri[] = [];
    const range = maxT - minT;

    /* -------------------------------------------------
     * Geometry Setup
     * ------------------------------------------------- */

    // Flat-to-flat width
    const apothem = widthMm / 2; // a
    const circumradius = apothem * (2 / Math.sqrt(3)); // R
    
    // Frame calculations
    const frameSize = Math.max(0, frameMm);
    const innerApothem = Math.max(0, apothem - frameSize); 
    const hasFrame = frameSize > 0.001;

    /* -------------------------------------------------
     * Sampling Helper
     * ------------------------------------------------- */
    const totalW = 2 * circumradius;
    const totalH = 2 * apothem;

    function getHeightAt(x: number, y: number, isFrame: boolean): number {
      if (isFrame) return maxT;
      
      // Map x,y to UV based on the bounding box of the outer hexagon
      // x: [-R, R], y: [-a, a]
      const u = (x + circumradius) / totalW;
      const v = 1 - (y + apothem) / totalH; // Flip V

      // FIXED: Use (1 - u) to fix horizontal mirroring
      const finalU = clamp(1 - u, 0, 1);
      const finalV = clamp(v, 0, 1);

      const val = sampleHeightBilinear(heightmap, finalU, finalV);
      return emboss === "back" 
        ? maxT - val * range 
        : minT + val * range;
    }

    /* -------------------------------------------------
     * Mesh Generation (Segment by Segment)
     * ------------------------------------------------- */
    
    const SEGMENTS = 6;
    const RADIAL_STEPS = Math.max(10, Math.floor(q.radial * 0.8));
    const STEPS_PER_SEGMENT = Math.max(4, Math.floor((resolution * q.angMul) / 6));

    const layers: Vec3[][] = [];
    
    const imageFraction = innerApothem / apothem; // 0..1
    const splitIndex = Math.floor(RADIAL_STEPS * imageFraction);
    
    const totalRings = RADIAL_STEPS;

    for (let r = 0; r <= totalRings; r++) {
      const row: Vec3[] = [];
      
      let t_radius: number;
      
      if (hasFrame) {
         if (r <= splitIndex) {
            t_radius = splitIndex === 0 ? 0 : (r / splitIndex) * imageFraction;
         } else {
            const frameSteps = totalRings - splitIndex;
            const fr = r - splitIndex;
            t_radius = imageFraction + (fr / frameSteps) * (1 - imageFraction);
         }
      } else {
         t_radius = r / totalRings;
      }
      
      const isRingFrame = hasFrame && (r > splitIndex);

      // Iterate 6 segments
      for (let s = 0; s < SEGMENTS; s++) {
        const a1 = (s * Math.PI) / 3; 
        const a2 = ((s + 1) * Math.PI) / 3;

        const x1_outer = Math.cos(a1) * circumradius;
        const y1_outer = Math.sin(a1) * circumradius;
        const x2_outer = Math.cos(a2) * circumradius;
        const y2_outer = Math.sin(a2) * circumradius;

        for (let i = 0; i < STEPS_PER_SEGMENT; i++) {
          const edgeT = i / STEPS_PER_SEGMENT; // 0..1 along the edge
          
          const edgeX = x1_outer + (x2_outer - x1_outer) * edgeT;
          const edgeY = y1_outer + (y2_outer - y1_outer) * edgeT;
          
          const x = edgeX * t_radius;
          const y = edgeY * t_radius;
          
          const z = getHeightAt(x, y, isRingFrame);
          
          row.push([x, y, z]);
        }
      }
      layers.push(row);
    }

    /* -------------------------------------------------
     * Stitching Triangles
     * ------------------------------------------------- */
    const vertsPerRow = SEGMENTS * STEPS_PER_SEGMENT;

    for (let r = 0; r < totalRings; r++) {
      for (let i = 0; i < vertsPerRow; i++) {
        const nextI = (i + 1) % vertsPerRow;
        
        const t0 = layers[r][i];
        const t1 = layers[r][nextI];
        const b0 = layers[r + 1][i];
        const b1 = layers[r + 1][nextI];

        // Top surface
        addTri(tris, t0, b0, b1);
        addTri(tris, t0, b1, t1);
        
        // Bottom surface (flat z=0)
        const t0_bot: Vec3 = [t0[0], t0[1], 0];
        const t1_bot: Vec3 = [t1[0], t1[1], 0];
        const b0_bot: Vec3 = [b0[0], b0[1], 0];
        const b1_bot: Vec3 = [b1[0], b1[1], 0];

        addTri(tris, t0_bot, b1_bot, b0_bot);
        addTri(tris, t0_bot, t1_bot, b1_bot);
      }
    }

    /* -------------------------------------------------
     * Outer Wall
     * ------------------------------------------------- */
    const lastRowIdx = layers.length - 1;
    const lastRow = layers[lastRowIdx];

    for (let i = 0; i < vertsPerRow; i++) {
      const nextI = (i + 1) % vertsPerRow;
      
      const topA = lastRow[i];
      const topB = lastRow[nextI];
      
      const botA: Vec3 = [topA[0], topA[1], 0];
      const botB: Vec3 = [topB[0], topB[1], 0];

      addTri(tris, topA, botB, botA);
      addTri(tris, topA, topB, botB);
    }

    return tris;
  },
};