import { buildNet, type Net } from "./arcs";

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
 * what the quantising leaves behind, cuts the boundaries between tones into
 * arcs and smooths each arc once (see core/arcs.ts), then assembles each tone's
 * outline out of those arcs. A boundary between white and black is one curve,
 * shared by both, with nothing in between for a third tone to occupy.
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
 * The outline of one tone's region, as closed rings built out of shared arcs.
 *
 * The walk itself is over the cracks between pixels: every pixel of the tone
 * contributes the crack on each side where the tone stops, pointed so the tone
 * is always on the same hand, and the cracks are linked end to end into loops.
 * Nothing about that can drift or fail to close — a crack is a unit step
 * between two grid corners, every corner has as many cracks arriving as
 * leaving, and a loop ends when it returns to where it started.
 *
 * What is laid down is not the cracks, though. Each run of them belongs to one
 * arc of the net, and the arc's smoothed curve is what goes into the ring. The
 * tone on the other side of that arc lays down the very same points backwards,
 * so the two solids meet exactly however much the arc was smoothed.
 */
function traceRings(
  at: Uint8Array,
  w: number,
  h: number,
  tone: number,
  net: Net,
): Ring[] {
  const inside = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h && at[y * w + x] === tone;

  const cw = w + 1;
  const hn = (h + 1) * w;

  const from: number[] = [];
  const to: number[] = [];
  const crack: number[] = [];
  const head = new Int32Array(cw * (h + 1)).fill(-1);
  const next: number[] = [];

  const add = (a: number, b: number, id: number) => {
    const s = from.length;
    from.push(a);
    to.push(b);
    crack.push(id);
    next.push(head[a]);
    head[a] = s;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (at[y * w + x] !== tone) continue;
      const c = y * cw + x;
      if (!inside(x, y - 1)) add(c, c + 1, y * w + x);
      if (!inside(x + 1, y)) add(c + 1, c + 1 + cw, hn + y * cw + x + 1);
      if (!inside(x, y + 1)) add(c + 1 + cw, c + cw, (y + 1) * w + x);
      if (!inside(x - 1, y)) add(c + cw, c, hn + y * cw + x);
    }
  }

  const used = new Uint8Array(from.length);
  const rings: Ring[] = [];

  const px: number[] = [];
  const py: number[] = [];
  const seqFrom: number[] = [];
  const seqCrack: number[] = [];

  for (let s0 = 0; s0 < from.length; s0++) {
    if (used[s0]) continue;

    seqFrom.length = 0;
    seqCrack.length = 0;
    let s = s0;

    for (;;) {
      used[s] = 1;
      seqFrom.push(from[s]);
      seqCrack.push(crack[s]);

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

    if (seqFrom.length < 4) continue;

    px.length = 0;
    py.length = 0;
    layArcs(seqFrom, seqCrack, net, cw, px, py);
    if (px.length < 4) continue;

    rings.push(makeRing(px, py, w, h));
  }

  return rings;
}

/**
 * Turns a ring's run of cracks into its run of arcs.
 *
 * The walk has to start where an arc does, or the first arc would be entered
 * halfway along with no way to lay it down whole, so the sequence is rotated to
 * the first such place. If there is none, the boundary is a single closed arc
 * with no junction on it and can be started anywhere. If the runs do not line
 * up at all — which takes a boundary that stopped short — the corners
 * themselves are laid down and that one ring goes unsmoothed rather than wrong.
 */
function layArcs(
  seqFrom: readonly number[],
  seqCrack: readonly number[],
  net: Net,
  cw: number,
  px: number[],
  py: number[],
): void {
  const m = seqCrack.length;
  const { arcs, arcOf, posOf, spanOf } = net;

  const raw = () => {
    px.length = 0;
    py.length = 0;
    for (let i = 0; i < m; i++) {
      px.push(seqFrom[i] % cw);
      py.push((seqFrom[i] / cw) | 0);
    }
  };

  let start = -1;
  for (let i = 0; i < m; i++) {
    const a = arcOf[seqCrack[i]];
    if (a < 0) return raw();
    const p = posOf[seqCrack[i]];
    const forward = arcs[a].corners[p] === seqFrom[i];
    if (forward ? p === 0 : p === spanOf[a] - 1) {
      start = i;
      break;
    }
  }
  if (start < 0) start = 0;

  let i = 0;
  while (i < m) {
    const k = (start + i) % m;
    const id = seqCrack[k];
    const a = arcOf[id];
    if (a < 0) return raw();

    const arc = arcs[a];
    const span = spanOf[a];
    if (i + span > m) return raw();

    const forward = arc.corners[posOf[id]] === seqFrom[k];
    const L = arc.x.length;
    if (forward) {
      for (let j = 0; j < L - 1; j++) {
        px.push(arc.x[j]);
        py.push(arc.y[j]);
      }
    } else {
      for (let j = L - 1; j > 0; j--) {
        px.push(arc.x[j]);
        py.push(arc.y[j]);
      }
    }

    i += span;
  }
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
 * The picture turned into one closed outline per tone.
 *
 * @param tones      Brightness of each tone, darkest first.
 * @param smoothPx   How far a boundary may be moved to lose the pixel steps,
 *                   in pixels. A step is half a pixel deep, so anything from
 *                   about that upwards flattens the staircase; what the number
 *                   really sets is how much rounding a corner the artist drew
 *                   is allowed, since a corner spends the whole budget and
 *                   then stops.
 * @param mask       Zero where the shape does not reach, so no tone is traced
 *                   there and the outermost ring follows the shape's own edge.
 * @param minAreaPx  Smallest region worth keeping, in square pixels. The
 *                   quantising leaves specks a few pixels across along the
 *                   busier edges, and a speck narrower than a printed line is
 *                   a colour the printer cannot lay down anyway.
 */
export function vectorise(
  lum: Float64Array,
  w: number,
  h: number,
  tones: readonly number[],
  smoothPx = 1,
  mask?: Uint8Array,
  minAreaPx = 3,
): Vectorised {
  const at = quantise(lum, w, h, tones, mask);

  // Enough passes that the averaging reaches a couple of pixels either side,
  // which is what it takes to flatten a staircase rather than round it off.
  const net = buildNet(at, w, h, OUTSIDE, smoothPx, 24);

  const regions: ToneRegion[] = [];
  for (let k = 0; k < tones.length; k++) {
    const rings: Ring[] = [];
    for (const r of traceRings(at, w, h, k, net)) {
      // Too small to be a shape, or to print if it were.
      if (Math.abs(r.area) * w * h < minAreaPx) continue;
      rings.push(r);
    }
    regions.push({ tone: k, rings });
  }

  return { levels: tones.length, regions };
}
