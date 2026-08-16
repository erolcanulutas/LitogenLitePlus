import { MeshBuilder, type Mesh } from "./mesh";

const EPS = 1e-7;

/**
 * The two halves of a colour-split model, each a closed solid in its own
 * right, concatenated into one buffer.
 *
 * Keeping them separately watertight is the whole point: slicers assign
 * filament per object, so a multi-colour print needs two real bodies. Tagging
 * triangles of a single body with different materials is legal 3MF but most
 * slicers ignore it, and an open shell gets rejected outright.
 */
export type SplitMesh = {
  positions: Float32Array;
  triangleCount: number;
  /** Triangles [0, belowCount) are the lower body, the rest the upper one. */
  belowCount: number;
};

/**
 * Cuts a heightfield model along a horizontal plane and caps both halves.
 *
 * Clipping alone leaves each half open where the plane passed through, so the
 * cross-section is triangulated too: the lower body gets a lid at the plane,
 * the upper body a floor. Both come from the same clipped polygons, wound
 * opposite ways, so they meet exactly.
 */
export function splitMeshAtZ(mesh: Mesh, splitZ: number): SplitMesh {
  const { positions, triangleCount } = mesh;

  const below = new MeshBuilder(triangleCount);
  const above = new MeshBuilder(Math.max(1, triangleCount >> 1));

  const poly = new Float64Array(12);
  const tri = new Float64Array(9);

  for (let i = 0; i < triangleCount; i++) {
    const o = i * 9;
    for (let k = 0; k < 9; k++) tri[k] = positions[o + k];

    const z0 = tri[2], z1 = tri[5], z2 = tri[8];
    const lo = Math.min(z0, z1, z2);
    const hi = Math.max(z0, z1, z2);

    // Only upward-facing triangles bound the solid from above, so only they
    // describe the cross-section. Walls project to a line and contribute none.
    const ux = tri[3] - tri[0], uy = tri[4] - tri[1];
    const vx = tri[6] - tri[0], vy = tri[7] - tri[1];
    const projected = ux * vy - uy * vx;
    const facesUp = projected > EPS;

    if (hi <= splitZ + EPS) {
      emit(below, tri[0], tri[1], tri[2], tri[3], tri[4], tri[5], tri[6], tri[7], tri[8]);
      continue;
    }

    if (lo >= splitZ - EPS) {
      emit(above, tri[0], tri[1], tri[2], tri[3], tri[4], tri[5], tri[6], tri[7], tri[8]);
      if (facesUp) {
        capFromTriangle(below, above, tri[0], tri[1], tri[3], tri[4], tri[6], tri[7], splitZ);
      }
      continue;
    }

    const belowCount = clipTriangle(tri, poly, splitZ, false);
    fanInto(below, poly, belowCount);

    const aboveCount = clipTriangle(tri, poly, splitZ, true);
    fanInto(above, poly, aboveCount);
    if (facesUp) capFromPolygon(below, above, poly, aboveCount, splitZ);
  }

  const belowMesh = below.finish();
  const aboveMesh = above.finish();
  const total = belowMesh.triangleCount + aboveMesh.triangleCount;

  const merged = new Float32Array(total * 9);
  merged.set(belowMesh.positions, 0);
  merged.set(aboveMesh.positions, belowMesh.positions.length);

  return {
    positions: merged,
    triangleCount: total,
    belowCount: belowMesh.triangleCount,
  };
}

/** Lid on the lower body (+Z) and floor on the upper one (-Z). */
function capFromTriangle(
  lower: MeshBuilder,
  upper: MeshBuilder,
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
  z: number,
) {
  emit(lower, ax, ay, z, bx, by, z, cx, cy, z);
  emit(upper, ax, ay, z, cx, cy, z, bx, by, z);
}

function capFromPolygon(
  lower: MeshBuilder,
  upper: MeshBuilder,
  poly: Float64Array,
  count: number,
  z: number,
) {
  for (let i = 1; i + 1 < count; i++) {
    const a = 0, b = i * 3, c = (i + 1) * 3;
    capFromTriangle(
      lower, upper,
      poly[a], poly[a + 1],
      poly[b], poly[b + 1],
      poly[c], poly[c + 1],
      z,
    );
  }
}

function emit(
  mb: MeshBuilder,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
) {
  // Only drop genuinely degenerate triangles. A sliver still carries three
  // edges that its neighbours expect to pair with, so discarding it on a
  // generous threshold punches holes in an otherwise closed body.
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  if (Math.hypot(nx, ny, nz) <= 1e-12) return;

  mb.addTriangle(ax, ay, az, bx, by, bz, cx, cy, cz);
}

/**
 * Sutherland-Hodgman clip of one triangle against z = splitZ.
 * Writes the resulting polygon into `out` and returns its vertex count.
 */
function clipTriangle(
  tri: Float64Array,
  out: Float64Array,
  splitZ: number,
  keepAbove: boolean,
): number {
  let count = 0;

  for (let i = 0; i < 3; i++) {
    const a = i * 3;
    const b = ((i + 1) % 3) * 3;

    const az = tri[a + 2];
    const bz = tri[b + 2];

    const aIn = keepAbove ? az >= splitZ - EPS : az <= splitZ + EPS;
    const bIn = keepAbove ? bz >= splitZ - EPS : bz <= splitZ + EPS;

    if (aIn !== bIn) {
      const t = (splitZ - az) / (bz - az);
      const o = count * 3;
      out[o] = tri[a] + (tri[b] - tri[a]) * t;
      out[o + 1] = tri[a + 1] + (tri[b + 1] - tri[a + 1]) * t;
      out[o + 2] = splitZ;
      count++;
    }

    if (bIn) {
      const o = count * 3;
      out[o] = tri[b];
      out[o + 1] = tri[b + 1];
      out[o + 2] = tri[b + 2];
      count++;
    }
  }

  return count;
}

function fanInto(mb: MeshBuilder, poly: Float64Array, count: number) {
  for (let i = 1; i + 1 < count; i++) {
    const a = 0, b = i * 3, c = (i + 1) * 3;
    emit(
      mb,
      poly[a], poly[a + 1], poly[a + 2],
      poly[b], poly[b + 1], poly[b + 2],
      poly[c], poly[c + 1], poly[c + 2],
    );
  }
}
