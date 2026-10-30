import { MeshBuilder, type Mesh } from "./mesh";
import { atY, atZ, cap, frustum, holeWall, roundedBox, wall, type V3 } from "./solids";
import { PRONG, armAngle } from "./prong";
import { STAND_DEFAULTS } from "./stand";
import { convexHull, offsetConvex, type Pt } from "./outline";
import { bendAroundY, stripeX, stripWidth } from "./bend";

/**
 * The frame a lithophane is slid into, and the two legs that stand on the stand.
 *
 * Built lying on its front: the back face is z = 0, the picture goes in there,
 * and the legs hang off it towards -z. Standing the finished part up is the
 * caller's business; everything here is in the plate's own terms, x across, y
 * up the picture, z through it.
 *
 *   back  ┌──────────────┐   the picture drops into a pocket from behind,
 *         │ ┌──────────┐ │   under a lip that leaves a window smaller than
 *         │ │  pocket  │ │   the picture, so it cannot fall out the front.
 *         │ └──────────┘ │   Two small ramps in the side walls click it in.
 *         └──┬────────┬──┘
 *            ╲legs   ╱      Each leg is a block with a channel cut up into
 *                           its underside, wide for the stand's arm and
 *                           narrower above for its prong. The arm's tip sits
 *                           inside, hidden, so the leg's underside and the
 *                           stand's underside are one plane.
 *
 * Tilted back by `tiltDeg`, the stand stays flat while the plate leans, so
 * the channels stay upright, the underside of the legs and rail is cut to the
 * table plane rather than to the plate, and the legs sit further back and
 * the rail grows to hold them: the plate overhangs the prong as it leans.
 *
 * Shells that touch are left as separate solids rather than fused: the legs
 * are built from blocks that meet face to face, and sit on the plate's back
 * face. A slicer joins what touches.
 */
export type HolderParams = {
  /** Size of the lithophane it holds, in mm. */
  pictureW: number;
  pictureH: number;
  pictureT: number;

  /** Width of the frame around the pocket. */
  border: number;
  /** How far the lip covers the picture's edge, all round. */
  lip: number;
  /** Room left round the picture in the pocket, each side. */
  pocketPlay: number;
  /** Thickness of the lip in front of the picture. */
  lipThickness: number;
  /** Ramps in the side walls that hold the picture in. */
  clips: boolean;

  /** Across the leg, along x. At least wide enough for the channel and its walls. */
  legWidth: number;
  /**
   * From the plate's back edge to the middle of the prong, at the least. A
   * leaning plate pushes it further back, so this is the upright distance.
   */
  socketDepth: number;

  /** What the stand's prong looks like, so the channel can match it. */
  prongSpacing: number;
  prongReach: number;
  prongSize: number;
  prongHeight: number;
  taperDeg: number;
  /** Gap between the stand and the channel, all round. */
  fit: number;

  /** How far the plate leans back from upright, 0 to 45 degrees. */
  tiltDeg: number;

  /** Radius the frame's outer corners are rounded to, in mm. 0 leaves them square. */
  corner: number;

  /**
   * The picture's outline when it is not a rectangle, counter-clockwise and
   * centred on its bounding box. The frame then follows it, and fills the
   * ground between the shape and the legs.
   */
  outline?: Pt[] | null;

  /**
   * Radius the plate is wrapped round, about its vertical axis, for a curved
   * picture. The frame is built flat and bent at the end, like the picture is;
   * the legs stay straight. Upright only. 0 or absent is a flat frame.
   */
  bend?: number;
};

/** The loops of a frame that follows a shape, in the front face's terms. */
export type FramePoly = { outer: Pt[]; window: Pt[]; pocket: Pt[] };

/**
 * How far apart the legs should stand for a frame that follows a shape.
 *
 * The stand's prongs set it, and a stand that is wide for the shape's underside
 * makes the frame flare out to meet it. So the legs are brought in until they
 * stand within the shape's own lowest edge; a round shape has no such edge and
 * takes a narrow stand. The stand is made to the same spacing.
 */
export function legSpacingFor(outline: Pt[] | null | undefined, params: Partial<HolderParams>): number {
  if (!outline || outline.length < 3) return PRONG.spacing;
  const border = params.border ?? HOLDER_DEFAULTS.border;
  const ring = offsetConvex(outline, border);
  const low = Math.min(...ring.map((q) => q[1]));
  const bottom = ring.filter((q) => q[1] < low + 0.01);
  if (bottom.length < 2) return 30;
  const half = Math.max(...bottom.map((q) => Math.abs(q[0])));
  // Closer until the base the legs stand on is no wider than the shape's lowest edge.
  let spacing: number = PRONG.spacing;
  while (spacing > 26) {
    const L = holderLayout({ ...params, outline, prongSpacing: spacing });
    if (L.baseHalf <= half) break;
    spacing -= 0.5;
  }
  return Math.max(26, spacing);
}

/** How far in from the plate's back face the picture's back sits, in mm. */
export const PICTURE_SEAT_MM = 0.9;

/** A hole cut clean through the frame, as a closed outline in front-face mm. */
export type CutLoop = [number, number][];

/** Pockets sunk into the frame's face, to be filled level with it, and how deep. */
export type Recess = { outer: CutLoop[]; islands: CutLoop[]; depth: number };

/** Whether a point is inside a loop, by counting the edges a ray to the right crosses. */
function inLoop(p: [number, number], loop: CutLoop): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, yi] = loop[i];
    const [xj, yj] = loop[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** How close a cut-out may come to the frame's edge and to the pocket, in mm. */
export const CUT_MARGIN_MM = 1.2;

export const HOLDER_DEFAULTS: HolderParams = {
  pictureW: 100,
  pictureH: 80,
  pictureT: 3,
  border: 10,
  lip: 3,
  pocketPlay: 0.05,
  lipThickness: 2,
  clips: true,
  legWidth: 10,
  socketDepth: 9.5,
  prongSpacing: PRONG.spacing,
  prongReach: PRONG.reach,
  prongSize: PRONG.size,
  prongHeight: PRONG.height,
  taperDeg: PRONG.taperDeg,
  fit: 0.2,
  tiltDeg: 0,
  corner: 0,
};

/**
 * Where everything on the holder is, before any of it is built.
 *
 * The front face runs from the left edge x = 0 to `width` and from the bottom
 * y = 0 to `height`, with a window in it; the decorations are placed on that
 * face, so they need these numbers as much as the build does.
 */
export function holderLayout(input: Partial<HolderParams> = {}) {
  const p = { ...HOLDER_DEFAULTS, ...input };

  const bend = p.bend && p.bend > 0 ? p.bend : 0;
  const tilt = bend > 0 ? 0 : (Math.min(45, Math.max(0, p.tiltDeg)) * Math.PI) / 180;
  const ct = Math.cos(tilt);
  const tt = Math.tan(tilt);

  // Just deep enough for the picture and the catch behind it: slack here is
  // the picture rattling front to back.
  const pocketDepth = p.pictureT + PICTURE_SEAT_MM;
  const T = pocketDepth + p.lipThickness;

  let W = p.pictureW + 2 * p.border;

  // The channel, measured up from the table: the arm fills the lower part, the
  // prong the narrower part above it, and a roof of 1.5 mm closes it.
  const armH = STAND_DEFAULTS.armHeight;
  const h1 = armH + p.fit;
  const h2 = armH + p.prongHeight + p.fit;
  const top = h2 + 1.5;
  const half = p.prongSize / 2 + p.fit;
  const armWide = STAND_DEFAULTS.armWidth + 2 * p.fit;
  const legW = Math.max(p.legWidth, armWide + 3.2);

  // A plate leaning back overhangs what is behind it: at the height of the
  // channel's roof its back face has moved back by top * tan(tilt). The prong
  // has to be clear of that, with room for the wall in front of it.
  const socketDepth = Math.max(p.socketDepth, top * tt + half + 4);

  // A curved plate falls away from the legs' plane either side of the middle.
  // It is set forward until its back face is on that plane where the legs meet
  // it, and the legs' near face is taken in far enough to reach it across the
  // leg's width and sink a millimetre into the plate.
  const sagAt = (dx: number) => (bend > 0 ? bend * (1 - Math.cos(Math.min(dx / bend, 1.5))) : 0);
  const legAlpha = armAngle(p.prongSpacing, p.prongReach);
  const legRoot = p.prongSpacing / 2 + socketDepth * Math.tan(legAlpha);
  const lift = sagAt(legRoot);
  const zNear = bend > 0 ? lift - sagAt(Math.max(0, legRoot - (Math.cos(legAlpha) * legW) / 2)) + 1 : 0;

  // The leg's near face is the plate's own back face, which at the roof's
  // height is top / cos(tilt) up the plate, and the picture starts above that.
  const rail = Math.max(p.border - 0.5, top / ct + 0.5);

  const pocketW = p.pictureW + 2 * p.pocketPlay;
  const pocketH = p.pictureH + 2 * p.pocketPlay;
  let H = rail + pocketH + p.border - p.pocketPlay;

  // Rounding cannot take more than half of either side, and the legs stand on
  // the rail, so it stops short of them.
  let corner = Math.max(0, Math.min(p.corner, W / 2 - 2, H / 2 - 2, 30));

  const winW = p.pictureW - 2 * p.lip;
  const winH = p.pictureH - 2 * p.lip;
  const winY = rail + pocketH / 2;

  // A shape that is not a rectangle: the frame is the shape grown by the
  // border, joined down to a base the legs stand on. The hull of the two is
  // what fills the gaps between them.
  let poly: FramePoly | null = null;
  let baseHalf = 0;
  let window = { x0: W / 2 - winW / 2, x1: W / 2 + winW / 2, y0: winY - winH / 2, y1: winY + winH / 2 };
  let pocket = { x0: W / 2 - pocketW / 2, x1: W / 2 + pocketW / 2, y0: rail, y1: rail + pocketH };
  if (p.outline && p.outline.length >= 3) {
    // The legs lean in as they go back, so they are furthest apart where they
    // meet the plate. Seen from the front they must stay behind it, and the
    // plate leans too, so at its underside this is what the base has to span.
    const alpha = armAngle(p.prongSpacing, p.prongReach);
    let legReach = p.prongSpacing / 2 + legW / 2;
    for (const t of [-legW / 2, legW / 2]) {
      for (const h of [0, top]) {
        const sAlong = (-socketDepth - Math.sin(alpha) * t + h * tt) / Math.cos(alpha);
        legReach = Math.max(legReach, p.prongSpacing / 2 - Math.sin(alpha) * sAlong + Math.cos(alpha) * t);
      }
    }
    baseHalf = legReach + 1.5;
    const cy = rail + pocketH / 2;
    // The ring's corners may reach below the table plane; it is cut off there.
    const flat = (pts: Pt[]): Pt[] => {
      const out: Pt[] = [];
      for (let k = 0; k < pts.length; k++) {
        const a = pts[k];
        const b = pts[(k + 1) % pts.length];
        if (a[1] >= 0) out.push(a);
        if ((a[1] >= 0) !== (b[1] >= 0)) {
          const f = a[1] / (a[1] - b[1]);
          out.push([a[0] + (b[0] - a[0]) * f, 0]);
        }
      }
      return out;
    };
    const grown = offsetConvex(p.outline, p.border).map(([x, y]): Pt => [x, y + cy]);
    const reach = Math.max(baseHalf, ...grown.map((q) => Math.abs(q[0])));
    W = 2 * reach;
    const cx = W / 2;
    const at = (pts: Pt[]): Pt[] => pts.map(([x, y]): Pt => [x + cx, y + cy]);
    const ring = flat(grown).map(([x, y]): Pt => [x + cx, y]);
    // The frame runs down from the shape to the base the legs stand on in
    // straight lines, so the shape's own outline is not widened to meet them.
    const outer = convexHull([...ring, [cx - baseHalf, 0], [cx + baseHalf, 0]]);
    const win = at(offsetConvex(p.outline, -p.lip));
    const pock = at(offsetConvex(p.outline, p.pocketPlay));
    H = Math.max(...outer.map((q) => q[1]));
    corner = 0;
    poly = { outer, window: win, pocket: pock };
    const bound = (pts: Pt[]) => ({
      x0: Math.min(...pts.map((q) => q[0])),
      x1: Math.max(...pts.map((q) => q[0])),
      y0: Math.min(...pts.map((q) => q[1])),
      y1: Math.max(...pts.map((q) => q[1])),
    });
    window = bound(win);
    pocket = bound(pock);
  }

  return {
    p, tilt, T, pocketDepth, W, H, rail, corner, poly, baseHalf, bend, lift, zNear,
    pocketW, pocketH,
    socketDepth, legW, h1, h2, top, half, armWide,
    /** The window the picture shows through, in the front face's terms. */
    window,
    /** The pocket behind it, which no decoration may stand over. */
    pocket,
  };
}

export function buildHolder(
  input: Partial<HolderParams> = {},
  cuts: readonly CutLoop[] = [],
  recess: Recess | null = null,
): Mesh {
  const L = holderLayout(input);
  const { p, T, pocketDepth, W, H, rail, corner, pocketW, pocketH } = L;
  const mb = new MeshBuilder(2048);
  // The legs are kept apart: a curved plate is bent, and they stay straight.
  const lb = new MeshBuilder(1024);

  const st = Math.sin(L.tilt);
  const ct = Math.cos(L.tilt);
  const tt = Math.tan(L.tilt);
  const taper = Math.tan((p.taperDeg * Math.PI) / 180);

  // The table plane, in the plate's terms, is y = -z tan(tilt). A point on it
  // that is `wy` out from the plate's back edge (negative behind it) sits at:
  const onTable = (wx: number, wy: number): V3 => [wx, -wy * st, wy * ct];
  // Straight up from the table, which is where the stand's prongs point.
  const up: V3 = [0, ct, st];
  const lift = (v: V3, h: number): V3 => [v[0] + up[0] * h, v[1] + up[1] * h, v[2] + up[2] * h];

  const box = (x0: number, x1: number, y0: number, y1: number): [number, number][] => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  const pocket: [number, number][] = L.poly ? L.poly.pocket : box(L.pocket.x0, L.pocket.x1, L.pocket.y0, L.pocket.y1);
  const window: [number, number][] = L.poly ? L.poly.window : box(L.window.x0, L.window.x1, L.window.y0, L.window.y1);

  const outline: [number, number][] = L.poly ? L.poly.outer : roundedBox(0, W, 0, H, corner);
  const outerBack = atZ(outline, 0);
  // The front face's lower edge reaches down to the table plane, so the whole
  // underside of the plate lies on it; round a corner and the arc rises from
  // that edge by the same amount it climbs.
  const outerFront = atZ(outline, T).map((v): V3 => {
    const k = v[1] <= 1e-9 ? 1 : corner > 0 && v[1] < corner ? 1 - v[1] / corner : 0;
    return [v[0], v[1] - T * tt * k, v[2]];
  });

  // The plate: one shell, stepped from the pocket to the window, with any
  // cut-outs going clean through it.
  cap(mb, outerBack, [atZ(pocket, 0), ...cuts.map((c) => atZ(c, 0))], [0, 0, -1]);
  wall(mb, atZ(pocket, 0), atZ(pocket, pocketDepth), false);
  cap(mb, atZ(pocket, pocketDepth), [atZ(window, pocketDepth)], [0, 0, -1]);
  wall(mb, atZ(window, pocketDepth), atZ(window, T), false);
  // The loops of a recess nest: a pocket in the face, an island of face standing
  // in it, a pocket sunk in that island, and so on. How deep one is decides what
  // it is: even is a pocket, odd is an island. Each is bounded by the loops
  // directly inside it, which come out of it as holes.
  const loops: CutLoop[] = recess ? [...recess.outer, ...recess.islands] : [];
  const sizeOf = (l: CutLoop) => {
    let a = 0;
    for (let k = 0; k < l.length; k++) {
      const m = (k + 1) % l.length;
      a += l[k][0] * l[m][1] - l[m][0] * l[k][1];
    }
    return Math.abs(a / 2);
  };
  const areas = loops.map(sizeOf);
  const parent = loops.map((l, k) => {
    let best = -1;
    for (let m = 0; m < loops.length; m++) {
      if (m !== k && inLoop(l[0], loops[m]) && (best < 0 || areas[m] < areas[best])) best = m;
    }
    return best;
  });
  const depth = (k: number): number => (parent[k] < 0 ? 0 : depth(parent[k]) + 1);
  const level = loops.map((_, k) => depth(k));
  const pockets = loops.filter((_, k) => level[k] === 0);

  cap(mb, outerFront, [atZ(window, T), ...cuts.map((c) => atZ(c, T)), ...pockets.map((c) => atZ(c, T))], [0, 0, 1]);
  wall(mb, outerBack, outerFront, true);
  for (const c of cuts) holeWall(mb, c, 0, T);

  if (recess && loops.length > 0) {
    const floor = T - recess.depth;
    loops.forEach((loop, k) => {
      const inside = loops.filter((_, m) => parent[m] === k);
      if (level[k] % 2 === 0) {
        holeWall(mb, loop, floor, T);
        cap(mb, atZ(loop, floor), inside.map((c) => atZ(c, floor)), [0, 0, 1]);
      } else {
        holeWall(mb, loop, floor, T, "out");
        cap(mb, atZ(loop, T), inside.map((c) => atZ(c, T)), [0, 0, 1]);
      }
    });
  }

  if (p.clips && !L.poly) {
    const x0 = W / 2 - pocketW / 2;
    const x1 = W / 2 + pocketW / 2;
    const half = 7;
    // The catch stands out by the play plus a fixed 0.3 mm, so the squeeze on
    // the picture is the same however snug the pocket is.
    const bump = p.pocketPlay + 0.3;
    // A catch, not a bump: a gentle ramp the picture rides over on its way in,
    // then a steep face behind which its back edge settles. The picture sits
    // at pocketDepth - pictureT = 0.9 from the back, just clear of that face.
    const profile = (x: number, dir: number): [number, number][] => [
      [x, 0.05],
      [x + dir * bump, 0.55],
      [x + dir * bump, 0.62],
      [x, 0.72],
    ];
    const yc = rail + pocketH / 2;
    const spread = Math.min(pocketH / 2 - half - 4, 16);
    const rows = spread > 4 ? [yc - spread, yc + spread] : [yc];
    for (const [x, dir] of [[x0, 1], [x1, -1]] as const) {
      for (const y of rows) {
        const a = atY(profile(x, dir), y - half);
        const b = atY(profile(x, dir), y + half);
        cap(mb, a, [], [0, -1, 0]);
        cap(mb, b, [], [0, 1, 0]);
        wall(mb, a, b, true);
      }
    }
  }

  if (p.clips && L.poly) {
    // The same catch along the pocket's own edges: one at the middle of each
    // side of a polygon, six evenly round a circle. Each is a short bar along
    // the edge with its foot sunk into the wall, so it joins the frame whether
    // the wall is straight or a shallow arc.
    const ring = L.poly.pocket;
    const bump = p.pocketPlay + 0.3;
    const half = 7;
    const sink = 0.4;
    const prof: [number, number][] = [
      [-sink, 0.05],
      [bump, 0.55],
      [bump, 0.62],
      [-sink, 0.72],
    ];
    const lens = ring.map((q, k) => Math.hypot(ring[(k + 1) % ring.length][0] - q[0], ring[(k + 1) % ring.length][1] - q[1]));
    const total = lens.reduce((x, y) => x + y, 0);
    /** The point at distance `d` along the pocket's edge, counter-clockwise from its first corner. */
    const along = (d: number): [number, number] => {
      let r = ((d % total) + total) % total;
      for (let k = 0; k < ring.length; k++) {
        if (r <= lens[k]) {
          const q = ring[k];
          const w = ring[(k + 1) % ring.length];
          const f = lens[k] > 0 ? r / lens[k] : 0;
          return [q[0] + (w[0] - q[0]) * f, q[1] + (w[1] - q[1]) * f];
        }
        r -= lens[k];
      }
      return ring[0];
    };
    const spots: number[] = [];
    if (ring.length <= 8) {
      let run = 0;
      lens.forEach((len) => {
        if (len >= 2 * half + 4) spots.push(run + len / 2);
        run += len;
      });
    } else {
      for (let k = 0; k < 6; k++) spots.push(((k + 0.5) * total) / 6);
    }
    for (const at of spots) {
      const c = along(at);
      const before = along(at - 4);
      const after = along(at + 4);
      const dl = Math.hypot(after[0] - before[0], after[1] - before[1]) || 1;
      const d: [number, number] = [(after[0] - before[0]) / dl, (after[1] - before[1]) / dl];
      // Counter-clockwise, the inside is on the left of the way along.
      const n: [number, number] = [-d[1], d[0]];
      const section = (s: number): V3[] =>
        prof.map(([off, z]): V3 => [c[0] + d[0] * s + n[0] * off, c[1] + d[1] * s + n[1] * off, z]);
      const a = section(-half);
      const b = section(half);
      cap(mb, a, [], [-d[0], -d[1], 0]);
      cap(mb, b, [], [d[0], d[1], 0]);
      wall(mb, a, b, true);
    }
  }

  // Legs. Each is built from blocks that meet face to face around a channel
  // that runs along the stand's arm: `s` is along the arm, away from the plate
  // towards the cup, `t` across it, and `h` up from the table.
  const alpha = armAngle(p.prongSpacing, p.prongReach);
  const sa = Math.sin(alpha);
  const ca = Math.cos(alpha);
  const { socketDepth, legW, h1, h2, top, half, armWide } = L;
  const sNear = -half; // the channel's end wall, one fit short of the arm's tip
  const sFar = half; // end of the prong's pocket
  const sEnd = half + 7; // the leg ends here, with the channel open
  const innerA = armWide / 2;
  const innerB1 = half;
  const innerB2 = half - taper * (h2 - h1);

  for (const side of [-1, 1]) {
    // side -1 is the left leg: it leans towards +x going away from the plate.
    const u: [number, number] = [-side * sa, -ca];
    const pv: [number, number] = [-u[1], u[0]];
    const c: [number, number] = [W / 2 + side * (p.prongSpacing / 2), -socketDepth];

    const at = (s: number, t: number, h: number): V3 =>
      lift(onTable(c[0] + u[0] * s + pv[0] * t, c[1] + u[1] * s + pv[1] * t), h);

    // A block between two heights, with its footprint given as corners in
    // (s, t) at the bottom and at the top, in the same order.
    const block = (
      lo: number, hi: number,
      foot: [number, number][], head: [number, number][] = foot,
    ) =>
      frustum(
        lb,
        foot.map(([s, t]) => at(s, t, lo)),
        head.map(([s, t]) => at(s, t, hi)),
      );
    const span = (s0: number, s1: number, t0: number, t1: number): [number, number][] => [
      [s0, t0], [s1, t0], [s1, t1], [s0, t1],
    ];

    // Where the plate's back face meets the table, along the leg's width. The
    // plate leans, so at height h that line has moved back by h tan(tilt);
    // the root block's near face follows it, which keeps it flat on the plate.
    const lean = (t: number, h: number) =>
      (-socketDepth + pv[1] * t + h * Math.tan(L.tilt) - L.zNear / ct) / ca;
    const root = (h: number): [number, number][] => [
      [lean(-legW / 2, h), -legW / 2],
      [sNear, -legW / 2],
      [sNear, legW / 2],
      [lean(legW / 2, h), legW / 2],
    ];
    block(0, top, root(0), root(top));

    // Either side of the arm's slot, below the arm's top.
    for (const sign of [-1, 1]) {
      const t0 = sign * innerA;
      const t1 = sign * (legW / 2);
      block(0, h1, span(sNear, sEnd, Math.min(t0, t1), Math.max(t0, t1)));
    }

    // Either side of the prong's pocket, whose walls close in as they rise.
    for (const sign of [-1, 1]) {
      const outer = sign * (legW / 2);
      const foot = span(sNear, sFar, sign * innerB1, outer);
      const head = span(sNear, sFar, sign * innerB2, outer);
      block(h1, h2, foot, head);
    }

    // Over the arm behind the prong, and over the prong itself.
    block(h1, top, span(sFar, sEnd, -legW / 2, legW / 2));
    block(h2, top, span(sNear, sFar, -legW / 2, legW / 2));
  }

  const plate = mb.finish();
  const legs = lb.finish();
  const body = L.bend > 0 ? curveFrame(plate, W, L.bend, L.lift) : plate;
  const positions = new Float32Array(body.positions.length + legs.positions.length);
  positions.set(body.positions, 0);
  positions.set(legs.positions, body.positions.length);
  return { positions, triangleCount: body.triangleCount + legs.triangleCount };
}

/**
 * A flat frame, or the raised shapes on it, wrapped round a cylinder of `radius`
 * about the vertical through the frame's middle, and set forward by `lift`.
 *
 * Cut into strips across the bend first, so broad faces follow the arc rather
 * than crossing it as chords.
 */
export function curveFrame(mesh: Mesh, width: number, radius: number, lift: number): Mesh {
  const n = mesh.triangleCount * 9;
  const moved = new Float32Array(n);
  for (let i = 0; i < n; i += 3) {
    moved[i] = mesh.positions[i] - width / 2;
    moved[i + 1] = mesh.positions[i + 1];
    moved[i + 2] = mesh.positions[i + 2];
  }
  const strips = stripeX({ positions: moved, triangleCount: mesh.triangleCount }, stripWidth(radius));
  bendAroundY(strips.positions, strips.triangleCount * 9, radius);
  for (let i = 0; i < strips.triangleCount * 9; i += 3) {
    strips.positions[i] += width / 2;
    strips.positions[i + 2] += lift;
  }
  return strips;
}

/** The frame with its raised shapes, ready to place or print, and where each colour's triangles start. */
export function assembleHolder(
  input: Partial<HolderParams>,
  cuts: readonly CutLoop[] = [],
  recess: Recess | null = null,
  relief: { mesh: Mesh; groups: { start: number; end: number; color: string }[] } | null = null,
): { mesh: Mesh; plateTriangles: number; bodies: { start: number; color: string }[] } {
  const plate = buildHolder(input, cuts, recess);
  if (!relief || relief.mesh.triangleCount === 0) return { mesh: plate, plateTriangles: plate.triangleCount, bodies: [] };

  const L = holderLayout(input);
  const parts: Mesh[] = [];
  const bodies: { start: number; color: string }[] = [];
  let used = plate.triangleCount;
  const cut = (g: { start: number; end: number }): Mesh => ({
    positions: relief.mesh.positions.subarray(g.start * 9, g.end * 9),
    triangleCount: g.end - g.start,
  });
  const slices = relief.groups.length > 0 ? relief.groups.map(cut) : [relief.mesh];
  slices.forEach((m, k) => {
    const done = L.bend > 0 ? curveFrame(m, L.W, L.bend, L.lift) : m;
    parts.push(done);
    bodies.push({ start: used, color: relief.groups[k]?.color ?? "" });
    used += done.triangleCount;
  });
  const positions = new Float32Array(used * 9);
  positions.set(plate.positions, 0);
  let at = plate.triangleCount * 9;
  for (const m of parts) {
    positions.set(m.positions.subarray(0, m.triangleCount * 9), at);
    at += m.triangleCount * 9;
  }
  return { mesh: { positions, triangleCount: used }, plateTriangles: plate.triangleCount, bodies };
}

/**
 * The holder as it should lie on the print bed: front face down, legs up.
 *
 * Turned half a revolution about y, which keeps it a proper solid rather than
 * a mirror image, then lowered so the front face is on the bed. Printed this
 * way the picture's pocket opens upwards and nothing hangs in the air but the
 * roof of each channel, which is a few millimetres across.
 */
export function holderForPrinting(mesh: Mesh): Mesh {
  const src = mesh.positions;
  const out = new Float32Array(mesh.triangleCount * 9);
  let minX = Infinity;
  let minZ = Infinity;
  for (let i = 0; i < out.length; i += 3) {
    out[i] = -src[i];
    out[i + 1] = src[i + 1];
    out[i + 2] = -src[i + 2];
    if (out[i] < minX) minX = out[i];
    if (out[i + 2] < minZ) minZ = out[i + 2];
  }
  for (let i = 0; i < out.length; i += 3) {
    out[i] -= minX;
    out[i + 2] -= minZ;
  }
  return { positions: out, triangleCount: mesh.triangleCount };
}

/**
 * The holder where it stands on the stand, in the stand's own coordinates.
 *
 * Only for showing the two together: the stand lies flat with its cup at the
 * origin, the prongs point up, and the holder is set on them leaning back by
 * `tiltDeg`, centred on `centreX`, with the legs' underside on the same plane as the stand's. The
 * inverse of how the channels were placed on the plate.
 */
export function holderInPlace(
  mesh: Mesh,
  tiltDeg: number,
  socketDepth: number,
  centreX: number,
): Mesh {
  const t = (Math.min(45, Math.max(0, tiltDeg)) * Math.PI) / 180;
  const st = Math.sin(t);
  const ct = Math.cos(t);
  const src = mesh.positions;
  const out = new Float32Array(mesh.triangleCount * 9);

  // The frame's own middle, not the mesh's: decorations may hang over its
  // edge, and the holder must not slide along the stand because of them.
  const mid = centreX;

  const edge = PRONG.reach + socketDepth;
  for (let i = 0; i < out.length; i += 3) {
    const y = src[i + 1];
    const z = src[i + 2];
    // Seen from the front, the plate's right-hand side is the world's
    // left, so x turns over; without it the holder would be its own mirror.
    out[i] = mid - src[i];
    out[i + 1] = z * ct - y * st + edge;
    out[i + 2] = y * ct + z * st;
  }
  return { positions: out, triangleCount: mesh.triangleCount };
}

/**
 * The holder standing as it will be used, which is also how it can be printed.
 *
 * The underside is the table plane, so lowering it so nothing is below zero
 * rests it exactly as it will stand. Printed this way the front face is a
 * vertical wall, which is where decorations are raised, and the channels open
 * onto the bed. With the plate leaned back the overhang is the lean, at most
 * 45 degrees.
 */
export function holderStanding(mesh: Mesh, tiltDeg: number): Mesh {
  const t = (Math.min(45, Math.max(0, tiltDeg)) * Math.PI) / 180;
  const st = Math.sin(t);
  const ct = Math.cos(t);
  const src = mesh.positions;
  const out = new Float32Array(mesh.triangleCount * 9);

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  for (let i = 0; i < out.length; i += 3) {
    const y = src[i + 1];
    const z = src[i + 2];
    out[i] = -src[i];
    out[i + 1] = z * ct - y * st;
    out[i + 2] = y * ct + z * st;
    if (out[i] < minX) minX = out[i];
    if (out[i + 1] < minY) minY = out[i + 1];
    if (out[i + 2] < minZ) minZ = out[i + 2];
  }
  for (let i = 0; i < out.length; i += 3) {
    out[i] -= minX;
    out[i + 1] -= minY;
    out[i + 2] -= minZ;
  }
  return { positions: out, triangleCount: mesh.triangleCount };
}
