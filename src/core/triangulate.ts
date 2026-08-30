import type { Ring } from "./vectorise";

/**
 * Rings to triangles.
 *
 * A tone's region arrives as a pile of closed rings with no note of which
 * encloses which. Sorting that out is the first half of this: a ring is a hole
 * when an odd number of other rings contain it, and it belongs to the smallest
 * one that does. What comes out is a list of pieces, each an outline with its
 * own holes, which is the shape a triangulator wants.
 *
 * The second half is ear clipping — Mapbox's earcut, ported. Holes are joined
 * to their outline by a bridge, then corners are taken off one at a time,
 * fastest-first through a z-order index, with two fallbacks for the shapes that
 * defeat plain clipping.
 *
 * The point of triangulating properly rather than slicing the shape into bands
 * is that the triangles use the ring's own corners and nothing else. A band
 * slice invents a corner wherever a band edge crosses a ring, and its neighbour
 * on the other side of that ring knows nothing about it — the two surfaces meet
 * along the same line but not at the same points, which is a closed solid that
 * no edge count will agree is closed. Ear clipping cannot do that: every edge
 * it emits runs corner to corner.
 */

export type Piece = {
  /** Interleaved x, y. */
  coords: Float64Array;
  /** Corner indices, three to a triangle, into `coords` by pairs. */
  tris: Uint32Array;
};

/** Whether the ray to the right of a point crosses the ring an odd time. */
function contains(r: Ring, x: number, y: number): boolean {
  const n = r.x.length;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r.x[i], yi = r.y[i];
    const xj = r.x[j], yj = r.y[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * A point definitely inside a ring.
 *
 * A corner will not do — it is on the boundary, where a containment test is
 * entitled to say either. Step off the middle of a side by a hair instead, one
 * way then the other, and take whichever lands inside. A side too short or too
 * thin to have an inside is skipped and the next one tried.
 */
function interiorPoint(r: Ring): { x: number; y: number } {
  const n = r.x.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = r.x[j] - r.x[i];
    const dy = r.y[j] - r.y[i];
    const len = Math.hypot(dx, dy);
    if (len < 1e-12) continue;

    const mx = (r.x[i] + r.x[j]) / 2;
    const my = (r.y[i] + r.y[j]) / 2;
    const ex = (-dy / len) * 1e-7;
    const ey = (dx / len) * 1e-7;

    if (contains(r, mx + ex, my + ey)) return { x: mx + ex, y: my + ey };
    if (contains(r, mx - ex, my - ey)) return { x: mx - ex, y: my - ey };
  }
  return { x: r.x[0], y: r.y[0] };
}

/** One outline and its holes, flattened and clipped. */
function build(outer: Ring, holes: readonly Ring[]): Piece {
  let n = outer.x.length;
  for (const h of holes) n += h.x.length;

  const coords = new Float64Array(n * 2);
  const holeIndices: number[] = [];

  let k = 0;
  for (let i = 0; i < outer.x.length; i++) {
    coords[k++] = outer.x[i];
    coords[k++] = outer.y[i];
  }
  for (const h of holes) {
    holeIndices.push(k / 2);
    for (let i = 0; i < h.x.length; i++) {
      coords[k++] = h.x[i];
      coords[k++] = h.y[i];
    }
  }

  return { coords, tris: Uint32Array.from(earcut(coords, holeIndices)) };
}

/** Every ring of one tone, grouped into outlines with holes and triangulated. */
export function triangulateRegion(rings: readonly Ring[]): Piece[] {
  if (rings.length === 0) return [];

  const probes = rings.map(interiorPoint);
  const depth = new Int32Array(rings.length);
  const parent = new Int32Array(rings.length).fill(-1);

  for (let i = 0; i < rings.length; i++) {
    let best = -1;
    let bestArea = Infinity;
    let d = 0;
    for (let j = 0; j < rings.length; j++) {
      if (i === j) continue;
      if (!contains(rings[j], probes[i].x, probes[i].y)) continue;
      d++;
      const a = Math.abs(rings[j].area);
      if (a < bestArea) {
        bestArea = a;
        best = j;
      }
    }
    depth[i] = d;
    parent[i] = best;
  }

  const pieces: Piece[] = [];
  for (let i = 0; i < rings.length; i++) {
    if (depth[i] & 1) continue;
    const holes: Ring[] = [];
    for (let j = 0; j < rings.length; j++) {
      if (depth[j] & 1 && parent[j] === i) holes.push(rings[j]);
    }
    const piece = build(rings[i], holes);
    if (piece.tris.length) pieces.push(piece);
  }

  return pieces;
}

// ---------------------------------------------------------------------------
// earcut — ported from mapbox/earcut (ISC), fixed to two dimensions.
// ---------------------------------------------------------------------------

type Node = {
  i: number;
  x: number;
  y: number;
  prev: Node;
  next: Node;
  z: number;
  prevZ: Node | null;
  nextZ: Node | null;
  steiner: boolean;
};

export function earcut(data: Float64Array, holeIndices: readonly number[]): number[] {
  const hasHoles = holeIndices.length > 0;
  const outerLen = hasHoles ? holeIndices[0] * 2 : data.length;
  let outerNode = linkedList(data, 0, outerLen, true);
  const triangles: number[] = [];

  if (!outerNode || outerNode.next === outerNode.prev) return triangles;

  if (hasHoles) outerNode = eliminateHoles(data, holeIndices, outerNode);

  let minX = 0;
  let minY = 0;
  let invSize = 0;

  // Big outlines get a z-order index so ear testing does not have to walk the
  // whole ring; small ones are quicker without it.
  if (data.length > 160) {
    minX = data[0];
    minY = data[1];
    let maxX = minX;
    let maxY = minY;
    for (let i = 2; i < outerLen; i += 2) {
      const x = data[i];
      const y = data[i + 1];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    invSize = Math.max(maxX - minX, maxY - minY);
    invSize = invSize !== 0 ? 32767 / invSize : 0;
  }

  earcutLinked(outerNode, triangles, minX, minY, invSize, 0);
  return triangles;
}

function linkedList(
  data: Float64Array,
  start: number,
  end: number,
  clockwise: boolean,
): Node | null {
  let last: Node | null = null;

  if (clockwise === signedArea(data, start, end) > 0) {
    for (let i = start; i < end; i += 2) last = insertNode(i, data[i], data[i + 1], last);
  } else {
    for (let i = end - 2; i >= start; i -= 2) last = insertNode(i, data[i], data[i + 1], last);
  }

  if (last && equals(last, last.next)) {
    removeNode(last);
    last = last.next;
  }
  return last;
}

/** Drops repeated and straight-through corners. */
function filterPoints(start: Node | null, end?: Node | null): Node | null {
  if (!start) return start;
  let e = end || start;

  let p = start;
  let again: boolean;
  do {
    again = false;
    if (!p.steiner && (equals(p, p.next) || area(p.prev, p, p.next) === 0)) {
      removeNode(p);
      p = e = p.prev;
      if (p === p.next) break;
      again = true;
    } else {
      p = p.next;
    }
  } while (again || p !== e);

  return e;
}

function earcutLinked(
  ear: Node | null,
  triangles: number[],
  minX: number,
  minY: number,
  invSize: number,
  pass: number,
): void {
  if (!ear) return;

  if (!pass && invSize) indexCurve(ear, minX, minY, invSize);

  let stop = ear;

  while (ear!.prev !== ear!.next) {
    const prev: Node = ear!.prev;
    const next: Node = ear!.next;

    if (invSize ? isEarHashed(ear!, minX, minY, invSize) : isEar(ear!)) {
      triangles.push(prev.i / 2, ear!.i / 2, next.i / 2);
      removeNode(ear!);
      ear = next.next;
      stop = next.next;
      continue;
    }

    ear = next;

    if (ear === stop) {
      // Nothing left is an ear on its own terms, so try harder: first drop
      // corners that only failed because the ring touches itself, then cut the
      // ring in two at a diagonal and do each half.
      if (!pass) {
        earcutLinked(filterPoints(ear), triangles, minX, minY, invSize, 1);
      } else if (pass === 1) {
        const filtered = filterPoints(ear);
        const cured = cureLocalIntersections(filtered!, triangles);
        earcutLinked(cured, triangles, minX, minY, invSize, 2);
      } else if (pass === 2) {
        splitEarcut(ear!, triangles, minX, minY, invSize);
      }
      break;
    }
  }
}

function isEar(ear: Node): boolean {
  const a = ear.prev;
  const b = ear;
  const c = ear.next;

  if (area(a, b, c) >= 0) return false;

  const ax = a.x, bx = b.x, cx = c.x;
  const ay = a.y, by = b.y, cy = c.y;

  const x0 = Math.min(ax, bx, cx);
  const y0 = Math.min(ay, by, cy);
  const x1 = Math.max(ax, bx, cx);
  const y1 = Math.max(ay, by, cy);

  let p = c.next;
  while (p !== a) {
    if (
      p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 &&
      pointInTriangleExceptFirst(ax, ay, bx, by, cx, cy, p.x, p.y) &&
      area(p.prev, p, p.next) >= 0
    ) {
      return false;
    }
    p = p.next;
  }
  return true;
}

function isEarHashed(ear: Node, minX: number, minY: number, invSize: number): boolean {
  const a = ear.prev;
  const b = ear;
  const c = ear.next;

  if (area(a, b, c) >= 0) return false;

  const ax = a.x, bx = b.x, cx = c.x;
  const ay = a.y, by = b.y, cy = c.y;

  const x0 = Math.min(ax, bx, cx);
  const y0 = Math.min(ay, by, cy);
  const x1 = Math.max(ax, bx, cx);
  const y1 = Math.max(ay, by, cy);

  const minZ = zOrder(x0, y0, minX, minY, invSize);
  const maxZ = zOrder(x1, y1, minX, minY, invSize);

  let p: Node | null = ear.prevZ;
  let n: Node | null = ear.nextZ;

  while (p && p.z >= minZ && n && n.z <= maxZ) {
    if (
      p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 &&
      p !== a && p !== c &&
      pointInTriangleExceptFirst(ax, ay, bx, by, cx, cy, p.x, p.y) &&
      area(p.prev, p, p.next) >= 0
    ) {
      return false;
    }
    p = p.prevZ;

    if (
      n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1 &&
      n !== a && n !== c &&
      pointInTriangleExceptFirst(ax, ay, bx, by, cx, cy, n.x, n.y) &&
      area(n.prev, n, n.next) >= 0
    ) {
      return false;
    }
    n = n.nextZ;
  }

  while (p && p.z >= minZ) {
    if (
      p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 &&
      p !== a && p !== c &&
      pointInTriangleExceptFirst(ax, ay, bx, by, cx, cy, p.x, p.y) &&
      area(p.prev, p, p.next) >= 0
    ) {
      return false;
    }
    p = p.prevZ;
  }

  while (n && n.z <= maxZ) {
    if (
      n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1 &&
      n !== a && n !== c &&
      pointInTriangleExceptFirst(ax, ay, bx, by, cx, cy, n.x, n.y) &&
      area(n.prev, n, n.next) >= 0
    ) {
      return false;
    }
    n = n.nextZ;
  }

  return true;
}

/** Clips corners off where the ring crosses itself. */
function cureLocalIntersections(start: Node, triangles: number[]): Node | null {
  let p = start;
  do {
    const a = p.prev;
    const b = p.next.next;

    if (
      !equals(a, b) &&
      intersects(a, p, p.next, b) &&
      locallyInside(a, b) &&
      locallyInside(b, a)
    ) {
      triangles.push(a.i / 2, p.i / 2, b.i / 2);
      removeNode(p);
      removeNode(p.next);
      p = start = b;
    }
    p = p.next;
  } while (p !== start);

  return filterPoints(p);
}

/** Cuts the ring in two along a diagonal and clips each half. */
function splitEarcut(
  start: Node,
  triangles: number[],
  minX: number,
  minY: number,
  invSize: number,
): void {
  let a = start;
  do {
    let b = a.next.next;
    while (b !== a.prev) {
      if (a.i !== b.i && isValidDiagonal(a, b)) {
        let c: Node | null = splitPolygon(a, b);
        a = filterPoints(a, a.next)!;
        c = filterPoints(c, c.next);
        earcutLinked(a, triangles, minX, minY, invSize, 0);
        earcutLinked(c, triangles, minX, minY, invSize, 0);
        return;
      }
      b = b.next;
    }
    a = a.next;
  } while (a !== start);
}

function eliminateHoles(
  data: Float64Array,
  holeIndices: readonly number[],
  outerNode: Node | null,
): Node | null {
  const queue: Node[] = [];

  for (let i = 0; i < holeIndices.length; i++) {
    const start = holeIndices[i] * 2;
    const end = i < holeIndices.length - 1 ? holeIndices[i + 1] * 2 : data.length;
    const list = linkedList(data, start, end, false);
    if (list) {
      if (list === list.next) list.steiner = true;
      queue.push(getLeftmost(list));
    }
  }

  queue.sort((a, b) => a.x - b.x || a.y - b.y);

  let node = outerNode;
  for (const hole of queue) node = eliminateHole(hole, node);
  return node;
}

function eliminateHole(hole: Node, outerNode: Node | null): Node | null {
  const bridge = findHoleBridge(hole, outerNode!);
  if (!bridge) return outerNode;

  const bridgeReverse = splitPolygon(bridge, hole);
  filterPoints(bridgeReverse, bridgeReverse.next);
  return filterPoints(bridge, bridge.next);
}

/** The nearest place on the outline the hole may be joined to. */
function findHoleBridge(hole: Node, outerNode: Node): Node | null {
  let p = outerNode;
  const hx = hole.x;
  const hy = hole.y;
  let qx = -Infinity;
  let m: Node | null = null;

  if (equals(hole, p)) return p;
  do {
    if (equals(hole, p.next)) return p.next;
    if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
      const x = p.x + ((hy - p.y) * (p.next.x - p.x)) / (p.next.y - p.y);
      if (x <= hx && x > qx) {
        qx = x;
        m = p.x < p.next.x ? p : p.next;
        if (x === hx) return m;
      }
    }
    p = p.next;
  } while (p !== outerNode);

  if (!m) return null;

  const stop = m;
  const mx = m.x;
  const my = m.y;
  let tanMin = Infinity;

  p = m;
  do {
    if (
      hx >= p.x && p.x >= mx && hx !== p.x &&
      pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)
    ) {
      const tan = Math.abs(hy - p.y) / (hx - p.x);
      if (
        locallyInside(p, hole) &&
        (tan < tanMin ||
          (tan === tanMin && (p.x > m!.x || (p.x === m!.x && sectorContainsSector(m!, p)))))
      ) {
        m = p;
        tanMin = tan;
      }
    }
    p = p.next;
  } while (p !== stop);

  return m;
}

function sectorContainsSector(m: Node, p: Node): boolean {
  return area(m.prev, m, p.prev) < 0 && area(p.next, m, m.next) < 0;
}

function indexCurve(start: Node, minX: number, minY: number, invSize: number): void {
  let p = start;
  do {
    if (p.z === 0) p.z = zOrder(p.x, p.y, minX, minY, invSize);
    p.prevZ = p.prev;
    p.nextZ = p.next;
    p = p.next;
  } while (p !== start);

  p.prevZ!.nextZ = null;
  p.prevZ = null;
  sortLinked(p);
}

/** Merge sort along the z chain. */
function sortLinked(list: Node | null): Node | null {
  let inSize = 1;

  for (;;) {
    let p = list;
    let tail: Node | null = null;
    let numMerges = 0;
    list = null;

    while (p) {
      numMerges++;
      let q: Node | null = p;
      let pSize = 0;
      for (let i = 0; i < inSize; i++) {
        pSize++;
        q = q.nextZ;
        if (!q) break;
      }
      let qSize = inSize;

      while (pSize > 0 || (qSize > 0 && q)) {
        let e: Node;
        if (pSize !== 0 && (qSize === 0 || !q || p!.z <= q.z)) {
          e = p!;
          p = p!.nextZ;
          pSize--;
        } else {
          e = q!;
          q = q!.nextZ;
          qSize--;
        }

        if (tail) tail.nextZ = e;
        else list = e;

        e.prevZ = tail;
        tail = e;
      }

      p = q;
    }

    tail!.nextZ = null;
    if (numMerges <= 1) return list;
    inSize *= 2;
  }
}

/** Interleaved 16-bit coordinates, so near points get near numbers. */
function zOrder(x: number, y: number, minX: number, minY: number, invSize: number): number {
  let a = ((x - minX) * invSize) | 0;
  let b = ((y - minY) * invSize) | 0;

  a = (a | (a << 8)) & 0x00ff00ff;
  a = (a | (a << 4)) & 0x0f0f0f0f;
  a = (a | (a << 2)) & 0x33333333;
  a = (a | (a << 1)) & 0x55555555;

  b = (b | (b << 8)) & 0x00ff00ff;
  b = (b | (b << 4)) & 0x0f0f0f0f;
  b = (b | (b << 2)) & 0x33333333;
  b = (b | (b << 1)) & 0x55555555;

  return a | (b << 1);
}

function getLeftmost(start: Node): Node {
  let p = start;
  let leftmost = start;
  do {
    if (p.x < leftmost.x || (p.x === leftmost.x && p.y < leftmost.y)) leftmost = p;
    p = p.next;
  } while (p !== start);
  return leftmost;
}

function pointInTriangle(
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
  px: number, py: number,
): boolean {
  return (
    (cx - px) * (ay - py) >= (ax - px) * (cy - py) &&
    (ax - px) * (by - py) >= (bx - px) * (ay - py) &&
    (bx - px) * (cy - py) >= (cx - px) * (by - py)
  );
}

function pointInTriangleExceptFirst(
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
  px: number, py: number,
): boolean {
  return !(ax === px && ay === py) && pointInTriangle(ax, ay, bx, by, cx, cy, px, py);
}

function isValidDiagonal(a: Node, b: Node): boolean {
  return (
    a.next.i !== b.i &&
    a.prev.i !== b.i &&
    !intersectsPolygon(a, b) &&
    ((locallyInside(a, b) &&
      locallyInside(b, a) &&
      middleInside(a, b) &&
      (area(a.prev, a, b.prev) !== 0 || area(a, b.prev, b) !== 0)) ||
      (equals(a, b) && area(a.prev, a, a.next) > 0 && area(b.prev, b, b.next) > 0))
  );
}

function area(p: Node, q: Node, r: Node): number {
  return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
}

function equals(p1: Node, p2: Node): boolean {
  return p1.x === p2.x && p1.y === p2.y;
}

function intersects(p1: Node, q1: Node, p2: Node, q2: Node): boolean {
  const o1 = sign(area(p1, q1, p2));
  const o2 = sign(area(p1, q1, q2));
  const o3 = sign(area(p2, q2, p1));
  const o4 = sign(area(p2, q2, q1));

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;
  return false;
}

function onSegment(p: Node, q: Node, r: Node): boolean {
  return (
    q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) &&
    q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y)
  );
}

function sign(num: number): number {
  return num > 0 ? 1 : num < 0 ? -1 : 0;
}

function intersectsPolygon(a: Node, b: Node): boolean {
  let p = a;
  do {
    if (
      p.i !== a.i && p.next.i !== a.i && p.i !== b.i && p.next.i !== b.i &&
      intersects(p, p.next, a, b)
    ) {
      return true;
    }
    p = p.next;
  } while (p !== a);
  return false;
}

function locallyInside(a: Node, b: Node): boolean {
  return area(a.prev, a, a.next) < 0
    ? area(a, b, a.next) >= 0 && area(a, a.prev, b) >= 0
    : area(a, b, a.prev) < 0 || area(a, a.next, b) < 0;
}

function middleInside(a: Node, b: Node): boolean {
  let p = a;
  let inside = false;
  const px = (a.x + b.x) / 2;
  const py = (a.y + b.y) / 2;
  do {
    if (
      p.y > py !== p.next.y > py &&
      p.next.y !== p.y &&
      px < ((p.next.x - p.x) * (py - p.y)) / (p.next.y - p.y) + p.x
    ) {
      inside = !inside;
    }
    p = p.next;
  } while (p !== a);
  return inside;
}

/** Cuts one ring into two, or joins two into one, along a-b. */
function splitPolygon(a: Node, b: Node): Node {
  const a2 = makeNode(a.i, a.x, a.y);
  const b2 = makeNode(b.i, b.x, b.y);
  const an = a.next;
  const bp = b.prev;

  a.next = b;
  b.prev = a;

  a2.next = an;
  an.prev = a2;

  b2.next = a2;
  a2.prev = b2;

  bp.next = b2;
  b2.prev = bp;

  return b2;
}

function makeNode(i: number, x: number, y: number): Node {
  const n = {
    i, x, y,
    prev: null as unknown as Node,
    next: null as unknown as Node,
    z: 0,
    prevZ: null,
    nextZ: null,
    steiner: false,
  };
  return n;
}

function insertNode(i: number, x: number, y: number, last: Node | null): Node {
  const p = makeNode(i, x, y);

  if (!last) {
    p.prev = p;
    p.next = p;
  } else {
    p.next = last.next;
    p.prev = last;
    last.next.prev = p;
    last.next = p;
  }
  return p;
}

function removeNode(p: Node): void {
  p.next.prev = p.prev;
  p.prev.next = p.next;
  if (p.prevZ) p.prevZ.nextZ = p.nextZ;
  if (p.nextZ) p.nextZ.prevZ = p.prevZ;
}

function signedArea(data: Float64Array, start: number, end: number): number {
  let sum = 0;
  for (let i = start, j = end - 2; i < end; i += 2) {
    sum += (data[j] - data[i]) * (data[i + 1] + data[j + 1]);
    j = i;
  }
  return sum;
}
