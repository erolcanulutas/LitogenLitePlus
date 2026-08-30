/**
 * The picture as shapes, not as brightness.
 *
 * Everything else here reads a brightness field and decides tones by comparing
 * it against thresholds. That cannot be made to work for a picture whose tones
 * are not evenly spaced: black at 0.00, white at 0.99 and red at 0.29 means the
 * field has to pass through red on its way from white to black, so red appears
 * along every edge where those two meet. It can be thinned — squeezed, graded,
 * masked — and it always comes back somewhere, because it is not an artefact of
 * the sampling. It is what a continuous field between two values does.
 *
 * This does not sample. It quantises the picture to its tones once, cleans up
 * what the quantising leaves behind, traces the outline of each tone's region
 * as a closed ring of points, and hands those rings on. A ring between white
 * and black is one line. There is no third tone along it because there is
 * nowhere for one to be.
 */

/** Label for a pixel the shape does not cover, so it belongs to no tone. */
const OUTSIDE = 255;

/** A closed ring of points in image coordinates, 0..1 in both axes. */
export type Ring = {
  x: Float64Array;
  y: Float64Array;
  /** Positive area means it encloses; negative means it is a hole. */
  area: number;
};

/** Every ring belonging to one tone, outers and holes together. */
export type ToneRegion = {
  tone: number;
  rings: Ring[];
};

export type Vectorised = {
  levels: number;
  regions: ToneRegion[];
};

/**
 * Which tone each pixel is, with the transition pixels resolved.
 *
 * Anti-aliasing puts a few pixels of every intermediate value along each edge.
 * Left alone they quantise to whatever tone happens to sit at that brightness,
 * which is how a white shape on black ends up outlined in red. A pixel on such
 * an edge belongs to one of the two tones the edge is between, and the way to
 * tell which is to look at what is actually around it rather than at its own
 * value: take the two tones that dominate its neighbourhood and give it to
 * whichever of those two it is nearer.
 */
function quantise(
  lum: Float64Array,
  w: number,
  h: number,
  tones: readonly number[],
  mask?: Uint8Array,
): Uint8Array {
  const n = w * h;
  const at = new Uint8Array(n).fill(OUTSIDE);

  const nearest = (v: number, only?: [number, number]) => {
    let best = only ? only[0] : 0;
    let bestD = Infinity;
    if (only) {
      for (const k of only) {
        const d = Math.abs(v - tones[k]);
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
      return best;
    }
    for (let k = 0; k < tones.length; k++) {
      const d = Math.abs(v - tones[k]);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    return best;
  };

  for (let i = 0; i < n; i++) {
    if (mask && mask[i] === 0) continue;
    at[i] = nearest(lum[i]);
  }

  // A pixel is on a transition when it is not flat: its own value sits well
  // away from the tone it was given. Those are the ones to re-decide, and only
  // those, so nothing that is genuinely its own colour is touched.
  const FLAT = 0.06;
  const R = 3;
  const out = new Uint8Array(at);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (at[i] === OUTSIDE) continue;
      if (Math.abs(lum[i] - tones[at[i]]) <= FLAT) continue;

      // The two tones that dominate the neighbourhood, counting only pixels
      // that are flat — a transition pixel has no business voting.
      const votes = new Float64Array(tones.length);
      const y0 = Math.max(0, y - R);
      const y1 = Math.min(h - 1, y + R);
      const x0 = Math.max(0, x - R);
      const x1 = Math.min(w - 1, x + R);
      for (let b = y0; b <= y1; b++) {
        for (let a = x0; a <= x1; a++) {
          const j = b * w + a;
          if (at[j] === OUTSIDE) continue;
          if (Math.abs(lum[j] - tones[at[j]]) > FLAT) continue;
          votes[at[j]]++;
        }
      }

      let first = -1;
      let second = -1;
      for (let k = 0; k < tones.length; k++) {
        if (first < 0 || votes[k] > votes[first]) {
          second = first;
          first = k;
        } else if (second < 0 || votes[k] > votes[second]) {
          second = k;
        }
      }
      if (first < 0 || votes[first] === 0) continue;
      if (second < 0 || votes[second] === 0) {
        out[i] = first;
        continue;
      }

      out[i] = nearest(lum[i], [first, second]);
    }
  }

  return out;
}

/**
 * The outline of one tone's region, as closed rings.
 *
 * Built from the cracks between pixels rather than by walking their centres.
 * Every pixel of the tone contributes the crack on each side where the tone
 * stops, pointed so the tone is always on the same hand, and the cracks are
 * then linked end to end into loops. Nothing about that can drift or fail to
 * close: a crack is a unit step between two grid corners, every corner has as
 * many cracks arriving as leaving, and a loop ends when it returns to where it
 * started because there is nowhere else for it to go.
 */
function traceRings(
  at: Uint8Array,
  w: number,
  h: number,
  tone: number,
): Ring[] {
  const inside = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h && at[y * w + x] === tone;

  // Corners are (w + 1) by (h + 1); a segment is named by the corner it leaves.
  const cw = w + 1;
  const from: number[] = [];
  const to: number[] = [];
  const head = new Int32Array(cw * (h + 1)).fill(-1);
  const next = new Int32Array(4 * w * h).fill(-1);

  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const s = from.length;
    const a0 = y0 * cw + x0;
    from.push(a0);
    to.push(y1 * cw + x1);
    next[s] = head[a0];
    head[a0] = s;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (at[y * w + x] !== tone) continue;
      if (!inside(x, y - 1)) add(x, y, x + 1, y);
      if (!inside(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!inside(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!inside(x - 1, y)) add(x, y + 1, x, y);
    }
  }

  const used = new Uint8Array(from.length);
  const rings: Ring[] = [];

  for (let s0 = 0; s0 < from.length; s0++) {
    if (used[s0]) continue;

    const px: number[] = [];
    const py: number[] = [];
    let s = s0;

    for (;;) {
      used[s] = 1;
      px.push(from[s] % cw);
      py.push((from[s] / cw) | 0);

      const at2 = to[s];
      if (at2 === from[s0]) break;

      let nxt = -1;
      for (let e = head[at2]; e >= 0; e = next[e]) {
        if (!used[e]) {
          nxt = e;
          break;
        }
      }
      if (nxt < 0) break;
      s = nxt;
    }

    if (px.length < 4) continue;
    rings.push(makeRing(px, py, w, h));
  }

  return rings;
}

/** Signed area, and the ring packed into typed arrays in 0..1 coordinates. */
function makeRing(px: number[], py: number[], w: number, h: number): Ring {
  const n = px.length;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  let twice = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    twice += px[i] * py[j] - px[j] * py[i];
    x[i] = px[i] / w;
    y[i] = py[i] / h;
  }
  return { x, y, area: twice / 2 / (w * h) };
}

/**
 * Takes the staircase out of a ring without rounding its corners off.
 *
 * A ring walked along the cracks between pixels is all right angles. Chaikin's
 * corner cutting turns that into a curve in a couple of passes, and would keep
 * going until everything was a circle — two passes is enough to lose the steps
 * and not enough to lose a corner the artist drew.
 */
function smoothRing(r: Ring, passes: number): Ring {
  let x = r.x;
  let y = r.y;

  for (let p = 0; p < passes; p++) {
    const n = x.length;
    const nx = new Float64Array(n * 2);
    const ny = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      nx[i * 2] = 0.75 * x[i] + 0.25 * x[j];
      ny[i * 2] = 0.75 * y[i] + 0.25 * y[j];
      nx[i * 2 + 1] = 0.25 * x[i] + 0.75 * x[j];
      ny[i * 2 + 1] = 0.25 * y[i] + 0.75 * y[j];
    }
    x = nx;
    y = ny;
  }

  let twice = 0;
  for (let i = 0; i < x.length; i++) {
    const j = (i + 1) % x.length;
    twice += x[i] * y[j] - x[j] * y[i];
  }
  return { x, y, area: twice / 2 };
}

/** Drops points a straight line would have passed through anyway. */
function simplifyRing(r: Ring, tol: number): Ring {
  const n = r.x.length;
  if (n < 8) return r;

  const keep = new Uint8Array(n);
  keep[0] = 1;

  let anchor = 0;
  for (let i = 1; i < n; i++) {
    const j = (i + 1) % n;
    const ax = r.x[anchor], ay = r.y[anchor];
    const bx = r.x[j], by = r.y[j];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    const d =
      len < 1e-12
        ? Math.hypot(r.x[i] - ax, r.y[i] - ay)
        : Math.abs((r.x[i] - ax) * dy - (r.y[i] - ay) * dx) / len;
    if (d > tol) {
      keep[i] = 1;
      anchor = i;
    }
  }

  let m = 0;
  for (let i = 0; i < n; i++) if (keep[i]) m++;
  if (m < 4) return r;

  const x = new Float64Array(m);
  const y = new Float64Array(m);
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (!keep[i]) continue;
    x[k] = r.x[i];
    y[k] = r.y[i];
    k++;
  }

  let twice = 0;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    twice += x[i] * y[j] - x[j] * y[i];
  }
  return { x, y, area: twice / 2 };
}

/**
 * The picture turned into one closed outline per tone.
 *
 * @param tones      Brightness of each tone, darkest first.
 * @param smoothPx   How far a corner may be dropped from where the smoothing
 *                   put it, in pixels. This has to stay well under half a
 *                   pixel: a step is half a pixel deep, so a looser tolerance
 *                   than that throws the smoothed curve away and puts the
 *                   staircase back exactly as it was.
 * @param mask       Zero where the shape does not reach, so no tone is traced
 *                   there and the outermost ring follows the shape's own edge.
 */
export function vectorise(
  lum: Float64Array,
  w: number,
  h: number,
  tones: readonly number[],
  smoothPx = 0.1,
  mask?: Uint8Array,
): Vectorised {
  const at = quantise(lum, w, h, tones, mask);

  const regions: ToneRegion[] = [];
  for (let k = 0; k < tones.length; k++) {
    const raw = traceRings(at, w, h, k);
    const rings: Ring[] = [];
    for (const r of raw) {
      // Rings of a pixel or two are quantising noise, not shapes.
      if (Math.abs(r.area) * w * h < 3) continue;
      rings.push(simplifyRing(smoothRing(r, 2), smoothPx / Math.max(w, h)));
    }
    regions.push({ tone: k, rings });
  }

  return { levels: tones.length, regions };
}
