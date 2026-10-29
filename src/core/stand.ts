import { MeshBuilder, type Mesh } from "./mesh";
import { PRONG, armAngle } from "./prong";
import { atZ, cap, circle, frustum, rect, wall } from "./solids";

/**
 * The base that holds the tealight and carries the holder.
 *
 * Lies flat on the bed, so it prints without support. A cup in the middle for
 * the tealight, and two arms running out from its centre to a prong each; the
 * holder's legs plug onto the prongs. The arms are radial, which is why each
 * prong is turned by the same angle the holder's legs lean at.
 *
 *            ▮         ▮      prongs, tapering so they start easily
 *             ╲       ╱
 *              ╲     ╱       arms, straight out from the cup's centre
 *               ╭───╮
 *               │ ○ │        cup
 *               ╰───╯
 */
export type StandParams = {
  /** Diameter of the tealight it takes, in mm. */
  tealight: number;
  /** Room left round it in the cup, in total. */
  cupPlay: number;
  cupWall: number;
  cupFloor: number;
  cupHeight: number;

  armWidth: number;
  armHeight: number;
  /** Centre of the cup to the centre of a prong, along the stand's axis. */
  reach: number;
  /** Between the two prongs, centre to centre. */
  prongSpacing: number;
  prongSize: number;
  prongHeight: number;
  taperDeg: number;
};

export const STAND_DEFAULTS: StandParams = {
  tealight: 38,
  cupPlay: 4,
  cupWall: 3,
  cupFloor: 1,
  cupHeight: 5,
  armWidth: 6,
  armHeight: 5,
  reach: PRONG.reach,
  prongSpacing: PRONG.spacing,
  prongSize: PRONG.size,
  prongHeight: PRONG.height,
  taperDeg: PRONG.taperDeg,
};

export function buildStand(input: Partial<StandParams> = {}): Mesh {
  const p = { ...STAND_DEFAULTS, ...input };
  const mb = new MeshBuilder(2048);

  const rIn = (p.tealight + p.cupPlay) / 2;
  const rOut = rIn + p.cupWall;
  const ring = circle(rOut);
  const bore = circle(rIn);

  cap(mb, atZ(ring, 0), [], [0, 0, -1]);
  wall(mb, atZ(ring, 0), atZ(ring, p.cupHeight), true);
  cap(mb, atZ(ring, p.cupHeight), [atZ(bore, p.cupHeight)], [0, 0, 1]);
  wall(mb, atZ(bore, p.cupHeight), atZ(bore, p.cupFloor), false);
  cap(mb, atZ(bore, p.cupFloor), [], [0, 0, 1]);

  const alpha = armAngle(p.prongSpacing, p.reach);
  const tan = Math.tan((p.taperDeg * Math.PI) / 180);
  const toTip = Math.hypot(p.prongSpacing / 2, p.reach);
  // Starts inside the cup's wall, so the arm and the wall overlap rather than
  // meet at a line, and never inside its bore.
  const from = rIn + p.cupWall * 0.6;
  const to = toTip + p.prongSize / 2;

  for (const side of [-1, 1]) {
    const u: [number, number] = [side * Math.sin(alpha), Math.cos(alpha)];

    const arm = rect([u[0] * (from + to) / 2, u[1] * (from + to) / 2], u, to - from, p.armWidth);
    frustum(mb, atZ(arm, 0), atZ(arm, p.armHeight));

    const tip: [number, number] = [side * p.prongSpacing / 2, p.reach];
    const foot = rect(tip, u, p.prongSize, p.prongSize);
    const head = rect(tip, u, p.prongSize - 2 * p.prongHeight * tan, p.prongSize - 2 * p.prongHeight * tan);
    frustum(mb, atZ(foot, p.armHeight), atZ(head, p.armHeight + p.prongHeight));
  }

  return mb.finish();
}
