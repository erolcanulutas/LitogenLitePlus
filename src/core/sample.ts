import type { Heightmap } from "./types";

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

export function sampleHeightBilinear(hm: Heightmap, u: number, v: number): number {
  // u,v in [0..1]
  const x = u * (hm.w - 1);
  const y = v * (hm.hPx - 1);

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = clamp(x0 + 1, 0, hm.w - 1);
  const y1 = clamp(y0 + 1, 0, hm.hPx - 1);

  const tx = x - x0;
  const ty = y - y0;

  const a = hm.h[y0][x0];
  const b = hm.h[y0][x1];
  const c = hm.h[y1][x0];
  const d = hm.h[y1][x1];

  const ab = a * (1 - tx) + b * tx;
  const cd = c * (1 - tx) + d * tx;
  return ab * (1 - ty) + cd * ty;
}
