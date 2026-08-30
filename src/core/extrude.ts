import type { MeshBuilder } from "./mesh";
import type { Ring } from "./vectorise";
import { triangulateRegion } from "./triangulate";

/**
 * A tone's region turned into a solid.
 *
 * The region arrives as closed rings — outlines and whatever holes they have —
 * and leaves as a lid, a floor and a wall all the way round. Nothing is sampled
 * and nothing is decided here: the rings already say exactly where the tone is,
 * and this only gives them thickness.
 *
 * The lid is the triangulated region, the floor the same triangles the other
 * way up, and the wall joins the two. The wall is taken from the lid's own
 * boundary — the edges the triangulation left with nothing on the far side —
 * rather than from the rings it came from. That is the whole trick, and it is
 * why this closes: a wall panel is built on the very edge it has to meet, so it
 * meets it, corner for corner, whatever the triangulator did in between. Built
 * from the rings instead, the two agree about the line but not about the points
 * along it, and every place they disagree is a seam.
 */

/** Image coordinates to model millimetres. */
export type Place = (u: number, v: number) => { x: number; y: number };

/**
 * Where a piece of wall should start, given the boundary segment it stands on
 * in image coordinates. Returning null leaves that stretch without a wall.
 *
 * A terrace is one solid, not a pile of separate ones, so along a step only the
 * taller side raises a wall and it raises it from the shorter side's height,
 * not from the floor. Left to build a full-height wall each, both sides would
 * put one on the same line facing opposite ways: buried, so it makes no
 * difference to the volume, and hidden, so it looks right — but every layer a
 * slicer takes through it finds a closed loop of nothing there and dutifully
 * traces a perimeter round it.
 */
export type WallBase = (
  ua: number, va: number,
  ub: number, vb: number,
) => number | null;

export function extrudeRegion(
  mb: MeshBuilder,
  rings: readonly Ring[],
  map: Place,
  baseZ: number,
  topZ: number,
  wallBase?: WallBase,
  wallLevels?: readonly number[],
): void {
  for (const piece of triangulateRegion(rings)) {
    const n = piece.coords.length / 2;
    const px = new Float64Array(n);
    const py = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const p = map(piece.coords[i * 2], piece.coords[i * 2 + 1]);
      px[i] = p.x;
      py[i] = p.y;
    }

    const t = piece.tris;

    // `map` may turn the picture over, which reverses every triangle with it.
    // Rather than track that, look at what came out: the triangles are all
    // wound the same way, so the total tells which way that is.
    let turn = 0;
    for (let k = 0; k < t.length; k += 3) {
      const a = t[k], b = t[k + 1], c = t[k + 2];
      turn += (px[b] - px[a]) * (py[c] - py[a]) - (px[c] - px[a]) * (py[b] - py[a]);
    }
    const up = turn > 0;

    // The lid, and the floor under it facing the other way.
    for (let k = 0; k < t.length; k += 3) {
      const a = t[k];
      const b = up ? t[k + 1] : t[k + 2];
      const c = up ? t[k + 2] : t[k + 1];
      mb.addTriangle(px[a], py[a], topZ, px[b], py[b], topZ, px[c], py[c], topZ);
      mb.addTriangle(px[a], py[a], baseZ, px[c], py[c], baseZ, px[b], py[b], baseZ);
    }

    // An edge with no twin running the other way is on the boundary. The
    // bridges cut to reach a hole are not: they were traversed both ways.
    const seen = new Set<number>();
    for (let k = 0; k < t.length; k += 3) {
      const a = t[k];
      const b = up ? t[k + 1] : t[k + 2];
      const c = up ? t[k + 2] : t[k + 1];
      seen.add(a * n + b);
      seen.add(b * n + c);
      seen.add(c * n + a);
    }

    const wall = (a: number, b: number) => {
      if (seen.has(b * n + a)) return;

      let foot = baseZ;
      if (wallBase) {
        const z = wallBase(
          piece.coords[a * 2], piece.coords[a * 2 + 1],
          piece.coords[b * 2], piece.coords[b * 2 + 1],
        );
        if (z === null) return;
        foot = z;
      }
      if (foot >= topZ - 1e-9) return;

      // Cut at every height a wall passes, whether or not this stretch needs
      // it. Where three tones meet, the tall one's wall spans two steps and
      // its neighbours' walls span one each; left whole, the long upright edge
      // at that corner has two short ones against it and matches neither.
      let from = foot;
      if (wallLevels) {
        for (const level of wallLevels) {
          if (level <= from + 1e-9) continue;
          if (level >= topZ - 1e-9) break;
          panel(a, b, from, level);
          from = level;
        }
      }
      panel(a, b, from, topZ);
    };

    const panel = (a: number, b: number, lo: number, hi: number) => {
      mb.addQuad(
        px[b], py[b], hi,
        px[a], py[a], hi,
        px[a], py[a], lo,
        px[b], py[b], lo,
      );
    };

    for (let k = 0; k < t.length; k += 3) {
      const a = t[k];
      const b = up ? t[k + 1] : t[k + 2];
      const c = up ? t[k + 2] : t[k + 1];
      wall(a, b);
      wall(b, c);
      wall(c, a);
    }
  }
}
