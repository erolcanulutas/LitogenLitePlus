import { bandOfLum } from "./terrace";

export type ToneSuggestion = {
  /** Tone count to use, always within the range the panel offers. */
  levels: number;
  /** Share of the picture that lands flat on a tone at that count, 0..1. */
  covered: number;
  /**
   * True when the picture has no flat tones to find — a photograph, say — and
   * the count is a fallback rather than something measured.
   */
  smooth: boolean;
  /** Brightness of each tone the picture is made of, darkest first. */
  tones: number[];
  /** Brightness boundaries between those tones, ascending; one fewer. */
  cuts: number[];
  /** Each tone's own colour, taken from the picture, as #rrggbb. */
  colors: string[];
  /** The tone covering most of the picture — what a solid base should match. */
  dominant: number;
};

const MIN_LEVELS = 2;
const MAX_LEVELS = 16;

/**
 * How far a pixel may sit from its tone and still count as being on it.
 * Roughly one part in twenty of the range, which is well inside what a
 * printed tone step can show.
 */
const TOL = 0.05;

/** Share of the picture that has to land flat before a count is accepted. */
const TARGET = 0.97;

/**
 * Past this, the picture is not flat-toned. Line art built out of eight
 * distinct greys is unusual; a photograph will keep improving forever, and
 * would otherwise be answered with a number that only reflects the tolerance.
 */
const FLAT_LIMIT = 8;

/** What a picture with nothing flat in it gets. */
const SMOOTH_FALLBACK = 4;

/** Luminance histogram, carrying the colour of each bin as well as its count. */
type Hist = {
  n: Float64Array;
  r: Float64Array;
  g: Float64Array;
  b: Float64Array;
  total: number;
};

function histogramOf(img: ImageData): Hist {
  const n = new Float64Array(256);
  const r = new Float64Array(256);
  const g = new Float64Array(256);
  const b = new Float64Array(256);
  const d = img.data;
  let total = 0;

  for (let i = 0; i < d.length; i += 4) {
    const lum = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    const k = Math.max(0, Math.min(255, Math.round(lum * 255)));
    n[k]++;
    r[k] += d[i];
    g[k] += d[i + 1];
    b[k] += d[i + 2];
    total++;
  }

  return { n, r, g, b, total };
}

/**
 * The tones a picture is actually made of, at a given count.
 *
 * Lloyd's algorithm over the histogram: put the tones somewhere, give every
 * brightness to its nearest, move each tone to the middle of what it was
 * given, repeat. It settles on the artwork's real tones rather than on
 * wherever an even division happens to fall, and the two are not the same
 * thing — a black / red / white logo has its red at 0.29, and no even
 * division of the range puts a tone there.
 *
 * Starting evenly spread makes it deterministic; there is no seeding to get
 * unlucky with.
 */
function fitTones(h: Hist, k: number): { tones: number[]; covered: number } {
  let tones: number[] = [];
  for (let i = 0; i < k; i++) tones.push((i + 0.5) / k);

  for (let pass = 0; pass < 64; pass++) {
    const sum = new Float64Array(k);
    const cnt = new Float64Array(k);

    for (let i = 0; i < 256; i++) {
      const w = h.n[i];
      if (w === 0) continue;
      const l = i / 255;

      let best = 0;
      let bestD = Math.abs(l - tones[0]);
      for (let j = 1; j < k; j++) {
        const dj = Math.abs(l - tones[j]);
        if (dj < bestD) {
          bestD = dj;
          best = j;
        }
      }

      sum[best] += w * l;
      cnt[best] += w;
    }

    let moved = 0;
    const next = tones.slice();
    for (let j = 0; j < k; j++) {
      // An empty tone has nothing to average, so it stays where it is rather
      // than collapsing onto a neighbour.
      if (cnt[j] === 0) continue;
      next[j] = sum[j] / cnt[j];
      moved = Math.max(moved, Math.abs(next[j] - tones[j]));
    }

    tones = next;
    if (moved < 1e-7) break;
  }

  tones.sort((a, b) => a - b);

  let on = 0;
  for (let i = 0; i < 256; i++) {
    const w = h.n[i];
    if (w === 0) continue;
    const l = i / 255;

    let bestD = Infinity;
    for (let j = 0; j < k; j++) bestD = Math.min(bestD, Math.abs(l - tones[j]));
    if (bestD <= TOL) on += w;
  }

  return { tones, covered: h.total === 0 ? 0 : on / h.total };
}

/** Halfway between neighbouring tones, which is as much room as either gets. */
function cutsBetween(tones: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < tones.length; i++) {
    const mid = (tones[i - 1] + tones[i]) / 2;
    // Strictly ascending, or bandOfLum cannot tell the bands apart.
    const floor = out.length ? out[out.length - 1] + 1e-4 : 0;
    out.push(Math.min(1, Math.max(floor, mid)));
  }
  return out;
}

function hex(v: number): string {
  return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
}

/**
 * What each band looks like in the picture.
 *
 * The point is that the colours the panel starts with are the artwork's own,
 * so a black / red / white logo comes up black, red and white instead of
 * whatever the stock palette had in those slots. A band the picture never
 * reaches has no colour of its own and gets a grey off the brightness it
 * stands for.
 */
function dominantBand(h: Hist, cuts: readonly number[], levels: number): number {
  const n = new Float64Array(levels);
  for (let i = 0; i < 256; i++) {
    const w = h.n[i];
    if (w === 0) continue;
    n[Math.min(levels - 1, bandOfLum(i / 255, cuts))] += w;
  }
  let best = 0;
  for (let k = 1; k < levels; k++) if (n[k] > n[best]) best = k;
  return best;
}

function colorsFor(h: Hist, cuts: readonly number[], levels: number): string[] {
  const n = new Float64Array(levels);
  const r = new Float64Array(levels);
  const g = new Float64Array(levels);
  const b = new Float64Array(levels);

  for (let i = 0; i < 256; i++) {
    const w = h.n[i];
    if (w === 0) continue;
    const band = Math.min(levels - 1, bandOfLum(i / 255, cuts));
    n[band] += w;
    r[band] += h.r[i];
    g[band] += h.g[i];
    b[band] += h.b[i];
  }

  const out: string[] = [];
  for (let k = 0; k < levels; k++) {
    if (n[k] > 0) {
      out.push(`#${hex(r[k] / n[k])}${hex(g[k] / n[k])}${hex(b[k] / n[k])}`);
      continue;
    }
    const lo = k === 0 ? 0 : cuts[k - 1];
    const hi = k === levels - 1 ? 1 : cuts[k];
    const grey = ((lo + hi) / 2) * 255;
    out.push(`#${hex(grey)}${hex(grey)}${hex(grey)}`);
  }

  return out;
}

/** Even boundaries, for a picture with no flat tones to measure. */
function evenCuts(levels: number): number[] {
  const out: number[] = [];
  for (let k = 1; k < levels; k++) out.push(k / levels);
  return out;
}

/**
 * How many tones a picture actually needs, where they sit, and what colour
 * they are.
 *
 * Graphic mode flattens the picture onto a handful of thicknesses, and the
 * right number of them is a property of the artwork: a two-colour logo needs
 * two, a flat-shaded illustration needs however many flat shades it was drawn
 * with. Counting them by eye means trying numbers until the preview stops
 * changing.
 *
 * This fits that many tones to the picture and asks whether nearly every
 * pixel lands on one. The smallest count where it does is the number of tones
 * the picture is made of. Anti-aliased edges never sit on anything, which is
 * why the test is a share of the picture and not an error term — a few per
 * cent of ramp pixels cannot outvote the flats.
 *
 * Fitting the tones rather than dividing the range evenly is what lets the
 * count come out right. A black / red / white logo is three tones; even
 * thirds put its red in with its black, so an even division has to climb to
 * four to keep them apart, and then leaves a boundary 0.036 from the red —
 * near enough that averaging a thin red feature over a mesh cell tips it into
 * the black band and the feature is simply gone.
 */
/**
 * The brightness of each of `levels` tones, darkest first.
 *
 * Same fit Auto uses, but for a count that is already settled rather than one
 * being searched for. Anything working on tones as tones rather than as
 * thresholds needs the tones themselves — where a tone actually sits, not
 * where the boundary either side of it is — and the count may since have been
 * changed by hand, so it is measured again off the picture rather than
 * remembered from whenever Auto last ran.
 */
export function fitTonesFor(img: ImageData, levels: number): number[] {
  const k = Math.round(Math.min(MAX_LEVELS, Math.max(MIN_LEVELS, levels)));
  return fitTones(histogramOf(img), k).tones;
}

export function suggestToneLevels(img: ImageData): ToneSuggestion {
  const h = histogramOf(img);

  if (h.total === 0) {
    const cuts = evenCuts(SMOOTH_FALLBACK);
    return {
      levels: SMOOTH_FALLBACK,
      covered: 0,
      smooth: true,
      tones: [],
      cuts,
      colors: colorsFor(h, cuts, SMOOTH_FALLBACK),
      dominant: dominantBand(h, cuts, SMOOTH_FALLBACK),
    };
  }

  for (let k = MIN_LEVELS; k <= MAX_LEVELS; k++) {
    const { tones, covered } = fitTones(h, k);
    if (covered >= TARGET) {
      if (k > FLAT_LIMIT) break;
      const cuts = cutsBetween(tones);
      return {
        levels: k,
        covered,
        smooth: false,
        tones,
        cuts,
        colors: colorsFor(h, cuts, k),
        dominant: dominantBand(h, cuts, k),
      };
    }
  }

  const cuts = evenCuts(SMOOTH_FALLBACK);
  return {
    levels: SMOOTH_FALLBACK,
    covered: fitTones(h, SMOOTH_FALLBACK).covered,
    smooth: true,
    tones: [],
    cuts,
    colors: colorsFor(h, cuts, SMOOTH_FALLBACK),
    dominant: dominantBand(h, cuts, SMOOTH_FALLBACK),
  };
}
