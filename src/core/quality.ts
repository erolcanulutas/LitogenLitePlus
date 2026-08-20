export type Quality = "draft" | "normal" | "high";

/**
 * Mesh density, expressed as the target size of one surface cell in
 * millimetres.
 *
 * This used to be abstract multipliers against the heightmap width, which had
 * two problems: the number meant nothing physical, and the triangle plugin
 * quietly remapped the table so "High" on a triangle built the "Normal" mesh.
 * A length in mm can be reasoned about directly — compare it against the
 * 0.4mm nozzle and the 0.2mm layer height and you know whether it is worth
 * paying for.
 *
 * The two families still need separate numbers, but for a real reason rather
 * than a hidden remap: a barycentric grid covers area with N^2 triangles while
 * a ring mesh needs 2*pi*(R/cell)^2, so the same cell size costs differently.
 * The values below keep each shape near the file size it had before.
 */

/** Circle, hexagon, pentagon. */
export function radialCellMm(q: Quality): number {
  switch (q) {
    case "draft":
      return 0.31;
    case "high":
      return 0.078;
    case "normal":
    default:
      return 0.156;
  }
}

/**
 * Rectangle, which fills a plain grid.
 *
 * A grid costs 2*(W/c)*(H/c) triangles against a ring mesh's 2*pi*(R/c)^2 —
 * within a quarter of each other over the same footprint, so the radial
 * numbers carry over rather than earning a table of their own.
 */
export function gridCellMm(q: Quality): number {
  return radialCellMm(q);
}

/** Triangle, which subdivides barycentrically. */
export function triangleCellMm(q: Quality): number {
  switch (q) {
    case "draft":
      return 0.193;
    case "high":
      return 0.062;
    case "normal":
    default:
      return 0.108;
  }
}
