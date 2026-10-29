import { MeshBuilder, type Mesh } from "./mesh";
import { atY, atZ, cap, clip, rect, wall, type V3 } from "./solids";
import { PRONG, armAngle } from "./prong";
import { STAND_DEFAULTS } from "./stand";

/**
 * The frame a lithophane is slid into, and the two legs the stand plugs into.
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
 *            ╲legs   ╱      Each leg is a prism along y with a tapered socket
 *                           in its lower face, and leans to match the stand's
 *                           arm it plugs onto.
 *
 * Tilted back by `tiltDeg`, the stand's prongs stay upright while the plate
 * leans, so the sockets lean with it and the underside of the legs and rail is
 * cut to the table plane rather than to the plate. Leaning also needs more
 * rail under the picture to hold the legs, which the bottom border grows to
 * provide.
 *
 * Shells that touch are left as separate solids rather than fused: the legs
 * sit on the plate's back face and the ramps against the pocket wall. A slicer
 * joins what touches.
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

  /** How far the legs reach out behind the plate. */
  legLength: number;
  /** Across the leg, along x. */
  legWidth: number;
  /** Down the leg's length from the plate to the middle of its socket. */
  socketDepth: number;

  /** What the stand's prong looks like, so the socket can match it. */
  prongSpacing: number;
  prongReach: number;
  prongSize: number;
  prongHeight: number;
  taperDeg: number;
  /** Gap between prong and socket, all round. */
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
  legLength: 16.6,
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

type Leg = {
  body: [number, number][];
  centre: [number, number];
  u: [number, number];
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
  const st = Math.sin(tilt);
  const ct = Math.cos(tilt);

  const pocketDepth = p.pictureT + 1;
  const T = pocketDepth + p.lipThickness;

  const alpha = armAngle(p.prongSpacing, p.prongReach);
  const sa = Math.sin(alpha);
  const ca = Math.cos(alpha);
  const socketY = p.prongHeight + 0.5;

  const W = p.pictureW + 2 * p.border;

  // Legs first, because how deep they are decides how much rail the plate
  // needs under the picture.
  const legs: Leg[] = [];
  let tallest = 0;

  for (const side of [-1, 1]) {
    // side -1 is the left leg: it leans towards +x going away from the plate.
    const u: [number, number] = [-side * sa, -ca];
    const centre: [number, number] = [W / 2 + side * (p.prongSpacing / 2), -p.socketDepth];

    const t0 = (-p.socketDepth - 3) / ca;
    const t1 = (-p.socketDepth + p.legLength) / ca;
    const mid: [number, number] = [
      centre[0] + (u[0] * (t0 + t1)) / 2,
      centre[1] + (u[1] * (t0 + t1)) / 2,
    ];
    // Cut square on the plate's back edge.
    const body = clip(rect(mid, u, t1 - t0, p.legWidth), (q) => -q[1]);
    for (const [, wy] of body) tallest = Math.max(tallest, -wy * st);
    legs.push({ body, centre, u });
  }

  const legTop = Math.max(p.border - 0.5, tallest + socketY * ct + 1.5);
  const rail = legTop + 0.5;

  const pocketW = p.pictureW + 2 * p.pocketPlay;
  const pocketH = p.pictureH + 2 * p.pocketPlay;
  const H = rail + pocketH + p.border - p.pocketPlay;

  const winW = p.pictureW - 2 * p.lip;
  const winH = p.pictureH - 2 * p.lip;
  const winY = rail + pocketH / 2;

  return {
    p, tilt, T, pocketDepth, W, H, rail, legTop, legs, socketY,
    pocketW, pocketH,
    /** The window the picture shows through, in the front face's terms. */
    window: { x0: W / 2 - winW / 2, x1: W / 2 + winW / 2, y0: winY - winH / 2, y1: winY + winH / 2 },
    /** The pocket behind it, which no decoration may stand over. */
    pocket: { x0: W / 2 - pocketW / 2, x1: W / 2 + pocketW / 2, y0: rail, y1: rail + pocketH },
  };
}

export function buildHolder(input: Partial<HolderParams> = {}): Mesh {
  const L = holderLayout(input);
  const { p, T, pocketDepth, W, H, rail, legTop, legs, socketY, pocketW, pocketH } = L;
  const mb = new MeshBuilder(2048);

  const st = Math.sin(L.tilt);
  const ct = Math.cos(L.tilt);
  const tt = Math.tan(L.tilt);
  const taper = Math.tan((p.taperDeg * Math.PI) / 180);
  const mouth = p.prongSize + 2 * p.fit;

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

  for (const { body, centre, u } of legs) {
    const under = body.map(([x, wy]) => onTable(x, wy));
    const over = under.map((v): V3 => [v[0], legTop, v[2]]);

    const sq = (size: number) =>
      rect(centre, u, size, size).map(([x, wy]) => onTable(x, wy));
    const m0 = sq(mouth);
    const m1 = sq(mouth - 2 * socketY * taper).map((v) => lift(v, socketY));
    const down: V3 = [-up[0], -up[1], -up[2]];

    cap(mb, under, [m0], down);
    cap(mb, over, [], [0, 1, 0]);
    wall(mb, under, over, true);
    wall(mb, m0, m1, false);
    cap(mb, m1, [], down);
  }

  return mb.finish();
}

/**
 * The holder as it should lie on the print bed: front face down, legs up.
 *
 * Turned half a revolution about y, which keeps it a proper solid rather than
 * a mirror image, then lowered so the front face is on the bed. Printed this
 * way the picture's pocket opens upwards and nothing hangs in the air but the
 * sockets, which are small enough to bridge.
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
 * `tiltDeg`. The inverse of how the sockets were placed on the plate.
 */
export function holderInPlace(mesh: Mesh, tiltDeg: number): Mesh {
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

  const edge = PRONG.reach + HOLDER_DEFAULTS.socketDepth;
  for (let i = 0; i < out.length; i += 3) {
    const y = src[i + 1];
    const z = src[i + 2];
    out[i] = src[i] - mid;
    out[i + 1] = z * ct - y * st + edge;
    out[i + 2] = y * ct + z * st + STAND_DEFAULTS.armHeight;
  }
  return { positions: out, triangleCount: mesh.triangleCount };
}

/**
 * The holder standing as it will be used, which is also how it can be printed.
 *
 * The underside is the table plane, so lowering it so nothing is below zero
 * rests it exactly as it will stand. Printed this way the front face is a
 * vertical wall, which is where decorations are raised, and the sockets open
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
