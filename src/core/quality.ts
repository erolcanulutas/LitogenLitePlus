export type Quality = "draft" | "normal" | "high";

/**
 * Mesh density presets.
 *
 * These used to be a single table that the triangle plugin quietly remapped:
 * picking "High" on a triangle actually built the "Normal" mesh, and the
 * shared table's real "high" row was unreachable. The remap existed for a good
 * reason — the two families of shapes scale completely differently — but it
 * meant the label in the UI did not describe what you got.
 *
 * So there are two tables now, one per family, and neither is remapped at
 * runtime. The numbers reproduce what each shape produced before.
 */

export type RadialDensity = {
  /** Ring vertex count, as a multiple of the heightmap width. */
  angMul: number;
  /** Number of rings from the centre to the rim. */
  radial: number;
};

/**
 * Circle, hexagon and pentagon. Triangle count grows linearly with each of
 * these, so the presets can afford to be generous.
 */
export function radialDensity(q: Quality): RadialDensity {
  switch (q) {
    case "draft":
      return { angMul: 0.8, radial: 80 };
    case "high":
      return { angMul: 2.8, radial: 360 };
    case "normal":
    default:
      return { angMul: 1.4, radial: 180 };
  }
}

export type TriangleDensity = {
  /** Barycentric subdivisions per side, as a multiple of the heightmap width. */
  subdivMul: number;
};

/**
 * Triangle subdivides in both barycentric directions at once, so its triangle
 * count grows with the *square* of this number. It needs a much flatter curve
 * than the radial shapes to land at a comparable file size.
 */
export function triangleDensity(q: Quality): TriangleDensity {
  switch (q) {
    case "draft":
      return { subdivMul: 0.45 };
    case "high":
      return { subdivMul: 1.4 };
    case "normal":
    default:
      return { subdivMul: 0.8 };
  }
}
