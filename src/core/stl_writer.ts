import type { Mesh } from "./mesh";

/**
 * Binary STL. Reads straight out of the flat mesh buffer — no intermediate
 * objects, one allocation for the whole file.
 */
export function writeBinarySTL(mesh: Mesh): ArrayBuffer {
  const { positions, triangleCount } = mesh;

  const buf = new ArrayBuffer(84 + triangleCount * 50);
  const dv = new DataView(buf);

  dv.setUint32(80, triangleCount, true);

  let off = 84;
  for (let i = 0; i < triangleCount; i++) {
    const o = i * 9;

    const ax = positions[o], ay = positions[o + 1], az = positions[o + 2];
    const bx = positions[o + 3], by = positions[o + 4], bz = positions[o + 5];
    const cx = positions[o + 6], cy = positions[o + 7], cz = positions[o + 8];

    // Face normal from the winding: cross(b - a, c - a), normalised.
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;

    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;

    const len = Math.hypot(nx, ny, nz);
    if (len > 0) {
      nx /= len;
      ny /= len;
      nz /= len;
    }

    dv.setFloat32(off, nx, true);
    dv.setFloat32(off + 4, ny, true);
    dv.setFloat32(off + 8, nz, true);

    dv.setFloat32(off + 12, ax, true);
    dv.setFloat32(off + 16, ay, true);
    dv.setFloat32(off + 20, az, true);

    dv.setFloat32(off + 24, bx, true);
    dv.setFloat32(off + 28, by, true);
    dv.setFloat32(off + 32, bz, true);

    dv.setFloat32(off + 36, cx, true);
    dv.setFloat32(off + 40, cy, true);
    dv.setFloat32(off + 44, cz, true);

    dv.setUint16(off + 48, 0, true);
    off += 50;
  }

  return buf;
}
