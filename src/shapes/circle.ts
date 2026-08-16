import type {
  BuildContext,
  ShapeBuildParams,
  ShapePlugin,
  Tri,
  Vec3,
} from "../core/types";
import { sampleHeightBilinear } from "../core/sample";
import { qualityParams } from "../core/quality";

function addTri(tris: Tri[], a: Vec3, b: Vec3, c: Vec3) {
  tris.push([a, b, c]);
}

export const CircleShape: ShapePlugin = {
  id: "circle",
  label: "Circle",
  cropRatio: 1.0,

  build: (ctx: BuildContext, params: ShapeBuildParams): Tri[] => {
    const { heightmap, minT, maxT, frameMm, emboss } = ctx;
    const { widthMm, quality } = params;

    const q = qualityParams(quality);
    const tris: Tri[] = [];

    const outerRadius = widthMm / 2;
    const innerRadius = (widthMm - 2 * frameMm) / 2;
    
    // Frame sanity check
    const hasFrame = frameMm > 0.05 && innerRadius > 0;
    const range = maxT - minT;

    function getHeight(x: number, y: number): number {
      // UV mapping
      // Map [-R, R] to [0, 1]
      const u = (x + outerRadius) / (2 * outerRadius);
      const v = (outerRadius - y) / (2 * outerRadius); // Flip Y is correct usually
      
      // FIXED: Use (1 - u) to fix horizontal mirroring
      const lum = sampleHeightBilinear(heightmap, 1 - u, v);
      
      return emboss === "back"
        ? maxT - lum * range
        : minT + lum * range;
    }

    // Resolution settings
    const ANG_STEPS = Math.max(72, Math.floor(heightmap.w * q.angMul));
    const RAD_STEPS = Math.max(10, q.radial);
    
    // Total rings = Litho Rings + Frame Rings
    const TOTAL_RAD_STEPS = RAD_STEPS + (hasFrame ? 5 : 0); 
    
    const layers: Vec3[][] = [];

    for (let r = 0; r <= TOTAL_RAD_STEPS; r++) {
      const row: Vec3[] = [];
      
      // Calculate current radius
      let curR: number;
      let isFrame = false;

      if (hasFrame) {
         if (r <= RAD_STEPS) {
             // Inside lithophane
             curR = (r / RAD_STEPS) * innerRadius;
         } else {
             // Inside frame
             const fr = r - RAD_STEPS;
             const fMax = TOTAL_RAD_STEPS - RAD_STEPS;
             curR = innerRadius + (fr / fMax) * (outerRadius - innerRadius);
             isFrame = true;
         }
      } else {
         curR = (r / TOTAL_RAD_STEPS) * outerRadius;
      }

      for (let a = 0; a < ANG_STEPS; a++) {
        const theta = (a / ANG_STEPS) * Math.PI * 2;
        const x = Math.cos(theta) * curR;
        const y = Math.sin(theta) * curR;
        
        const z = isFrame ? maxT : getHeight(x, y);
        row.push([x, y, z]);
      }
      layers.push(row);
    }

    // Stitch rings
    for (let r = 0; r < TOTAL_RAD_STEPS; r++) {
      for (let a = 0; a < ANG_STEPS; a++) {
        const nextA = (a + 1) % ANG_STEPS;
        
        const t0 = layers[r][a];
        const t1 = layers[r][nextA];
        const b0 = layers[r + 1][a];
        const b1 = layers[r + 1][nextA];

        // Top Surface
        addTri(tris, t0, b0, b1);
        addTri(tris, t0, b1, t1);

        // Bottom Surface (Flat Z=0)
        const t0_bot: Vec3 = [t0[0], t0[1], 0];
        const t1_bot: Vec3 = [t1[0], t1[1], 0];
        const b0_bot: Vec3 = [b0[0], b0[1], 0];
        const b1_bot: Vec3 = [b1[0], b1[1], 0];

        addTri(tris, t0_bot, b1_bot, b0_bot);
        addTri(tris, t0_bot, t1_bot, b1_bot);
      }
    }

    // Outer Wall
    const lastRow = layers[layers.length - 1];
    for (let a = 0; a < ANG_STEPS; a++) {
      const nextA = (a + 1) % ANG_STEPS;
      const topA = lastRow[a];
      const topB = lastRow[nextA];
      const botA: Vec3 = [topA[0], topA[1], 0];
      const botB: Vec3 = [topB[0], topB[1], 0];

      addTri(tris, topA, botB, botA);
      addTri(tris, topA, topB, botB);
    }

    return tris;
  },
};