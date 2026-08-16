import type { Tri } from "./types";

function sub(a: number[], b: number[]) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: number[], b: number[]) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(v: number[]) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function writeBinarySTL(tris: Tri[]): ArrayBuffer {
  const buf = new ArrayBuffer(84 + tris.length * 50);
  const dv = new DataView(buf);

  dv.setUint32(80, tris.length, true);
  let off = 84;

  for (const [v0, v1, v2] of tris) {
    const n = normalize(cross(sub(v1, v0), sub(v2, v0),));

    dv.setFloat32(off + 0, n[0], true);
    dv.setFloat32(off + 4, n[1], true);
    dv.setFloat32(off + 8, n[2], true);

    [...v0, ...v1, ...v2].forEach((v, i) =>
      dv.setFloat32(off + 12 + i * 4, v, true)
    );

    dv.setUint16(off + 48, 0, true);
    off += 50;
  }

  return buf;
}
