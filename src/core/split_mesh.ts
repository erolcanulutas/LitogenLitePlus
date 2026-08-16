import type { Tri, Vec3 } from "./types";
import type { ColoredTri } from "./3mf_writer";

const EPS = 1e-7;

function cloneVec(v: Vec3): Vec3 {
  return [v[0], v[1], v[2]];
}

function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function triArea2(a: Vec3, b: Vec3, c: Vec3): number {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];

  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];

  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;

  return Math.hypot(nx, ny, nz);
}

function addTri(out: ColoredTri[], a: Vec3, b: Vec3, c: Vec3, materialIndex: 0 | 1) {
  if (triArea2(a, b, c) <= EPS) return;
  out.push({
    tri: [cloneVec(a), cloneVec(b), cloneVec(c)],
    materialIndex,
  });
}

function clipTriangleZ(tri: Tri, splitZ: number, keepAbove: boolean): Vec3[] {
  const input = tri.map(cloneVec);
  const out: Vec3[] = [];

  for (let i = 0; i < input.length; i++) {
    const a = input[i];
    const b = input[(i + 1) % input.length];

    const aInside = keepAbove ? a[2] >= splitZ - EPS : a[2] <= splitZ + EPS;
    const bInside = keepAbove ? b[2] >= splitZ - EPS : b[2] <= splitZ + EPS;

    if (aInside && bInside) {
      out.push(cloneVec(b));
    } else if (aInside && !bInside) {
      const t = (splitZ - a[2]) / (b[2] - a[2]);
      const p = lerp(a, b, t);
      p[2] = splitZ;
      out.push(p);
    } else if (!aInside && bInside) {
      const t = (splitZ - a[2]) / (b[2] - a[2]);
      const p = lerp(a, b, t);
      p[2] = splitZ;
      out.push(p);
      out.push(cloneVec(b));
    }
  }

  return out;
}

function addFan(out: ColoredTri[], poly: Vec3[], materialIndex: 0 | 1) {
  if (poly.length < 3) return;

  for (let i = 1; i < poly.length - 1; i++) {
    addTri(out, poly[0], poly[i], poly[i + 1], materialIndex);
  }
}

export function makeLithophaneColoredTriangles(
  tris: Tri[],
  splitZ: number,
  maxT: number
): ColoredTri[] {
  const out: ColoredTri[] = [];

  if (splitZ <= EPS || splitZ >= maxT - EPS) {
    for (const tri of tris) {
      addTri(out, tri[0], tri[1], tri[2], 0);
    }
    return out;
  }

  for (const tri of tris) {
    const minZ = Math.min(tri[0][2], tri[1][2], tri[2][2]);
    const maxZTri = Math.max(tri[0][2], tri[1][2], tri[2][2]);

    if (maxZTri <= splitZ + EPS) {
      addTri(out, tri[0], tri[1], tri[2], 0);
      continue;
    }

    if (minZ >= splitZ - EPS) {
      addTri(out, tri[0], tri[1], tri[2], 1);
      continue;
    }

    const bottom = clipTriangleZ(tri, splitZ, false);
    const top = clipTriangleZ(tri, splitZ, true);

    addFan(out, bottom, 0);
    addFan(out, top, 1);
  }

  return out;
}