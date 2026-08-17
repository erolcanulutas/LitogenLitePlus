import { MeshBuilder, type Mesh } from "./mesh";
import { emitTerracedTriangle } from "./terrace";
import { emitWallColumn } from "./wall";

/**
 * Shared generator for every shape built out of concentric rings: circle,
 * hexagon, pentagon. They only differ in where the outer boundary is, so that
 * is the one thing a caller has to supply.
 *
 * Rings carry a vertex count proportional to their own circumference, so cells
 * stay roughly square from the centre out. A fixed count per ring — which is
 * what this used to do — spends the same number of vertices on a 1mm ring as
 * on a 40mm one, making the inner rings up to 40x finer than they need to be
 * while the radial direction stays coarse.
 *
 * Because neighbouring rings hold different vertex counts, the strip between
 * them is zippered rather than stitched as quads: whichever ring is behind in
 * angle advances next. That keeps the surface closed with no T-junctions for
 * any pair of counts.
 *
 * Winding is outward everywhere: the top faces +Z, the base faces -Z, and the
 * rim faces away from the axis.
 */
export type RadialSpec = {
  /** Length once around the outer boundary, in mm. */
  perimeterMm: number;

  /** Representative centre-to-boundary distance (radius / apothem), in mm. */
  radiusMm: number;

  /** Desired cell size, in mm. Drives both ring count and vertices per ring. */
  targetCellMm: number;

  /** Radius fraction (0..1) at which the frame band starts. 1 means no frame. */
  innerFraction: number;

  /** Rings across the flat frame band. It is flat, so a handful is plenty. */
  frameRings: number;

  /** Outer boundary at parameter s in [0, 1) around the outline. */
  boundaryAt: (s: number) => { x: number; y: number };

  /**
   * Brightness (0..1) at a point inside the image area.
   *
   * `footprintMm` is how much surface this one vertex stands in for — the
   * larger side of its cell. The shape passes it to the area sampler so detail
   * finer than the mesh gets averaged in rather than aliased.
   */
  lumAt: (x: number, y: number, footprintMm: number) => number;

  /** Brightness -> surface height above z=0, in mm. */
  heightOf: (lum: number) => number;

  /**
   * Brightness bands for terraced output, or 0 for a smooth surface.
   *
   * Smooth is right for photographs. Terraced is right for line art: it cuts
   * the surface along the picture's own contours so edges land exactly where
   * the artwork puts them instead of rounding to the nearest cell.
   */
  levels: number;

  /** Flat height held across the whole frame band. */
  frameHeight: number;

  /**
   * Heights the model will later be cut at for a colour split, ascending.
   *
   * The rim wall gets a vertex ring at each one so the cuts land on existing
   * vertices. See core/wall.ts for why that matters.
   */
  splitZs: readonly number[];
};

/** Smallest ring worth emitting; below this the centre fan takes over. */
const MIN_RING_VERTS = 8;

/**
 * Ceiling on triangles, so an oversized print cannot ask for a mesh that
 * exhausts memory. Cell size is absolute, so cost grows with print area — a
 * 300mm panel at the finest preset would otherwise run to tens of millions of
 * triangles. Past this the cell is relaxed instead.
 */
const MAX_TRIANGLES = 4_000_000;

export function buildRadialMesh(spec: RadialSpec): Mesh {
  const {
    perimeterMm,
    radiusMm,
    innerFraction,
    frameRings,
    boundaryAt,
    lumAt,
    heightOf,
    levels,
    frameHeight,
    splitZs,
  } = spec;

  let targetCellMm = spec.targetCellMm;
  const estimated = 2 * Math.PI * (radiusMm / targetCellMm) ** 2;
  if (estimated > MAX_TRIANGLES) {
    targetCellMm *= Math.sqrt(estimated / MAX_TRIANGLES);
  }

  const imageRings = Math.max(
    4,
    Math.round((radiusMm * innerFraction) / targetCellMm),
  );
  const totalRings = imageRings + frameRings;

  const terraced = levels >= 2;
  /** Height of a whole band, taken at its middle. */
  const bandHeight = (band: number) => heightOf((band + 0.5) / levels);
  const heightForLum = (l: number) =>
    terraced
      ? bandHeight(Math.max(0, Math.min(levels - 1, Math.floor(l * levels))))
      : heightOf(l);

  // Radius fraction of ring r. Ring 0 is the centre, ring totalRings the rim.
  const ringT = (r: number): number => {
    if (r <= imageRings) return (r / imageRings) * innerFraction;
    return innerFraction + ((r - imageRings) / frameRings) * (1 - innerFraction);
  };

  const ringIsFrame = (r: number): boolean => frameRings > 0 && r > imageRings;

  /** Ring spacing in t units, centred on ring r. */
  const ringDt = (r: number): number => {
    if (r <= 0) return ringT(1) - ringT(0);
    if (r >= totalRings) return ringT(totalRings) - ringT(totalRings - 1);
    return (ringT(r + 1) - ringT(r - 1)) / 2;
  };

  /** Vertices on ring r: enough to keep the step along it near the target. */
  const ringVerts = (r: number): number =>
    Math.max(
      MIN_RING_VERTS,
      Math.round((perimeterMm * ringT(r)) / targetCellMm),
    );

  const maxVerts = ringVerts(totalRings);

  let inX = new Float64Array(maxVerts);
  let inY = new Float64Array(maxVerts);
  let inZ = new Float64Array(maxVerts);
  let inL = new Float64Array(maxVerts);
  let outX = new Float64Array(maxVerts);
  let outY = new Float64Array(maxVerts);
  let outZ = new Float64Array(maxVerts);
  let outL = new Float64Array(maxVerts);

  const fillRing = (
    r: number,
    X: Float64Array,
    Y: Float64Array,
    Z: Float64Array,
    L: Float64Array,
  ): number => {
    const n = ringVerts(r);
    const t = ringT(r);
    const flat = ringIsFrame(r);
    const dt = ringDt(r);
    const angularStep = (perimeterMm * t) / n;

    for (let i = 0; i < n; i++) {
      const p = boundaryAt(i / n);
      const x = p.x * t;
      const y = p.y * t;
      X[i] = x;
      Y[i] = y;

      if (flat) {
        Z[i] = frameHeight;
        L[i] = -1;
      } else {
        // Cell is `radius * dt` deep and `segLen * t` wide; filter by the
        // larger side so the coarse direction never aliases.
        const radialStep = Math.hypot(p.x, p.y) * dt;
        const lum = lumAt(x, y, Math.max(radialStep, angularStep));
        L[i] = lum;
        Z[i] = heightForLum(lum);
      }
    }
    return n;
  };

  // Two per vertex across the strips, plus base and rim. Terracing adds cuts,
  // so leave it headroom.
  let estimate = 0;
  for (let r = 1; r <= totalRings; r++) estimate += 2 * ringVerts(r);
  estimate += 3 * ringVerts(totalRings);
  const mb = new MeshBuilder(terraced ? Math.round(estimate * 1.4) : estimate);

  /** Smooth or terraced, depending on the mode and whether the frame is involved. */
  const emitSurface = (
    x0: number, y0: number, z0: number, l0: number,
    x1: number, y1: number, z1: number, l1: number,
    x2: number, y2: number, z2: number, l2: number,
  ) => {
    if (terraced && l0 >= 0 && l1 >= 0 && l2 >= 0) {
      emitTerracedTriangle(mb, x0, y0, l0, x1, y1, l1, x2, y2, l2, levels, bandHeight);
    } else {
      mb.addTriangle(x0, y0, z0, x1, y1, z1, x2, y2, z2);
    }
  };

  let innerN = fillRing(1, inX, inY, inZ, inL);

  // --- centre apex fan ---------------------------------------------------
  const apexIsFrame = ringIsFrame(0);
  const apexLum = apexIsFrame ? -1 : lumAt(0, 0, radiusMm * ringDt(0));
  const apexZ = apexIsFrame ? frameHeight : heightForLum(apexLum);

  for (let i = 0; i < innerN; i++) {
    const j = (i + 1) % innerN;
    emitSurface(
      0, 0, apexZ, apexLum,
      inX[i], inY[i], inZ[i], inL[i],
      inX[j], inY[j], inZ[j], inL[j],
    );
  }

  // --- top surface, ring to ring -----------------------------------------
  for (let r = 1; r < totalRings; r++) {
    const outerN = fillRing(r + 1, outX, outY, outZ, outL);

    // Zipper: advance whichever ring is behind in angle. Emits innerN + outerN
    // triangles and leaves no gaps for any pair of counts.
    let i = 0;
    let j = 0;
    while (i < innerN || j < outerN) {
      const ii = i % innerN;
      const jj = j % outerN;
      const takeInner =
        j >= outerN || (i < innerN && (i + 1) / innerN <= (j + 1) / outerN);

      if (takeInner) {
        const i2 = (i + 1) % innerN;
        emitSurface(
          inX[ii], inY[ii], inZ[ii], inL[ii],
          outX[jj], outY[jj], outZ[jj], outL[jj],
          inX[i2], inY[i2], inZ[i2], inL[i2],
        );
        i++;
      } else {
        const j2 = (j + 1) % outerN;
        emitSurface(
          inX[ii], inY[ii], inZ[ii], inL[ii],
          outX[jj], outY[jj], outZ[jj], outL[jj],
          outX[j2], outY[j2], outZ[j2], outL[j2],
        );
        j++;
      }
    }

    let t = inX; inX = outX; outX = t;
    t = inY; inY = outY; outY = t;
    t = inZ; inZ = outZ; outZ = t;
    t = inL; inL = outL; outL = t;
    innerN = outerN;
  }

  // inX / inY / inZ now describe the rim ring.
  const rimN = innerN;

  // --- flat base, one fan from the centre ---------------------------------
  for (let i = 0; i < rimN; i++) {
    const j = (i + 1) % rimN;
    mb.addTriangle(0, 0, 0, inX[j], inY[j], 0, inX[i], inY[i], 0);
  }

  // --- rim wall ------------------------------------------------------------
  for (let i = 0; i < rimN; i++) {
    const j = (i + 1) % rimN;
    emitWallColumn(
      mb,
      inX[i], inY[i], inZ[i],
      inX[j], inY[j], inZ[j],
      splitZs,
    );
  }

  return mb.finish();
}

/**
 * Boundary sampler for a regular polygon, parameterised by s in [0, 1) so the
 * caller can take as many or as few samples as a ring needs.
 *
 * @param corners Polygon corners, counter-clockwise.
 */
export function polygonBoundary(
  corners: { x: number; y: number }[],
): (s: number) => { x: number; y: number } {
  const sides = corners.length;
  return (s: number) => {
    const f = s * sides;
    const e = Math.floor(f) % sides;
    const t = f - Math.floor(f);
    const a = corners[e];
    const b = corners[(e + 1) % sides];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };
}
