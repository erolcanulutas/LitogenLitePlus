export type Pt = [number, number];

/** The outline of a shape that is not a rectangle, as the frame has to follow it. */
export type OutlineShape = "circle" | "hexagon" | "pentagon" | "triangle";

const CIRCLE_SEGMENTS = 96;

/**
 * A shape's outline, counter-clockwise, centred on its bounding box and sized
 * to `w` by `h`.
 *
 * Each follows what its lithophane generator draws: the hexagon has corners
 * left and right, the pentagon and the triangle stand on a flat edge. All are
 * convex, which is what lets the frame be offset and hulled simply.
 */
export function shapeOutline(shape: OutlineShape, w: number, h: number): Pt[] {
  let raw: Pt[];
  if (shape === "circle") {
    raw = Array.from({ length: CIRCLE_SEGMENTS }, (_, k) => {
      const a = (k * 2 * Math.PI) / CIRCLE_SEGMENTS;
      return [Math.cos(a), Math.sin(a)] as Pt;
    });
  } else if (shape === "hexagon") {
    raw = Array.from({ length: 6 }, (_, k) => [Math.cos((k * Math.PI) / 3), Math.sin((k * Math.PI) / 3)] as Pt);
  } else if (shape === "pentagon") {
    const theta0 = -Math.PI / 2 + Math.PI / 5;
    raw = Array.from({ length: 5 }, (_, k) => {
      const t = theta0 + (k * 2 * Math.PI) / 5;
      return [Math.cos(t), Math.sin(t)] as Pt;
    });
  } else {
    raw = [
      [-0.5, 0],
      [0.5, 0],
      [0, Math.sqrt(3) / 2],
    ];
  }
  const xs = raw.map((p) => p[0]);
  const ys = raw.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  return raw.map(([x, y]): Pt => [((x - (x0 + x1) / 2) / (x1 - x0)) * w, ((y - (y0 + y1) / 2) / (y1 - y0)) * h]);
}

/** A convex polygon moved sideways by `d` (outwards if positive), corners kept sharp. */
export function offsetConvex(poly: readonly Pt[], d: number): Pt[] {
  const n = poly.length;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = poly[(i + n - 1) % n];
    const b = poly[i];
    const c = poly[(i + 1) % n];
    // Outward normals of a counter-clockwise polygon are on the right of each edge.
    const n1 = norm(a, b);
    const n2 = norm(b, c);
    const mx = n1[0] + n2[0];
    const my = n1[1] + n2[1];
    // The corner moves along the bisector far enough to keep both edges `d` away.
    const k = d / Math.max(0.2, (mx * n1[0] + my * n1[1]) / 2);
    out.push([b[0] + (mx / 2) * k, b[1] + (my / 2) * k]);
  }
  return out;
}

function norm(p: Pt, q: Pt): Pt {
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const len = Math.hypot(dx, dy) || 1;
  return [dy / len, -dx / len];
}

/** The convex hull, counter-clockwise (Andrew's monotone chain). */
export function convexHull(points: readonly Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-9) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-9) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * How far a point is outside a convex counter-clockwise polygon: negative
 * inside, by how deep. The farthest of its edges decides, which is exact for
 * a convex shape.
 */
export function outsideBy(poly: readonly Pt[], x: number, y: number): number {
  let worst = -Infinity;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const d = ((x - a[0]) * dy - (y - a[1]) * dx) / len;
    if (d > worst) worst = d;
  }
  return worst;
}
