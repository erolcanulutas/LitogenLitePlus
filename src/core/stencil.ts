import type { Mesh } from "./mesh";
import type { Place } from "./extrude";

/**
 * Where a shape reaches, as a picture.
 *
 * Anything that draws the model from traced regions rather than from a grid
 * has to know where the shape stops, and it has to know it in the picture's
 * own pixels so the outermost region can end there. The shape plugins do not
 * say — they hand back a mesh — so it is read back off the mesh.
 *
 * The read is cheap because of where it looks. The slab's rim is a ring of
 * upright panels around the edge, and the bottom edge of each is one segment
 * of the shape's outline: a few hundred segments to fill between, against the
 * hundreds of thousands of triangles they enclose. Measured on a hexagon,
 * filling the outline took 30 ms where rasterising the triangles took 2.3 s.
 */

/** The shape's bounding box in millimetres, which the picture is drawn over. */
export type Box = { minX: number; maxX: number; minY: number; maxY: number };

export function boxOf(mesh: Mesh, body?: number): Box | null {
  const { positions: p, triangleCount: n, tags } = mesh;
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (let t = 0; t < n; t++) {
    if (body !== undefined && tags && tags[t] !== body) continue;
    const o = t * 9;
    for (let c = 0; c < 3; c++) {
      const x = p[o + c * 3];
      const y = p[o + c * 3 + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (!(maxX > minX) || !(maxY > minY)) return null;
  return { minX, maxX, minY, maxY };
}

/** Picture coordinates back to millimetres. */
export function placeIn(box: Box): Place {
  const spanX = box.maxX - box.minX;
  const spanY = box.maxY - box.minY;
  return (u, v) => ({ x: box.minX + u * spanX, y: box.minY + (1 - v) * spanY });
}

/** One where the shape covers the picture, zero where it does not. */
export function coverOf(
  mesh: Mesh,
  box: Box,
  w: number,
  h: number,
  body?: number,
): Uint8Array {
  const { positions: p, triangleCount: n, tags } = mesh;
  const spanX = box.maxX - box.minX;
  const spanY = box.maxY - box.minY;

  const toPxX = (x: number) => ((x - box.minX) / spanX) * w - 0.5;
  const toPxY = (y: number) => (1 - (y - box.minY) / spanY) * h - 0.5;

  // The floor is the flattest thing in the model and the rim stands on it, so
  // the panels are the ones with an edge down there.
  let floorZ = Infinity;
  for (let t = 0; t < n; t++) {
    if (body !== undefined && tags && tags[t] !== body) continue;
    const o = t * 9;
    for (let c = 0; c < 3; c++) if (p[o + c * 3 + 2] < floorZ) floorZ = p[o + c * 3 + 2];
  }

  type Span = { x0: number; y0: number; x1: number; y1: number; up: number };
  const rim: Span[] = [];

  const edge = (ax: number, ay: number, bx: number, by: number) => {
    const x0 = toPxX(ax);
    const y0 = toPxY(ay);
    const x1 = toPxX(bx);
    const y1 = toPxY(by);
    if (y0 === y1) return;
    rim.push(
      y0 < y1 ? { x0, y0, x1, y1, up: 1 } : { x0: x1, y0: y1, x1: x0, y1: y0, up: -1 },
    );
  };

  for (let t = 0; t < n; t++) {
    if (body !== undefined && tags && tags[t] !== body) continue;
    const o = t * 9;
    const za = p[o + 2], zb = p[o + 5], zc = p[o + 8];
    if (za === zb && zb === zc) continue;
    if (za === floorZ && zb === floorZ) edge(p[o], p[o + 1], p[o + 3], p[o + 4]);
    else if (zb === floorZ && zc === floorZ) edge(p[o + 3], p[o + 4], p[o + 6], p[o + 7]);
    else if (zc === floorZ && za === floorZ) edge(p[o + 6], p[o + 7], p[o], p[o + 1]);
  }

  const cover = new Uint8Array(w * h);

  if (rim.length < 3) {
    // Nothing standing up to follow — the shape fills its own box, so does the
    // picture.
    cover.fill(1);
    return cover;
  }

  const xs: number[] = [];
  const ups: number[] = [];

  for (let y = 0; y < h; y++) {
    xs.length = 0;
    ups.length = 0;
    for (const e of rim) {
      if (y < e.y0 || y >= e.y1) continue;
      xs.push(e.x0 + ((y - e.y0) * (e.x1 - e.x0)) / (e.y1 - e.y0));
      ups.push(e.up);
    }
    if (xs.length < 2) continue;

    const order = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
    let wind = 0;
    for (let i = 0; i + 1 < order.length; i++) {
      wind += ups[order[i]];
      if (wind === 0) continue;
      const from = Math.max(0, Math.ceil(xs[order[i]]));
      const to = Math.min(w - 1, Math.floor(xs[order[i + 1]]));
      for (let x = from; x <= to; x++) cover[y * w + x] = 1;
    }
  }

  return cover;
}

/**
 * Pulls a cover in by `px` pixels, for the band a frame takes up.
 *
 * Chamfer 3-4: a step sideways counts 3 and a step corner-wise 4, which is
 * within a few percent of a true distance and takes two passes over the
 * picture instead of a search.
 */
export function erode(cover: Uint8Array, w: number, h: number, px: number): Uint8Array {
  const FAR = 1 << 28;
  const d = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = cover[i] ? FAR : 0;

  // Past the edge of the picture counts as outside. A shape that fills its own
  // box — a rectangle — has nothing uncovered anywhere, and without this there
  // is nothing for the distance to be measured from and it never pulls in.
  for (let x = 0; x < w; x++) {
    if (d[x]) d[x] = 3;
    const i = (h - 1) * w + x;
    if (d[i]) d[i] = 3;
  }
  for (let y = 0; y < h; y++) {
    const a = y * w;
    if (d[a]) d[a] = 3;
    const b = a + w - 1;
    if (d[b]) d[b] = 3;
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (d[i] === 0) continue;
      let best = d[i];
      if (y > 0) {
        if (x > 0) best = Math.min(best, d[i - w - 1] + 4);
        best = Math.min(best, d[i - w] + 3);
        if (x + 1 < w) best = Math.min(best, d[i - w + 1] + 4);
      }
      if (x > 0) best = Math.min(best, d[i - 1] + 3);
      d[i] = best;
    }
  }

  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (d[i] === 0) continue;
      let best = d[i];
      if (y + 1 < h) {
        if (x + 1 < w) best = Math.min(best, d[i + w + 1] + 4);
        best = Math.min(best, d[i + w] + 3);
        if (x > 0) best = Math.min(best, d[i + w - 1] + 4);
      }
      if (x + 1 < w) best = Math.min(best, d[i + 1] + 3);
      d[i] = best;
    }
  }

  const limit = px * 3;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = d[i] > limit ? 1 : 0;
  return out;
}
