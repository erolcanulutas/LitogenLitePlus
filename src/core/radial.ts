import { MeshBuilder, type Mesh } from "./mesh";

/**
 * Shared generator for every shape built out of concentric rings: circle,
 * hexagon, pentagon. They only differ in where the outer boundary is, so that
 * is the one thing a caller has to supply.
 *
 * Two things this fixes compared to the per-shape copies it replaces:
 *
 * 1. The innermost ring used to sit at radius 0, which collapsed all of its
 *    vertices onto the same point and emitted a fan of zero-area triangles.
 *    The centre is now a single apex vertex.
 *
 * 2. The flat underside used to be triangulated at the same density as the
 *    detailed top surface — half of every mesh was spent describing a plane.
 *    It is now one fan from the centre, which is all a flat convex face needs.
 *
 * Winding is outward everywhere: the top faces +Z, the base faces -Z, and the
 * rim faces away from the axis.
 */
export type RadialSpec = {
  /** Vertices per ring. */
  angularCount: number;

  /** Rings spanning the image area, from the centre out to the frame. */
  imageRings: number;

  /** Extra rings spanning the flat frame band. Zero when there is no frame. */
  frameRings: number;

  /** Radius fraction (0..1) at which the frame band starts. 1 means no frame. */
  innerFraction: number;

  /** Outer boundary, sampled counter-clockwise for i in [0, angularCount). */
  boundaryAt: (i: number) => { x: number; y: number };

  /**
   * Surface height above z=0 at a point inside the image area.
   *
   * `footprintMm` is how much of the surface this one vertex stands in for —
   * the larger side of its cell. The shape passes it to the area sampler so
   * detail finer than the mesh gets averaged in rather than aliased.
   */
  heightAt: (x: number, y: number, footprintMm: number) => number;

  /** Flat height held across the whole frame band. */
  frameHeight: number;
};

export function buildRadialMesh(spec: RadialSpec): Mesh {
  const {
    angularCount: n,
    imageRings,
    frameRings,
    innerFraction,
    boundaryAt,
    heightAt,
    frameHeight,
  } = spec;

  const totalRings = imageRings + frameRings;

  // Radius fraction of ring r. Ring 0 is the centre, ring totalRings the rim.
  const ringT = (r: number): number => {
    if (r <= imageRings) {
      return imageRings === 0 ? 0 : (r / imageRings) * innerFraction;
    }
    return innerFraction + ((r - imageRings) / frameRings) * (1 - innerFraction);
  };

  const ringIsFrame = (r: number): boolean => frameRings > 0 && r > imageRings;

  /** Ring spacing in t units, centred on ring r. */
  const ringDt = (r: number): number => {
    if (totalRings <= 0) return 1;
    if (r <= 0) return ringT(1) - ringT(0);
    if (r >= totalRings) return ringT(totalRings) - ringT(totalRings - 1);
    return (ringT(r + 1) - ringT(r - 1)) / 2;
  };

  // Boundary direction vectors, evaluated once and scaled per ring.
  const bx = new Float64Array(n);
  const by = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = boundaryAt(i);
    bx[i] = p.x;
    by[i] = p.y;
  }

  // Cell metrics at full radius: how far out each vertex sits, and how long
  // the boundary step next to it is. Scaled by t / dt to get the local cell.
  const radius = new Float64Array(n);
  const segLen = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    radius[i] = Math.hypot(bx[i], by[i]);
    segLen[i] = Math.hypot(bx[j] - bx[i], by[j] - by[i]);
  }

  // apex fan + (totalRings-1) quad strips + base fan + rim
  const expected = n * (1 + 2 * (totalRings - 1) + 1 + 2);
  const mb = new MeshBuilder(expected);

  const ringZ = (r: number, t: number, out: Float64Array) => {
    if (ringIsFrame(r)) {
      out.fill(frameHeight);
      return;
    }
    const dt = ringDt(r);
    for (let i = 0; i < n; i++) {
      // Cell is `radius * dt` deep and `segLen * t` wide; filter by the larger
      // side so the coarse direction never aliases.
      const footprint = Math.max(radius[i] * dt, segLen[i] * t);
      out[i] = heightAt(bx[i] * t, by[i] * t, footprint);
    }
  };

  let innerT = ringT(1);
  let innerZ = new Float64Array(n);
  let outerZ = new Float64Array(n);
  ringZ(1, innerT, innerZ);

  // --- centre apex fan -------------------------------------------------
  const apexZ = ringIsFrame(0)
    ? frameHeight
    : heightAt(0, 0, radius[0] * ringDt(0));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    mb.addTriangle(
      0, 0, apexZ,
      bx[i] * innerT, by[i] * innerT, innerZ[i],
      bx[j] * innerT, by[j] * innerT, innerZ[j],
    );
  }

  // --- top surface, ring by ring ---------------------------------------
  for (let r = 1; r < totalRings; r++) {
    const outerT = ringT(r + 1);
    ringZ(r + 1, outerT, outerZ);

    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      mb.addQuad(
        bx[i] * innerT, by[i] * innerT, innerZ[i],
        bx[i] * outerT, by[i] * outerT, outerZ[i],
        bx[j] * outerT, by[j] * outerT, outerZ[j],
        bx[j] * innerT, by[j] * innerT, innerZ[j],
      );
    }

    innerT = outerT;
    const swap = innerZ;
    innerZ = outerZ;
    outerZ = swap;
  }

  // innerT / innerZ now describe the rim ring.
  const rimT = innerT;
  const rimZ = innerZ;

  // --- flat base, one fan from the centre -------------------------------
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    mb.addTriangle(
      0, 0, 0,
      bx[j] * rimT, by[j] * rimT, 0,
      bx[i] * rimT, by[i] * rimT, 0,
    );
  }

  // --- rim wall ----------------------------------------------------------
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    mb.addQuad(
      bx[i] * rimT, by[i] * rimT, rimZ[i],
      bx[i] * rimT, by[i] * rimT, 0,
      bx[j] * rimT, by[j] * rimT, 0,
      bx[j] * rimT, by[j] * rimT, rimZ[j],
    );
  }

  return mb.finish();
}

/**
 * Boundary sampler for a regular polygon: walks the outline edge by edge so
 * that vertices land evenly along the perimeter rather than evenly in angle.
 *
 * @param corners Polygon corners, counter-clockwise.
 * @param perEdge Samples taken along each edge.
 */
export function polygonBoundary(
  corners: { x: number; y: number }[],
  perEdge: number,
): (i: number) => { x: number; y: number } {
  const sides = corners.length;
  return (i: number) => {
    const side = Math.floor(i / perEdge) % sides;
    const t = (i % perEdge) / perEdge;
    const a = corners[side];
    const b = corners[(side + 1) % sides];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };
}
