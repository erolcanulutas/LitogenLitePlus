import { PRONG } from "./prong";

/** What the placement needs of a built picture: the preview's own shape. */
export type PocketPicture = {
  positions: Float32Array;
  triangleCount: number;
  faceAxis?: [number, number, number];
};

/** A picture's bounding box in the pose it was exported in, found once. */
const boxes = new WeakMap<Float32Array, number[]>();

function boxOf(m: PocketPicture): number[] {
  let b = boxes.get(m.positions);
  if (!b) {
    b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    const p = m.positions;
    const n = m.triangleCount * 9;
    for (let i = 0; i < n; i += 3) {
      for (let a = 0; a < 3; a++) {
        const v = p[i + a];
        if (v < b[a]) b[a] = v;
        if (v > b[a + 3]) b[a + 3] = v;
      }
    }
    boxes.set(m.positions, b);
  }
  return b;
}

/**
 * Where the finished picture sits in the holder, as one matrix.
 *
 * The preview model is in its exported pose: stood up, its face towards -y and
 * its top towards +z, or lying flat with the face towards +z. It is turned so
 * the face looks out of the holder's front, centred in the pocket with its face
 * just behind the lip, and then carried wherever the plate is — leaning back
 * and set on the stand — the same way the holder itself is. Being a matrix, it
 * moves with the angle without touching a vertex.
 *
 * Column-major, as a 3D library wants it.
 */
export function pictureMatrix(
  m: PocketPicture,
  pocketMid: { x: number; y: number },
  faceZ: number,
  tiltDeg: number,
  socketDepth: number,
  centreX: number,
): number[] {
  const standing = (m.faceAxis?.[1] ?? 0) < -0.5;
  const [x0, y0, z0, x1, y1, z1] = boxOf(m);

  // Into the plate's own axes, rows of the rotation.
  const A = standing
    ? [[1, 0, 0], [0, 0, 1], [0, -1, 0]]
    : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const apply = (v: number[]) => [
    A[0][0] * v[0] + A[0][1] * v[1] + A[0][2] * v[2],
    A[1][0] * v[0] + A[1][1] * v[1] + A[1][2] * v[2],
    A[2][0] * v[0] + A[2][1] * v[1] + A[2][2] * v[2],
  ];
  const lo = apply([x0, y0, z0]);
  const hi = apply([x1, y1, z1]);
  const box = [0, 1, 2].map((a) => [Math.min(lo[a], hi[a]), Math.max(lo[a], hi[a])]);

  const d = [
    pocketMid.x - (box[0][0] + box[0][1]) / 2,
    pocketMid.y - (box[1][0] + box[1][1]) / 2,
    faceZ - box[2][1],
  ];

  // Plate to the scene: x turns over, because seen from the front the plate's
  // right is the scene's left; the rest leans by the tilt.
  const t = (Math.min(45, Math.max(0, tiltDeg)) * Math.PI) / 180;
  const st = Math.sin(t);
  const ct = Math.cos(t);
  const B = [[-1, 0, 0], [0, -st, ct], [0, ct, st]];
  const edge = PRONG.reach + socketDepth;
  const tb = [centreX, edge, 0];

  const R = B.map((row) => [0, 1, 2].map((c) => row[0] * A[0][c] + row[1] * A[1][c] + row[2] * A[2][c]));
  const T = B.map((row, r) => row[0] * d[0] + row[1] * d[1] + row[2] * d[2] + tb[r]);

  return [
    R[0][0], R[1][0], R[2][0], 0,
    R[0][1], R[1][1], R[2][1], 0,
    R[0][2], R[1][2], R[2][2], 0,
    T[0], T[1], T[2], 1,
  ];
}
