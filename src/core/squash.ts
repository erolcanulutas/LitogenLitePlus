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
 * A half-width, measured from the middle of the run.
 *
 * Most of a ring is about 0.12mm from its middle, and 0.25mm closed 99.2% of
 * them. What it left was where a ring runs into a real area of the same tone —
 * a flame tip coming down onto a white edge, say. The two merge, the merged
 * thing is over a millimetre across, and at that size there is nothing to tell
 * it from something the artist drew. Measured on the samurai, one such patch
 * survived, 1.16mm across, and it is the wedge that shows on the eye.
 *
 * 0.6mm closes all of them. It costs 0.32% of the middle tone's real area —
 * the outermost sliver of anything genuinely narrower than about 1.2mm — and
 * nothing visible with it. Rolex does not move at all at any setting between
 * 0.25 and 0.8: its crown is far wider than either.
 */
const REGION_HALF_WIDTH_MM = 0.6;

/**
 * What a fully closed band keeps of its range.
 *
 * Zero. A band closed to a fiftieth of its width is 5µm across — far under
 * anything a nozzle lays down, and it was chosen to keep the remap strictly
 * increasing. But a line of no width is still a line: it drew as a hairline in
 * the preview all the way round every shape, about 1mm2 of it, because a
 * region a thousandth of a millimetre wide still has two sides and still gets
 * a face between them.
 *
 * At zero the two boundaries land on the same contour instead. The band gets
 * no width at all, its plateaus come out degenerate and are dropped, its body
 * disappears, and the two tones either side meet on exactly the same line. The
 * remap stops being strictly increasing at that one point, which the crossing
 * solve does not mind: both cuts bracket the same jump, so it converges to the
 * same place from either side and the two triangles sharing an edge still
 * agree.
 */
const MIN_KEEP = 0;

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
  regionHalfWidthMm: number = REGION_HALF_WIDTH_MM,
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

  // Where is the band too thin to be a region, and is it separating two
  // others where it is?
  //
  // Both have to be asked pixel by pixel. Asking once per connected run was
  // tried and is too coarse: the samurai runs its rings into the red it draws
  // with, and one place where that run reaches a millimetre across saved the
  // whole of it, rings included. Rolex got away with it only because each
  // letter carries its own separate ring.
  //
  // "Too thin" is a morphological opening: a pixel is part of a region if a
  // disc the size of a region fits inside the band and covers it. The disc
  // fits wherever the distance to another band is at least its radius, so the
  // opening is that test spread over the disc. A wide region keeps all of
  // itself, including its edge; a strip narrower than the disc keeps none.
  //
  // "Separating two others" is the local range of the band index. A ramp has
  // something darker on one side and something lighter on the other. A thin
  // thing that is really there has the same band both sides — the samurai iris
  // is red with the black of the eye either side, and closing it took the eye
  // out of the picture.
  const limitCh = (regionHalfWidthMm / mmPerPx) * 3;
  const R = Math.max(1, Math.round(regionHalfWidthMm / mmPerPx));
  const amount = new Uint8Array(n * levels);
  let marked = 0;

  const lmin = new Uint8Array(n);
  const lmax = new Uint8Array(n);
  {
    const tMin = new Uint8Array(n);
    const tMax = new Uint8Array(n);
    for (let y = 0; y < hPx; y++) {
      for (let x = 0; x < w; x++) {
        let mn = 255;
        let mx = 0;
        const x0 = Math.max(0, x - R);
        const x1 = Math.min(w - 1, x + R);
        for (let k = x0; k <= x1; k++) {
          const v = band[y * w + k];
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
        tMin[y * w + x] = mn;
        tMax[y * w + x] = mx;
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < hPx; y++) {
        let mn = 255;
        let mx = 0;
        const y0 = Math.max(0, y - R);
        const y1 = Math.min(hPx - 1, y + R);
        for (let k = y0; k <= y1; k++) {
          const a2 = tMin[k * w + x];
          const b2 = tMax[k * w + x];
          if (a2 < mn) mn = a2;
          if (b2 > mx) mx = b2;
        }
        lmin[y * w + x] = mn;
        lmax[y * w + x] = mx;
      }
    }
  }

  const fits = new Uint8Array(n);
  const opened = new Uint8Array(n);
  const tmpOpen = new Uint8Array(n);

  for (let b = 1; b < levels - 1; b++) {
    for (let i = 0; i < n; i++) fits[i] = band[i] === b && dist[i] >= limitCh ? 1 : 0;

    for (let y = 0; y < hPx; y++) {
      for (let x = 0; x < w; x++) {
        let m = 0;
        const x0 = Math.max(0, x - R);
        const x1 = Math.min(w - 1, x + R);
        for (let k = x0; k <= x1 && m === 0; k++) m = fits[y * w + k];
        tmpOpen[y * w + x] = m;
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < hPx; y++) {
        let m = 0;
        const y0 = Math.max(0, y - R);
        const y1 = Math.min(hPx - 1, y + R);
        for (let k = y0; k <= y1 && m === 0; k++) m = tmpOpen[k * w + x];
        opened[y * w + x] = m;
      }
    }

    for (let i = 0; i < n; i++) {
      if (band[i] !== b || opened[i]) continue;
      if (lmin[i] >= b || lmax[i] <= b) continue;
      amount[i * levels + b] = 255;
      marked++;
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
