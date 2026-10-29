/**
 * Tones by colour rather than by brightness.
 *
 * tones.ts finds a picture's tones on a brightness axis, which is the right
 * thing for a relief — thickness is brightness — and the wrong thing for an
 * inlay, where a tone is only a colour of filament. On that axis a red flag and
 * a navy suit sit on the same value (0.209 and 0.209 in the picture that showed
 * it), so they land in one band and print as one muddy colour.
 *
 * Here a tone is a cluster of similar colours instead. Pixels are grouped in
 * CIE Lab, where distance is close to how different two colours look, so red
 * and navy are far apart however alike their brightness is.
 */

export type Lab = [number, number, number];

export type ColourTones = {
  /** Cluster centres in Lab, ordered darkest first. */
  lab: Lab[];
  /** The average colour of what each cluster holds, as #rrggbb, same order. */
  colors: string[];
  /** Index of the cluster covering most of the picture. */
  dominant: number;
  /** Share of the picture within FLAT_DE of its centre, 0..1. */
  covered: number;
};

/** A pixel this close to its centre is simply that colour, not an edge. */
const FLAT_DE = 14;

/** Share of the picture that has to land flat before a count is accepted. */
const TARGET = 0.97;

const MIN_LEVELS = 2;
const MAX_LEVELS = 16;

/** Past this many colours a picture is a photograph, not flat artwork. */
const FLAT_LIMIT = 8;

/** What a photograph gets when there is nothing flat to measure. */
const PHOTO_LEVELS = 5;

const LIN = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);

function toLab(r: number, g: number, b: number, out: Lab): Lab {
  const lr = LIN[r], lg = LIN[g], lb = LIN[b];
  const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047;
  const y = 0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb;
  const z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / 1.08883;
  const fx = f(x), fy = f(y), fz = f(z);
  out[0] = 116 * fy - 16;
  out[1] = 500 * (fx - fy);
  out[2] = 200 * (fy - fz);
  return out;
}

const d2 = (a: Lab, b: Lab) =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

const hex = (v: number) =>
  Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");

/** Colours of the picture, bucketed to 5 bits a channel, with their weight. */
type Bins = {
  n: number;
  count: Float64Array;
  lab: Lab[];
  r: Float64Array;
  g: Float64Array;
  b: Float64Array;
  total: number;
};

function binsOf(img: ImageData): Bins {
  const key = new Map<number, number>();
  const count: number[] = [];
  const sr: number[] = [];
  const sg: number[] = [];
  const sb: number[] = [];
  const d = img.data;
  let total = 0;

  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const k = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
    let j = key.get(k);
    if (j === undefined) {
      j = count.length;
      key.set(k, j);
      count.push(0);
      sr.push(0);
      sg.push(0);
      sb.push(0);
    }
    count[j]++;
    sr[j] += d[i];
    sg[j] += d[i + 1];
    sb[j] += d[i + 2];
    total++;
  }

  const n = count.length;
  const lab: Lab[] = [];
  for (let j = 0; j < n; j++) {
    lab.push(toLab(Math.round(sr[j] / count[j]), Math.round(sg[j] / count[j]), Math.round(sb[j] / count[j]), [0, 0, 0]));
  }

  return {
    n,
    count: Float64Array.from(count),
    lab,
    r: Float64Array.from(sr),
    g: Float64Array.from(sg),
    b: Float64Array.from(sb),
    total,
  };
}

/**
 * k centres over the bins, weighted by how much of the picture each holds.
 *
 * Seeded by weight times squared distance from what is already chosen, which
 * picks the biggest areas of colour that are not yet represented — so a red
 * flag is found before a pocket square's grey shadow. Nothing is random: the
 * same picture and count always give the same answer, which the worker relies
 * on to agree with the panel about which tone is which.
 */
function fit(bins: Bins, k: number): { centres: Lab[]; inertia: number } {
  const centres: Lab[] = [];

  let first = 0;
  for (let j = 1; j < bins.n; j++) if (bins.count[j] > bins.count[first]) first = j;
  centres.push([...bins.lab[first]] as Lab);

  const near = new Float64Array(bins.n);
  for (let j = 0; j < bins.n; j++) near[j] = d2(bins.lab[j], centres[0]);

  while (centres.length < k) {
    let pick = -1;
    let best = 0;
    for (let j = 0; j < bins.n; j++) {
      const score = bins.count[j] * near[j];
      if (score > best) {
        best = score;
        pick = j;
      }
    }
    if (pick < 0) break;
    const c = [...bins.lab[pick]] as Lab;
    centres.push(c);
    for (let j = 0; j < bins.n; j++) near[j] = Math.min(near[j], d2(bins.lab[j], c));
  }

  const kk = centres.length;
  const owner = new Int32Array(bins.n);

  for (let pass = 0; pass < 40; pass++) {
    const sum = Array.from({ length: kk }, () => [0, 0, 0]);
    const cnt = new Float64Array(kk);

    for (let j = 0; j < bins.n; j++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < kk; c++) {
        const dd = d2(bins.lab[j], centres[c]);
        if (dd < bestD) {
          bestD = dd;
          best = c;
        }
      }
      owner[j] = best;
      const w = bins.count[j];
      sum[best][0] += w * bins.lab[j][0];
      sum[best][1] += w * bins.lab[j][1];
      sum[best][2] += w * bins.lab[j][2];
      cnt[best] += w;
    }

    let moved = 0;
    for (let c = 0; c < kk; c++) {
      if (cnt[c] === 0) continue;
      const next: Lab = [sum[c][0] / cnt[c], sum[c][1] / cnt[c], sum[c][2] / cnt[c]];
      moved = Math.max(moved, Math.sqrt(d2(next, centres[c])));
      centres[c] = next;
    }
    if (moved < 0.01) break;
  }

  let inertia = 0;
  for (let j = 0; j < bins.n; j++) inertia += bins.count[j] * d2(bins.lab[j], centres[owner[j]]);

  return { centres, inertia };
}

/** Darkest first; ties broken by hue so the order never depends on rounding. */
function ordered(centres: Lab[]): Lab[] {
  return centres
    .slice()
    .sort((a, b) => a[0] - b[0] || Math.atan2(a[2], a[1]) - Math.atan2(b[2], b[1]));
}

function describe(bins: Bins, centres: Lab[]): ColourTones {
  const k = centres.length;
  const r = new Float64Array(k);
  const g = new Float64Array(k);
  const b = new Float64Array(k);
  const n = new Float64Array(k);
  let flat = 0;

  for (let j = 0; j < bins.n; j++) {
    let best = 0;
    let bestD = Infinity;
    for (let c = 0; c < k; c++) {
      const dd = d2(bins.lab[j], centres[c]);
      if (dd < bestD) {
        bestD = dd;
        best = c;
      }
    }
    r[best] += bins.r[j];
    g[best] += bins.g[j];
    b[best] += bins.b[j];
    n[best] += bins.count[j];
    if (Math.sqrt(bestD) <= FLAT_DE) flat += bins.count[j];
  }

  let dominant = 0;
  const colors: string[] = [];
  for (let c = 0; c < k; c++) {
    if (n[c] > n[dominant]) dominant = c;
    if (n[c] > 0) {
      colors.push(`#${hex(r[c] / n[c])}${hex(g[c] / n[c])}${hex(b[c] / n[c])}`);
    } else {
      const grey = hex((centres[c][0] / 100) * 255);
      colors.push(`#${grey}${grey}${grey}`);
    }
  }

  return { lab: centres, colors, dominant, covered: bins.total === 0 ? 0 : flat / bins.total };
}

/** The colours a picture is made of, at a given count, darkest first. */
export function clusterColors(img: ImageData, levels: number): ColourTones {
  const k = Math.round(Math.min(MAX_LEVELS, Math.max(MIN_LEVELS, levels)));
  const bins = binsOf(img);
  if (bins.n === 0) {
    const grey: Lab = [50, 0, 0];
    return { lab: Array.from({ length: k }, () => grey), colors: Array(k).fill("#808080"), dominant: 0, covered: 0 };
  }
  return describe(bins, ordered(fit(bins, k).centres));
}

/**
 * How many colours a picture needs.
 *
 * The smallest count where nearly every pixel sits on a colour is the number
 * the artwork was drawn with. A photograph never gets there — it keeps
 * improving with every extra colour — so it is given a fixed count instead.
 */
export function suggestColourLevels(img: ImageData): ColourTones & { levels: number; smooth: boolean } {
  const bins = binsOf(img);
  if (bins.n === 0) return { ...clusterColors(img, PHOTO_LEVELS), levels: PHOTO_LEVELS, smooth: true };

  for (let k = MIN_LEVELS; k <= FLAT_LIMIT; k++) {
    const found = describe(bins, ordered(fit(bins, k).centres));
    if (found.covered >= TARGET) return { ...found, levels: k, smooth: false };
  }

  return { ...describe(bins, ordered(fit(bins, PHOTO_LEVELS).centres)), levels: PHOTO_LEVELS, smooth: true };
}

/**
 * Which colour each pixel is.
 *
 * A pixel that is not close to any centre is on an edge — anti-aliasing puts a
 * few pixels of in-between colour along every boundary, and the in-between of
 * red and navy is a purple that is nearest to some third colour altogether.
 * Those are re-decided from what is around them: of the two colours that
 * dominate the flat pixels nearby, it goes to the nearer. This is the same
 * treatment the brightness path gives its edges, done in colour.
 */
export function labelByColor(img: ImageData, centres: readonly Lab[]): Uint8Array {
  const w = img.width;
  const h = img.height;
  const k = centres.length;
  const d = img.data;
  const at = new Uint8Array(w * h);
  const dist = new Float32Array(w * h);
  const px: Lab = [0, 0, 0];

  for (let i = 0; i < w * h; i++) {
    toLab(d[i * 4], d[i * 4 + 1], d[i * 4 + 2], px);
    let best = 0;
    let bestD = Infinity;
    for (let c = 0; c < k; c++) {
      const dd = d2(px, centres[c]);
      if (dd < bestD) {
        bestD = dd;
        best = c;
      }
    }
    at[i] = best;
    dist[i] = Math.sqrt(bestD);
  }

  const out = new Uint8Array(at);
  const R = 3;
  const votes = new Float64Array(k);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (dist[i] <= FLAT_DE) continue;

      votes.fill(0);
      for (let b = Math.max(0, y - R); b <= Math.min(h - 1, y + R); b++) {
        for (let a = Math.max(0, x - R); a <= Math.min(w - 1, x + R); a++) {
          const j = b * w + a;
          if (dist[j] <= FLAT_DE) votes[at[j]]++;
        }
      }

      let first = -1;
      let second = -1;
      for (let c = 0; c < k; c++) {
        if (votes[c] === 0) continue;
        if (first < 0 || votes[c] > votes[first]) {
          second = first;
          first = c;
        } else if (second < 0 || votes[c] > votes[second]) {
          second = c;
        }
      }
      if (first < 0) continue;
      if (second < 0) {
        out[i] = first;
        continue;
      }

      toLab(d[i * 4], d[i * 4 + 1], d[i * 4 + 2], px);
      out[i] = d2(px, centres[first]) <= d2(px, centres[second]) ? first : second;
    }
  }

  return out;
}
