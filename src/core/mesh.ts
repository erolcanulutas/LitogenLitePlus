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
};

const FLOATS_PER_TRI = 9;

/** Growable sink that shape generators push triangles into. */
export class MeshBuilder {
  private data: Float32Array;
  private used = 0;

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
  }

  /** View over exactly the written region. Shares memory with the builder. */
  finish(): Mesh {
    return {
      positions: this.data.subarray(0, this.used),
      triangleCount: this.used / FLOATS_PER_TRI,
    };
  }
}
