import { MeshBuilder, type Mesh } from "./mesh";
import { atY, atZ, cap, frustum, wall, type V3 } from "./solids";
import { PRONG, armAngle } from "./prong";
import { STAND_DEFAULTS } from "./stand";

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
};

export const HOLDER_DEFAULTS: HolderParams = {
  pictureW: 100,
  pictureH: 80,
  pictureT: 3,
  border: 10,
  lip: 3,
  pocketPlay: 0.3,
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

  const tilt = (Math.min(45, Math.max(0, p.tiltDeg)) * Math.PI) / 180;
  const ct = Math.cos(tilt);
  const tt = Math.tan(tilt);

  const pocketDepth = p.pictureT + 1;
  const T = pocketDepth + p.lipThickness;

  const W = p.pictureW + 2 * p.border;

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

  // The leg's near face is the plate's own back face, which at the roof's
  // height is top / cos(tilt) up the plate, and the picture starts above that.
  const rail = Math.max(p.border - 0.5, top / ct + 0.5);

  const pocketW = p.pictureW + 2 * p.pocketPlay;
  const pocketH = p.pictureH + 2 * p.pocketPlay;
  const H = rail + pocketH + p.border - p.pocketPlay;

  const winW = p.pictureW - 2 * p.lip;
  const winH = p.pictureH - 2 * p.lip;
  const winY = rail + pocketH / 2;

  return {
    p, tilt, T, pocketDepth, W, H, rail,
    pocketW, pocketH,
    socketDepth, legW, h1, h2, top, half, armWide,
    /** The window the picture shows through, in the front face's terms. */
    window: { x0: W / 2 - winW / 2, x1: W / 2 + winW / 2, y0: winY - winH / 2, y1: winY + winH / 2 },
    /** The pocket behind it, which no decoration may stand over. */
    pocket: { x0: W / 2 - pocketW / 2, x1: W / 2 + pocketW / 2, y0: rail, y1: rail + pocketH },
  };
}

export function buildHolder(input: Partial<HolderParams> = {}): Mesh {
  const L = holderLayout(input);
  const { p, T, pocketDepth, W, H, rail, pocketW, pocketH } = L;
  const mb = new MeshBuilder(2048);

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
  const pocket = box(L.pocket.x0, L.pocket.x1, L.pocket.y0, L.pocket.y1);
  const window = box(L.window.x0, L.window.x1, L.window.y0, L.window.y1);

  const outerBack = atZ(box(0, W, 0, H), 0);
  // The front face's lower edge reaches down to the table plane, so the whole
  // underside of the plate lies on it.
  const outerFront = atZ(box(0, W, 0, H), T).map(
    (v, i): V3 => (i < 2 ? [v[0], -T * tt, v[2]] : v),
  );

  // The plate: one shell, stepped from the pocket to the window.
  cap(mb, outerBack, [atZ(pocket, 0)], [0, 0, -1]);
  wall(mb, atZ(pocket, 0), atZ(pocket, pocketDepth), false);
  cap(mb, atZ(pocket, pocketDepth), [atZ(window, pocketDepth)], [0, 0, -1]);
  wall(mb, atZ(window, pocketDepth), atZ(window, T), false);
  cap(mb, outerFront, [atZ(window, T)], [0, 0, 1]);
  wall(mb, outerBack, outerFront, true);

  if (p.clips) {
    const x0 = W / 2 - pocketW / 2;
    const x1 = W / 2 + pocketW / 2;
    const half = 6;
    const bump = 0.45;
    const profile = (x: number, dir: number): [number, number][] => [
      [x, 0.1],
      [x + dir * bump, 1.0],
      [x, 1.6],
    ];
    const yc = rail + pocketH / 2;
    for (const [x, dir] of [[x0, 1], [x1, -1]] as const) {
      const a = atY(profile(x, dir), yc - half);
      const b = atY(profile(x, dir), yc + half);
      cap(mb, a, [], [0, -1, 0]);
      cap(mb, b, [], [0, 1, 0]);
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
        mb,
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
      (-socketDepth + pv[1] * t + h * Math.tan(L.tilt)) / ca;
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

  return mb.finish();
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
 * `tiltDeg`, with the legs' underside on the same plane as the stand's. The
 * inverse of how the channels were placed on the plate.
 */
export function holderInPlace(mesh: Mesh, tiltDeg: number, socketDepth: number): Mesh {
  const t = (Math.min(45, Math.max(0, tiltDeg)) * Math.PI) / 180;
  const st = Math.sin(t);
  const ct = Math.cos(t);
  const src = mesh.positions;
  const out = new Float32Array(mesh.triangleCount * 9);

  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < out.length; i += 3) {
    lo = Math.min(lo, src[i]);
    hi = Math.max(hi, src[i]);
  }
  const mid = (lo + hi) / 2;

  const edge = PRONG.reach + socketDepth;
  for (let i = 0; i < out.length; i += 3) {
    const y = src[i + 1];
    const z = src[i + 2];
    out[i] = src[i] - mid;
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

  let minY = Infinity;
  let minZ = Infinity;
  for (let i = 0; i < out.length; i += 3) {
    const y = src[i + 1];
    const z = src[i + 2];
    out[i] = src[i];
    out[i + 1] = z * ct - y * st;
    out[i + 2] = y * ct + z * st;
    if (out[i + 1] < minY) minY = out[i + 1];
    if (out[i + 2] < minZ) minZ = out[i + 2];
  }
  for (let i = 0; i < out.length; i += 3) {
    out[i + 1] -= minY;
    out[i + 2] -= minZ;
  }
  return { positions: out, triangleCount: mesh.triangleCount };
}
