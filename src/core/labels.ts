import type { Heightmap } from "./types";
import { bandOfLum } from "./terrace";
import { type BandSquash, buildBandSquash } from "./squash";

/**
 * The picture as tone numbers rather than brightness.
 *
 * Reading tones off a brightness field cannot help putting a tone that lies
 * between two others along the edge where those two meet. This logo has black
 * at 0.00, white at 0.99 and red at 0.29; the edge from white to black has to
 * pass through 0.29 on the way, and every point it passes through reads as
 * red. Squeezing that band shut makes the ring thin. It does not make it stop
 * being there, and one mesh vertex landing in what is left is enough to give
 * the tone a region and draw a line of it round a shape that has none.
 *
 * So the question is asked once, per pixel, and answered with a number: which
 * tone is this? A run of a middle tone that is only the ramp between two
 * others is not a tone at all, and goes to whichever of the two it is nearer.
 * After that there is no brightness left to interpolate through — the white
 * pixel beside a black one is white, the black one is black, and between them
 * is one boundary rather than a range.
 *
 * The boundary is still *placed* against the brightness field, so edges land
 * where the picture puts them instead of stepping along its pixels. The
 * numbers decide which tones meet; the field decides where.
 */
export type ToneLabels = {
  w: number;
  hPx: number;
  /** Tone number per pixel, darkest first. */
  at: Uint8Array;
};

/**
 * Tone numbers for every pixel, with the ramps resolved.
 *
 * @param filterPx The window the surface reads the picture through, so the
 *                 tones are found the way the surface will find them.
 */
export function buildToneLabels(
  hm: Heightmap,
  cuts: readonly number[],
  mmPerPx: number,
  filterPx: number,
): ToneLabels {
  const levels = cuts.length + 1;
  const w = hm.w;
  const hPx = hm.hPx;
  const n = w * hPx;

  const at = new Uint8Array(n);
  const r = Math.max(0, filterPx);
  const smooth = new Float64Array(n);

  if (r > 0.5) {
    const stride = w + 1;
    const sat = new Float64Array(stride * (hPx + 1));
    for (let y = 0; y < hPx; y++) {
      const row = hm.h[y];
      const cur = (y + 1) * stride;
      const prev = y * stride;
      let rowSum = 0;
      for (let x = 0; x < w; x++) {
        rowSum += row[x];
        sat[cur + x + 1] = sat[prev + x + 1] + rowSum;
      }
    }
    for (let y = 0; y < hPx; y++) {
      const y0 = Math.max(0, Math.round(y - r));
      const y1 = Math.min(hPx, Math.round(y + r) + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, Math.round(x - r));
        const x1 = Math.min(w, Math.round(x + r) + 1);
        const area = (x1 - x0) * (y1 - y0);
        smooth[y * w + x] =
          area > 0
            ? (sat[y1 * stride + x1] - sat[y0 * stride + x1] -
               sat[y1 * stride + x0] + sat[y0 * stride + x0]) / area
            : hm.h[y][x];
      }
    }
  } else {
    for (let y = 0; y < hPx; y++) {
      const row = hm.h[y];
      for (let x = 0; x < w; x++) smooth[y * w + x] = row[x];
    }
  }

  for (let i = 0; i < n; i++) at[i] = bandOfLum(smooth[i], cuts);

  if (levels < 3) return { w, hPx, at };

  // Which runs are only a ramp. The same reading the relief already uses, so
  // both modes agree about what is a tone and what is a transition.
  const mask: BandSquash | null = buildBandSquash(hm, cuts, mmPerPx, filterPx);
  if (!mask) return { w, hPx, at };

  for (let i = 0; i < n; i++) {
    const b = at[i];
    if (b === 0 || b === levels - 1) continue;
    if (mask.amount[i * mask.levels + b] <= 127) continue;

    const lo = cuts[b - 1];
    const hi = cuts[b];
    const l = smooth[i];
    at[i] = l - lo < hi - l ? b - 1 : b + 1;
  }

  return { w, hPx, at };
}

/** The tone at (u, v). u, v in 0..1, v from the top. */
export function labelAt(t: ToneLabels, u: number, v: number): number {
  const x = Math.max(0, Math.min(t.w - 1, Math.round(u * (t.w - 1))));
  const y = Math.max(0, Math.min(t.hPx - 1, Math.round(v * (t.hPx - 1))));
  return t.at[y * t.w + x];
}
