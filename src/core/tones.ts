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
};

const MIN_LEVELS = 2;
const MAX_LEVELS = 16;

/**
 * How far a pixel may sit from its tone's average and still count as being on
 * it. Roughly one part in twenty of the range, which is well inside what a
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

/**
 * How many tones a picture actually needs.
 *
 * Graphic mode flattens the picture onto a handful of thicknesses, and the
 * right number of them is a property of the artwork: a two-colour logo needs
 * two, a flat-shaded illustration needs however many flat shades it was drawn
 * with. Counting them by eye means trying numbers until the preview stops
 * changing.
 *
 * The generator splits brightness into equal slices, so this asks the same
 * question the generator will: at a given count, does nearly every pixel sit
 * on the average of its slice? The smallest count where it does is the number
 * of tones the picture is made of. Anti-aliased edges never sit on anything,
 * which is why the test is a share of the picture and not an error term —
 * a few percent of ramp pixels cannot outvote the flats.
 */
export function suggestToneLevels(img: ImageData): ToneSuggestion {
  const hist = new Float64Array(256);
  const d = img.data;
  let total = 0;

  for (let i = 0; i < d.length; i += 4) {
    const lum = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    hist[Math.max(0, Math.min(255, Math.round(lum * 255)))]++;
    total++;
  }

  if (total === 0) {
    return { levels: SMOOTH_FALLBACK, covered: 0, smooth: true };
  }

  /** Share of pixels within TOL of the mean of the slice they fall in. */
  const coverageAt = (k: number): number => {
    const n = new Float64Array(k);
    const sum = new Float64Array(k);

    for (let i = 0; i < 256; i++) {
      const w = hist[i];
      if (w === 0) continue;
      const l = i / 255;
      const b = Math.max(0, Math.min(k - 1, Math.floor(l * k)));
      n[b] += w;
      sum[b] += w * l;
    }

    let on = 0;
    for (let i = 0; i < 256; i++) {
      const w = hist[i];
      if (w === 0) continue;
      const l = i / 255;
      const b = Math.max(0, Math.min(k - 1, Math.floor(l * k)));
      if (n[b] === 0) continue;
      if (Math.abs(l - sum[b] / n[b]) <= TOL) on += w;
    }

    return on / total;
  };

  for (let k = MIN_LEVELS; k <= MAX_LEVELS; k++) {
    const covered = coverageAt(k);
    if (covered >= TARGET) {
      if (k > FLAT_LIMIT) break;
      return { levels: k, covered, smooth: false };
    }
  }

  return {
    levels: SMOOTH_FALLBACK,
    covered: coverageAt(SMOOTH_FALLBACK),
    smooth: true,
  };
}
