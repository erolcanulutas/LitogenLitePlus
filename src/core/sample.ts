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

/**
 * Area-averaging sampler, backed by a summed-area table.
 *
 * The mesh is far coarser than the heightmap — a normal-quality circle places
 * a ring every 0.22mm while the heightmap resolves 0.10mm — so reading a
 * single pixel per vertex throws away most of the image and turns smooth
 * gradients into stair steps. Worse, it does not improve with quality: the
 * error is aliasing, not lack of resolution.
 *
 * Averaging over the area each vertex actually represents fixes that. The
 * summed-area table makes any box average an O(1) lookup regardless of size,
 * so the cost does not grow with the filter width.
 */
export type AreaSampler = {
  w: number;
  hPx: number;
  /** (w+1) * (hPx+1) prefix sums; sat[y*(w+1)+x] covers pixels < x, < y. */
  sat: Float64Array;
  source: Heightmap;
};

export function buildAreaSampler(hm: Heightmap): AreaSampler {
  const { w, hPx, h } = hm;
  const stride = w + 1;
  const sat = new Float64Array(stride * (hPx + 1));

  for (let y = 0; y < hPx; y++) {
    const row = h[y];
    const cur = (y + 1) * stride;
    const prev = y * stride;
    let rowSum = 0;

    for (let x = 0; x < w; x++) {
      rowSum += row[x];
      sat[cur + x + 1] = sat[prev + x + 1] + rowSum;
    }
  }

  return { w, hPx, sat, source: hm };
}

/** Bilinear read of the table itself, so the filter window can slide smoothly. */
function satAt(s: AreaSampler, x: number, y: number): number {
  const stride = s.w + 1;

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, s.w);
  const y1 = Math.min(y0 + 1, s.hPx);

  const tx = x - x0;
  const ty = y - y0;

  const a = s.sat[y0 * stride + x0];
  const b = s.sat[y0 * stride + x1];
  const c = s.sat[y1 * stride + x0];
  const d = s.sat[y1 * stride + x1];

  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/**
 * Average height over a box of `radiusPx` around (u, v).
 *
 * Falls back to plain bilinear when the footprint is under a pixel — there is
 * nothing to average, and blurring would only cost detail.
 */
export function sampleHeightFiltered(
  s: AreaSampler,
  u: number,
  v: number,
  radiusPx: number,
): number {
  if (!(radiusPx > 0.5)) return sampleHeightBilinear(s.source, u, v);

  // Pixel centres live at index+0.5 in the table's edge coordinates.
  const cx = clamp(u, 0, 1) * (s.w - 1) + 0.5;
  const cy = clamp(v, 0, 1) * (s.hPx - 1) + 0.5;

  const x0 = clamp(cx - radiusPx, 0, s.w);
  const x1 = clamp(cx + radiusPx, 0, s.w);
  const y0 = clamp(cy - radiusPx, 0, s.hPx);
  const y1 = clamp(cy + radiusPx, 0, s.hPx);

  const area = (x1 - x0) * (y1 - y0);
  if (area <= 1e-9) return sampleHeightBilinear(s.source, u, v);

  const sum =
    satAt(s, x1, y1) - satAt(s, x0, y1) - satAt(s, x1, y0) + satAt(s, x0, y0);

  return sum / area;
}
