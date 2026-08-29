import type { Heightmap } from "./types";
import { bandOfLum } from "./terrace";

/**
 * Closing up a band that is only the ramp between two others.
 *
 * Thickness is how this tool says colour, so a tone whose brightness lies
 * between two others has to appear wherever those two meet. Rolex sets green
 * letters on white and draws its crown in gold, and gold sits between them in
 * brightness — so every letter came out ringed in gold, an outline that is
 * nowhere in the artwork. The samurai does the same with red between its black
 * and its white.
 *
 * Telling a ring from a real band needs a wider look than any one point gives,
 * and it needs two questions, not one.
 *
 * **Is it thin?** Gold on the crown is a region millimetres across; gold around
 * a letter is a quarter-millimetre strip that never gets any wider.
 *
 * **Does it separate two different bands?** Thinness alone is not enough, and
 * getting that wrong is expensive: the samurai has a red iris ring about as
 * thin as any ramp, and closing it took the eye out of the picture. But a ramp
 * is a ramp because it lies *between* two other bands — the gold ring has green
 * inside it and white outside. A thin thing that is really there has the same
 * band on both sides: the iris ring is red with the black of the eye on either
 * side of it. So a run is only a ramp when its edge touches both a darker band
 * and a lighter one.
 *
 * **What is done about it matters more than finding it.** Giving those runs a
 * different height was tried three ways and every one broke the mesh: a height
 * that depends on where you are puts a step wherever it changes, and steps only
 * get walls at brightness cuts, so each one left a hole. Open edges went from
 * 160 to between 650 and 4500, and volume drift from 0.04% to as much as 4%.
 *
 * So leave the heights alone and squeeze the *brightness* instead. Over a
 * spurious run, the band's slice of the range is compressed to almost nothing,
 * which is a monotone remap of one continuous field into another. Nothing
 * downstream can tell the difference — the surface is built from the field
 * exactly as before, the crossings are solved against it exactly as before, and
 * two triangles sharing an edge still read the same value at the same point, so
 * the surface stays as closed as it was. The band simply has almost no width
 * left to occupy, and the two steps either side of it fall together into the
 * one step the edge always was.
 */
export type BandSquash = {
  w: number;
  hPx: number;
  levels: number;
  /** How far to close band k at each pixel, 0..255, indexed [i * levels + k]. */
  amount: Uint8Array;
};

/**
 * How thick a band has to get, somewhere along its run, to count as a region.
 *
 * A half-width, measured from the middle of the run. The rings this is meant to
 * close come out around 0.12mm from their middle and stay there; anything a
 * printer could deliberately lay down as its own colour is wider than this.
 */
const REGION_HALF_WIDTH_MM = 0.25;

/**
 * What a fully closed band keeps of its range.
 *
 * Not zero, so the remap stays strictly increasing and every band keeps a
 * preimage to be found in. At a fiftieth of its width the ring comes out around
 * 5µm across — a fortieth of a layer, and nothing a nozzle can lay down.
 */
const MIN_KEEP = 0.02;

/**
 * How far the verdict is feathered, in multiples of the sampling window.
 *
 * A hard edge to it would put a step in the field and the surface would answer
 * with a contour that belongs to nothing in the picture. Feathered, the band
 * closes over several cells and there is nothing to see.
 */
const FEATHER = 2.5;

/**
 * Which runs of which bands are ramps rather than regions.
 *
 * Only the middle bands can be ramps — the darkest and lightest have nothing
 * beyond them to be a ramp between — so the extremes are never closed.
 *
 * @param filterPx The window the surface reads the picture through. The bands
 *                 are found through the same window, so a run measured here is
 *                 the run the surface will build.
 */
export function buildBandSquash(
  hm: Heightmap,
  cuts: readonly number[],
  mmPerPx: number,
  filterPx: number,
): BandSquash | null {
  const levels = cuts.length + 1;
  if (levels < 3 || !(mmPerPx > 0)) return null;

  const w = hm.w;
  const hPx = hm.hPx;
  const n = w * hPx;

  // Bands as the surface will see them, not as the raw picture has them.
  const r = Math.max(0, filterPx);
  const band = new Uint8Array(n);

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
        const v =
          area > 0
            ? (sat[y1 * stride + x1] - sat[y0 * stride + x1] -
               sat[y1 * stride + x0] + sat[y0 * stride + x0]) / area
            : hm.h[y][x];
        band[y * w + x] = bandOfLum(v, cuts);
      }
    }
  } else {
    for (let y = 0; y < hPx; y++) {
      const row = hm.h[y];
      for (let x = 0; x < w; x++) band[y * w + x] = bandOfLum(row[x], cuts);
    }
  }

  // Distance to the nearest pixel of another band, so a run's thickness can be
  // read off its middle. Chamfer 3-4: two passes, close enough for a threshold.
  const INF = 1e9;
  const dist = new Float32Array(n);
  for (let y = 0; y < hPx; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const b = band[i];
      const edge =
        x === 0 || y === 0 || x === w - 1 || y === hPx - 1 ||
        band[i - 1] !== b || band[i + 1] !== b ||
        band[i - w] !== b || band[i + w] !== b;
      dist[i] = edge ? 0 : INF;
    }
  }
  const relax = (i: number, j: number, d: number) => {
    const v = dist[j] + d;
    if (v < dist[i]) dist[i] = v;
  };
  for (let y = 1; y < hPx - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (dist[i] === 0) continue;
      relax(i, i - 1, 3); relax(i, i - w, 3);
      relax(i, i - w - 1, 4); relax(i, i - w + 1, 4);
    }
  }
  for (let y = hPx - 2; y >= 1; y--) {
    for (let x = w - 2; x >= 1; x--) {
      const i = y * w + x;
      if (dist[i] === 0) continue;
      relax(i, i + 1, 3); relax(i, i + w, 3);
      relax(i, i + w + 1, 4); relax(i, i + w - 1, 4);
    }
  }

  // Thickest point of each run, then one verdict for the whole run.
  const limit = (REGION_HALF_WIDTH_MM / mmPerPx) * 3; // chamfer units
  const amount = new Uint8Array(n * levels);
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const run = new Int32Array(n);
  let marked = 0;

  for (let start = 0; start < n; start++) {
    if (seen[start]) continue;
    const b = band[start];
    seen[start] = 1;
    if (b === 0 || b === levels - 1) continue;

    let top = 0;
    let size = 0;
    let thickest = 0;
    let touchesDarker = false;
    let touchesLighter = false;
    stack[top++] = start;

    const note = (j: number) => {
      const o = band[j];
      if (o < b) touchesDarker = true;
      else if (o > b) touchesLighter = true;
    };

    while (top > 0) {
      const i = stack[--top];
      run[size++] = i;
      if (dist[i] > thickest) thickest = dist[i];
      const x = i % w;
      const y = (i / w) | 0;
      if (x > 0) { if (band[i - 1] === b) { if (!seen[i - 1]) { seen[i - 1] = 1; stack[top++] = i - 1; } } else note(i - 1); }
      if (x < w - 1) { if (band[i + 1] === b) { if (!seen[i + 1]) { seen[i + 1] = 1; stack[top++] = i + 1; } } else note(i + 1); }
      if (y > 0) { if (band[i - w] === b) { if (!seen[i - w]) { seen[i - w] = 1; stack[top++] = i - w; } } else note(i - w); }
      if (y < hPx - 1) { if (band[i + w] === b) { if (!seen[i + w]) { seen[i + w] = 1; stack[top++] = i + w; } } else note(i + w); }
    }

    if (thickest < limit && touchesDarker && touchesLighter) {
      for (let k = 0; k < size; k++) amount[run[k] * levels + b] = 255;
      marked += size;
    }
  }

  if (marked === 0) return null;

  // Widen the verdict, then feather it, separably and one band at a time.
  //
  // Widening first is what makes it bite. A strip only a few pixels across,
  // blurred straight away, comes out at a third of its value and closes the
  // band by a third — the ring stays, just fainter. Grown to the width of the
  // blur first, its middle survives the blur intact and the falloff lands
  // outside the strip, where there was nothing to keep anyway.
  //
  // Widening is safe here in a way it was not when this decided heights: it
  // moves no geometry and opens no seam, it only says the band is worth less
  // of the range slightly further out than the strip itself.
  const fr = Math.max(1, Math.round(FEATHER * Math.max(1, r)));
  const tmp = new Uint8Array(n * levels);

  for (let b = 1; b < levels - 1; b++) {
    for (let y = 0; y < hPx; y++) {
      for (let x = 0; x < w; x++) {
        let m = 0;
        const x0 = Math.max(0, x - fr);
        const x1 = Math.min(w - 1, x + fr);
        for (let k = x0; k <= x1 && m === 0; k++) m = amount[(y * w + k) * levels + b];
        tmp[(y * w + x) * levels + b] = m;
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < hPx; y++) {
        let m = 0;
        const y0 = Math.max(0, y - fr);
        const y1 = Math.min(hPx - 1, y + fr);
        for (let k = y0; k <= y1 && m === 0; k++) m = tmp[(k * w + x) * levels + b];
        amount[(y * w + x) * levels + b] = m;
      }
    }
  }
  for (let b = 1; b < levels - 1; b++) {
    for (let y = 0; y < hPx; y++) {
      let sum = 0;
      for (let x = -fr; x <= fr; x++) {
        sum += amount[(y * w + Math.min(w - 1, Math.max(0, x))) * levels + b];
      }
      for (let x = 0; x < w; x++) {
        tmp[(y * w + x) * levels + b] = Math.round(sum / (2 * fr + 1));
        const add = Math.min(w - 1, x + fr + 1);
        const drop = Math.max(0, x - fr);
        sum += amount[(y * w + add) * levels + b] - amount[(y * w + drop) * levels + b];
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -fr; y <= fr; y++) {
        sum += tmp[(Math.min(hPx - 1, Math.max(0, y)) * w + x) * levels + b];
      }
      for (let y = 0; y < hPx; y++) {
        amount[(y * w + x) * levels + b] = Math.round(sum / (2 * fr + 1));
        const add = Math.min(hPx - 1, y + fr + 1);
        const drop = Math.max(0, y - fr);
        sum += tmp[(add * w + x) * levels + b] - tmp[(drop * w + x) * levels + b];
      }
    }
  }

  return { w, hPx, levels, amount };
}

/**
 * The picture's brightness with any ramp-only band squeezed shut.
 *
 * Every band keeps a slice of the range; a band being closed here keeps almost
 * none of it. The map from the squeezed slices back onto the real ones is
 * piecewise linear and strictly increasing, so it is one continuous field
 * turned into another and everything built on top of it is undisturbed.
 */
export function squashLum(
  s: BandSquash | null,
  u: number,
  v: number,
  l: number,
  cuts: readonly number[],
): number {
  if (!s) return l;

  const levels = s.levels;
  const px = Math.max(0, Math.min(s.w - 1, Math.round(u * (s.w - 1))));
  const py = Math.max(0, Math.min(s.hPx - 1, Math.round(v * (s.hPx - 1))));
  const base = (py * s.w + px) * levels;

  const width: number[] = [];
  let total = 0;
  for (let k = 0; k < levels; k++) {
    const lo = k === 0 ? 0 : cuts[k - 1];
    const hi = k === levels - 1 ? 1 : cuts[k];
    const a = s.amount[base + k] / 255;
    const keep = 1 - a * (1 - MIN_KEEP);
    const wk = (hi - lo) * keep;
    width.push(wk);
    total += wk;
  }
  if (!(total > 0)) return l;

  let d = 0;
  for (let k = 0; k < levels; k++) {
    const step = width[k] / total;
    const dNext = k === levels - 1 ? 1 : d + step;
    if (l <= dNext || k === levels - 1) {
      const lo = k === 0 ? 0 : cuts[k - 1];
      const hi = k === levels - 1 ? 1 : cuts[k];
      const span = dNext - d;
      const t = span > 1e-12 ? (l - d) / span : 0;
      return lo + Math.max(0, Math.min(1, t)) * (hi - lo);
    }
    d = dNext;
  }
  return l;
}
