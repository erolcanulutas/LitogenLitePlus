/**
 * The boundaries between tones, as curves each drawn once.
 *
 * Tracing every region's outline separately gives each boundary twice — once
 * from the tone on each side — and the two copies are the same staircase, so
 * they match and the solids fit together. The moment either copy is smoothed
 * they stop matching, because smoothing one region's ring is a different sum
 * from smoothing the other's: the windows run past the point where three tones
 * meet and pick up different neighbours. That is why every attempt to take the
 * staircase out by moving points tore the picture apart at the joints, and why
 * the only answer left was to hide the staircase under more pixels.
 *
 * So the boundaries are cut up first and smoothed once. The picture's edges
 * form a net: junctions where three or more tones meet, and arcs running
 * between them, each arc with exactly one tone on either side. An arc is
 * smoothed on its own with its junctions pinned, and both the tones it divides
 * are then built from that same smoothed arc, point for point. They cannot
 * disagree — there is only one copy to disagree with.
 *
 * Smoothing is repeated averaging with each point kept within `limit` of where
 * it started. A pixel step is half a pixel deep and disappears inside that
 * budget; a corner the artist drew is deeper than the budget, spends it and
 * stops, so it survives as a corner with a fraction of a pixel of rounding.
 * Nothing here decides which is which — the budget separates them.
 */

/** A boundary between two tones, or between a tone and nothing, once. */
export type Arc = {
  /** Corner indices as traced, for matching a ring against. */
  corners: Int32Array;
  /** The smoothed curve, in corner coordinates. */
  x: Float64Array;
  y: Float64Array;
};

export type Net = {
  arcs: Arc[];
  /** Which arc each crack belongs to. */
  arcOf: Int32Array;
  /** Where in that arc it sits, as the step from corner i to corner i + 1. */
  posOf: Int32Array;
  /** How many cracks each arc spans. */
  spanOf: Int32Array;
};

/**
 * Cracks are the unit steps between pixels, indexed by the pixel edge they lie
 * on: the horizontal ones first, then the vertical.
 */
export function buildNet(
  at: Uint8Array,
  w: number,
  h: number,
  outside: number,
  limit: number,
  passes: number,
): Net {
  const cw = w + 1;
  const hn = (h + 1) * w;
  const total = hn + h * cw;

  const lab = (x: number, y: number) =>
    x < 0 || y < 0 || x >= w || y >= h ? outside : at[y * w + x];

  const pair = new Int32Array(total);
  for (let y = 0; y <= h; y++) {
    for (let x = 0; x < w; x++) {
      const a = lab(x, y - 1);
      const b = lab(x, y);
      pair[y * w + x] = a === b ? -1 : a < b ? a * 256 + b : b * 256 + a;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x <= w; x++) {
      const a = lab(x - 1, y);
      const b = lab(x, y);
      pair[hn + y * cw + x] = a === b ? -1 : a < b ? a * 256 + b : b * 256 + a;
    }
  }

  /** A crack's two corners, lowest index first. */
  const ends = [0, 0];
  const endsOf = (id: number) => {
    if (id < hn) {
      const y = (id / w) | 0;
      const x = id - y * w;
      ends[0] = y * cw + x;
      ends[1] = y * cw + x + 1;
    } else {
      const k = id - hn;
      const y = (k / cw) | 0;
      const x = k - y * cw;
      ends[0] = y * cw + x;
      ends[1] = (y + 1) * cw + x;
    }
  };

  /** The cracks meeting at a corner, at most four. */
  const buf = new Int32Array(4);
  const around = (c: number): number => {
    const y = (c / cw) | 0;
    const x = c - y * cw;
    let n = 0;
    if (x > 0 && pair[y * w + x - 1] >= 0) buf[n++] = y * w + x - 1;
    if (x < w && pair[y * w + x] >= 0) buf[n++] = y * w + x;
    if (y > 0 && pair[hn + (y - 1) * cw + x] >= 0) buf[n++] = hn + (y - 1) * cw + x;
    if (y < h && pair[hn + y * cw + x] >= 0) buf[n++] = hn + y * cw + x;
    return n;
  };

  // A boundary carries straight on through a corner only when exactly two
  // meet there and they divide the same two tones. Anything else is a
  // junction, and gets pinned so the arcs either side of it stay joined.
  const junction = (c: number): boolean => {
    const n = around(c);
    if (n !== 2) return n > 0;
    return pair[buf[0]] !== pair[buf[1]];
  };

  const arcOf = new Int32Array(total).fill(-1);
  const posOf = new Int32Array(total).fill(-1);
  const arcs: Arc[] = [];
  const spans: number[] = [];

  const walk = (start: number, first: number, toJunction: boolean) => {
    const corners: number[] = [start];
    let count = 0;
    let c = start;
    let e = first;

    for (;;) {
      arcOf[e] = arcs.length;
      posOf[e] = count;
      count++;

      endsOf(e);
      c = ends[0] === c ? ends[1] : ends[0];
      corners.push(c);

      if (c === start) break;
      if (toJunction && junction(c)) break;

      const n = around(c);
      let step = -1;
      for (let i = 0; i < n; i++) {
        if (buf[i] !== e && arcOf[buf[i]] < 0) {
          step = buf[i];
          break;
        }
      }
      if (step < 0) break;
      e = step;
    }

    arcs.push(fit(corners, cw, limit, passes, c === start));
    spans.push(count);
  };

  // Arcs between junctions first, so every junction ends up pinned.
  const corners = cw * (h + 1);
  for (let c = 0; c < corners; c++) {
    if (!junction(c)) continue;
    const n = around(c);
    const seeds = Array.from(buf.subarray(0, n));
    for (const e of seeds) if (arcOf[e] < 0) walk(c, e, true);
  }

  // Then whatever is left, which is a boundary meeting nothing else and so
  // closing on itself with no junction to start from.
  for (let e = 0; e < total; e++) {
    if (pair[e] < 0 || arcOf[e] >= 0) continue;
    endsOf(e);
    walk(ends[0], e, false);
  }

  return { arcs, arcOf, posOf, spanOf: Int32Array.from(spans) };
}

/** Smooths one arc, holding its ends where they are unless it closes on itself. */
function fit(
  corners: number[],
  cw: number,
  limit: number,
  passes: number,
  loop: boolean,
): Arc {
  // A loop arrives with its first corner repeated at the end. Drop the repeat
  // so the averaging can run all the way round, and put it back afterwards.
  const n = loop ? corners.length - 1 : corners.length;

  const ox = new Float64Array(n);
  const oy = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    ox[i] = corners[i] % cw;
    oy[i] = (corners[i] / cw) | 0;
  }

  const x = Float64Array.from(ox);
  const y = Float64Array.from(oy);

  if (n >= 4) {
    const nx = new Float64Array(n);
    const ny = new Float64Array(n);

    for (let p = 0; p < passes; p++) {
      for (let i = 0; i < n; i++) {
        if (!loop && (i === 0 || i === n - 1)) {
          nx[i] = x[i];
          ny[i] = y[i];
          continue;
        }
        const a = (i + n - 1) % n;
        const b = (i + 1) % n;

        let px = (x[a] + 2 * x[i] + x[b]) / 4;
        let py = (y[a] + 2 * y[i] + y[b]) / 4;

        const dx = px - ox[i];
        const dy = py - oy[i];
        const d = Math.hypot(dx, dy);
        if (d > limit) {
          px = ox[i] + (dx / d) * limit;
          py = oy[i] + (dy / d) * limit;
        }
        nx[i] = px;
        ny[i] = py;
      }
      x.set(nx);
      y.set(ny);
    }
  }

  const out = Int32Array.from(corners);
  if (!loop) return { corners: out, x, y };

  const lx = new Float64Array(n + 1);
  const ly = new Float64Array(n + 1);
  lx.set(x);
  ly.set(y);
  lx[n] = x[0];
  ly[n] = y[0];
  return { corners: out, x: lx, y: ly };
}
