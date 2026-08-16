import { MeshBuilder, type Mesh } from "./mesh";

const EPS = 1e-7;

/** A mesh whose triangles are tagged with which material they belong to. */
export type SplitMesh = {
  positions: Float32Array;
  triangleCount: number;
  /** One entry per triangle: 0 below the split plane, 1 above it. */
  material: Uint8Array;
};

/**
 * Cuts a mesh along a horizontal plane so the two halves can be printed in
 * different colours. Triangles straddling the plane are clipped, so the seam
 * is exactly flat rather than ragged.
 */
export function splitMeshAtZ(mesh: Mesh, splitZ: number): SplitMesh {
  const { positions, triangleCount } = mesh;

  const below = new MeshBuilder(triangleCount);
  const above = new MeshBuilder(Math.max(1, triangleCount >> 1));

  // Scratch polygons for the clip; at most 4 vertices come out of a triangle.
  const poly = new Float64Array(12);
  const tri = new Float64Array(9);

  for (let i = 0; i < triangleCount; i++) {
    const o = i * 9;
    for (let k = 0; k < 9; k++) tri[k] = positions[o + k];

    const z0 = tri[2], z1 = tri[5], z2 = tri[8];
    const lo = Math.min(z0, z1, z2);
    const hi = Math.max(z0, z1, z2);

    if (hi <= splitZ + EPS) {
      emit(below, tri[0], tri[1], tri[2], tri[3], tri[4], tri[5], tri[6], tri[7], tri[8]);
      continue;
    }
    if (lo >= splitZ - EPS) {
      emit(above, tri[0], tri[1], tri[2], tri[3], tri[4], tri[5], tri[6], tri[7], tri[8]);
      continue;
    }

    fanInto(below, poly, clipTriangle(tri, poly, splitZ, false));
    fanInto(above, poly, clipTriangle(tri, poly, splitZ, true));
  }

  const belowMesh = below.finish();
  const aboveMesh = above.finish();
  const total = belowMesh.triangleCount + aboveMesh.triangleCount;

  const merged = new Float32Array(total * 9);
  merged.set(belowMesh.positions, 0);
  merged.set(aboveMesh.positions, belowMesh.positions.length);

  const material = new Uint8Array(total);
  material.fill(1, belowMesh.triangleCount);

  return { positions: merged, triangleCount: total, material };
}

function emit(
  mb: MeshBuilder,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
) {
  // Drop slivers: they carry no volume and upset some slicers.
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  if (Math.hypot(nx, ny, nz) <= EPS) return;

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
