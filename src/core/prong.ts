/**
 * What the stand's prongs look like, which the holder's sockets have to match.
 *
 * One place, so the two parts cannot drift apart: change a number here and both
 * come out agreeing.
 */
export const PRONG = {
  /** Between the two prongs, centre to centre, in mm. */
  spacing: 45.1,
  /** Centre of the cup to the centre of a prong, along the stand's axis. */
  reach: 54,
  /** Side of the square a prong stands on. */
  size: 5,
  height: 4,
  /** How much it narrows towards the tip, per side, in degrees. */
  taperDeg: 2,
} as const;

/** The angle a stand arm — and so a leg — leans at, in radians. */
export const armAngle = (spacing: number, reach: number) =>
  Math.atan2(spacing / 2, reach);
