import type { MeshBuilder } from "./mesh";

/**
 * Emits the vertical band between two outline points, from the base up to
 * each point's surface height.
 *
 * `cuts` are heights the model will later be sliced at for a colour split.
 * The band is broken into stacked quads at those heights so the cut lands on
 * real edges. Without them the cut crosses each quad's diagonal at a point no
 * neighbouring face shares — geometrically coincident, but a T-junction that
 * leaves the separated bodies reporting open edges.
 */
export function emitWallColumn(
  mb: MeshBuilder,
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
  cuts: readonly number[],
): void {
  const top = Math.min(z0, z1);

  let prev = 0;
  for (const cut of cuts) {
    if (cut <= prev || cut >= top) continue;
    mb.addQuad(
      x0, y0, cut,
      x0, y0, prev,
      x1, y1, prev,
      x1, y1, cut,
    );
    prev = cut;
  }

  mb.addQuad(
    x0, y0, z0,
    x0, y0, prev,
    x1, y1, prev,
    x1, y1, z1,
  );
}
