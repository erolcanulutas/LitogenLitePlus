/**
 * Flat triangle storage.
 *
 * Meshes used to be `Vec3[][]` — three little arrays per triangle, each its own
 * heap object. A high-quality lithophane is a few million triangles, so that
 * cost tens of millions of allocations per export and made the generator spend
 * most of its time in the garbage collector.
 *
 * Everything now lives in one Float32Array: nine floats per triangle, laid out
 * as ax ay az bx by bz cx cy cz. One allocation, no pointer chasing, and the
 * buffer can be handed to the STL writer as-is.
 */
export type Mesh = {
  /** 9 floats per triangle. Length is always `triangleCount * 9`. */
  positions: Float32Array;
  triangleCount: number;
  /**
   * Which body each triangle belongs to, when the model is several solids in
   * the same layers rather than stacked ones.
   *
   * A lithophane says colour with thickness, so its bodies are slabs and a
   * plane cut separates them. An inlay says colour side by side at one height,
   * so nothing separates the bodies geometrically and each triangle has to
   * carry the answer. Absent means the whole mesh is one body.
   */
  tags?: Uint8Array;
};

const FLOATS_PER_TRI = 9;

/** Growable sink that shape generators push triangles into. */
export class MeshBuilder {
  private data: Float32Array;
  private used = 0;
  private tagData: Uint8Array | null = null;
  private tagNow = 0;

  /**
   * Which body triangles now belong to.
   *
   * Left alone, nothing is tagged and the mesh is one solid, exactly as before.
   * Set once, tagging starts and every triangle already written is taken to
   * belong to body 0.
   */
  setTag(tag: number): void {
    if (this.tagData === null) {
      this.tagData = new Uint8Array(Math.max(1, this.data.length / FLOATS_PER_TRI));
    }
    this.tagNow = tag;
  }

  /**
   * @param expectedTriangles Capacity hint. Generators know their triangle
   * count up front, so a correct hint means the buffer is never reallocated.
   */
  constructor(expectedTriangles = 4096) {
    this.data = new Float32Array(Math.max(1, expectedTriangles) * FLOATS_PER_TRI);
  }

  get triangleCount(): number {
    return this.used / FLOATS_PER_TRI;
  }

  addTriangle(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
  ): void {
    if (this.used + FLOATS_PER_TRI > this.data.length) this.grow();

    const d = this.data;
    const o = this.used;

    d[o] = ax; d[o + 1] = ay; d[o + 2] = az;
    d[o + 3] = bx; d[o + 4] = by; d[o + 5] = bz;
    d[o + 6] = cx; d[o + 7] = cy; d[o + 8] = cz;

    if (this.tagData !== null) this.tagData[o / FLOATS_PER_TRI] = this.tagNow;

    this.used = o + FLOATS_PER_TRI;
  }

  /** Quad as two triangles, wound a-b-c / a-c-d. */
  addQuad(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    dx: number, dy: number, dz: number,
  ): void {
    this.addTriangle(ax, ay, az, bx, by, bz, cx, cy, cz);
    this.addTriangle(ax, ay, az, cx, cy, cz, dx, dy, dz);
  }

  private grow(): void {
    const next = new Float32Array(this.data.length * 2);
    next.set(this.data);
    this.data = next;

    if (this.tagData !== null) {
      const t = new Uint8Array(next.length / FLOATS_PER_TRI);
      t.set(this.tagData);
      this.tagData = t;
    }
  }

  /** View over exactly the written region. Shares memory with the builder. */
  finish(): Mesh {
    const count = this.used / FLOATS_PER_TRI;
    return {
      positions: this.data.subarray(0, this.used),
      triangleCount: count,
      tags: this.tagData === null ? undefined : this.tagData.subarray(0, count),
    };
  }
}
