/** What the placement needs of a built picture: the preview's own shape. */
export type PocketPicture = {
  positions: Float32Array;
  triangleCount: number;
  bandStarts: number[];
  colors: string[];
  faceAxis?: [number, number, number];
};

/**
 * The finished picture as it sits in the holder's pocket, in the plate's terms.
 *
 * The preview model is in its exported pose: stood up, its face towards -y and
 * its top towards +z, or lying flat with the face towards +z. Either way it is
 * turned so its face looks out of the holder's front, and centred in the pocket
 * with the face just behind the lip.
 */
export function pictureInPocket(
  m: PocketPicture,
  pocketMid: { x: number; y: number },
  faceZ: number,
) {
  const src = m.positions;
  const n = m.triangleCount * 9;
  const standing = (m.faceAxis?.[1] ?? 0) < -0.5;
  const out = new Float32Array(n);

  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i += 3) {
    const x = src[i];
    const y = standing ? src[i + 2] : src[i + 1];
    const z = standing ? -src[i + 1] : src[i + 2];
    out[i] = x;
    out[i + 1] = y;
    out[i + 2] = z;
    if (x < lo[0]) lo[0] = x;
    if (x > hi[0]) hi[0] = x;
    if (y < lo[1]) lo[1] = y;
    if (y > hi[1]) hi[1] = y;
    if (z < lo[2]) lo[2] = z;
    if (z > hi[2]) hi[2] = z;
  }

  const dx = pocketMid.x - (lo[0] + hi[0]) / 2;
  const dy = pocketMid.y - (lo[1] + hi[1]) / 2;
  const dz = faceZ - hi[2];
  for (let i = 0; i < n; i += 3) {
    out[i] += dx;
    out[i + 1] += dy;
    out[i + 2] += dz;
  }

  return {
    positions: out,
    triangleCount: m.triangleCount,
    bandStarts: m.bandStarts.length > 0 ? m.bandStarts : [0],
    colors: m.colors.length > 0 ? m.colors : ["#d8dee9"],
  };
}
