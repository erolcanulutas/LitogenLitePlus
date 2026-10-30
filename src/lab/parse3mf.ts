import JSZip from "jszip";

export type Parsed3MF = {
  /** 9 floats per triangle, in the file's own millimetres. */
  positions: Float32Array;
  triangleCount: number;
  /** One per body: where it starts, in triangles, and its colour. */
  bodies: { start: number; color: string }[];
};

type Matrix = number[]; // 12 numbers, as a 3MF writes them: a 3x3 then the translation

const IDENTITY: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

function parseMatrix(text: string | null): Matrix {
  if (!text) return IDENTITY;
  const m = text.trim().split(/\s+/).map(Number);
  return m.length === 12 && m.every(Number.isFinite) ? m : IDENTITY;
}

/** `a` applied after `b`. */
function compose(a: Matrix, b: Matrix): Matrix {
  // 3MF matrices act on row vectors: v' = v * M + t.
  const out: Matrix = new Array(12).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = b[r * 3] * a[c] + b[r * 3 + 1] * a[3 + c] + b[r * 3 + 2] * a[6 + c];
    }
  }
  for (let c = 0; c < 3; c++) {
    out[9 + c] = b[9] * a[c] + b[10] * a[3 + c] + b[11] * a[6 + c] + a[9 + c];
  }
  return out;
}

function css(color: string | null): string | null {
  if (!color) return null;
  const hex = color.replace(/[^0-9a-fA-F]/g, "");
  return hex.length >= 6 ? `#${hex.slice(0, 6).toLowerCase()}` : null;
}

/**
 * Reads a 3MF into triangles and bodies.
 *
 * Handles what the studio writes and what most slicers and CAD tools do: objects
 * with meshes, objects made of components, a build list with transforms, and
 * colours from base materials. A body's colour is its object's material;
 * colours given per triangle are not read, and a body without one is grey.
 */
export async function parse3MF(data: ArrayBuffer): Promise<Parsed3MF> {
  const zip = await JSZip.loadAsync(data);
  const name = Object.keys(zip.files).find((n) => /^3D\/3dmodel\.model$/i.test(n)) ?? Object.keys(zip.files).find((n) => /\.model$/i.test(n));
  if (!name) throw new Error("That is not a 3MF: there is no model inside.");

  const doc = new DOMParser().parseFromString(await zip.files[name].async("string"), "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("That 3MF could not be read.");

  const all = (el: Element | Document, tag: string): Element[] =>
    Array.from(el.getElementsByTagName("*")).filter((e) => e.localName === tag);

  // Colours by material group and index.
  const groups = new Map<string, (string | null)[]>();
  for (const g of all(doc, "basematerials")) {
    groups.set(g.getAttribute("id") ?? "", all(g, "base").map((b) => css(b.getAttribute("displaycolor"))));
  }

  type Obj = { mesh: Element | null; components: { id: string; m: Matrix }[]; color: string | null };
  const objects = new Map<string, Obj>();
  for (const o of all(doc, "object")) {
    const id = o.getAttribute("id") ?? "";
    const pid = o.getAttribute("pid");
    const pindex = Number(o.getAttribute("pindex") ?? 0);
    const color = pid ? groups.get(pid)?.[pindex] ?? null : null;
    const mesh = Array.from(o.children).find((c) => c.localName === "mesh") ?? null;
    const comps = Array.from(o.children)
      .filter((c) => c.localName === "components")
      .flatMap((c) => Array.from(c.children).filter((k) => k.localName === "component"))
      .map((k) => ({ id: k.getAttribute("objectid") ?? "", m: parseMatrix(k.getAttribute("transform")) }));
    objects.set(id, { mesh, components: comps, color });
  }

  const leaves: { mesh: Element; m: Matrix; color: string | null }[] = [];
  const walk = (id: string, m: Matrix, inherited: string | null, depth: number) => {
    const o = objects.get(id);
    if (!o || depth > 8) return;
    const color = o.color ?? inherited;
    if (o.mesh) leaves.push({ mesh: o.mesh, m, color });
    for (const c of o.components) walk(c.id, compose(c.m, m), color, depth + 1);
  };

  const items = all(doc, "item");
  if (items.length > 0) {
    for (const it of items) walk(it.getAttribute("objectid") ?? "", parseMatrix(it.getAttribute("transform")), null, 0);
  } else {
    for (const id of objects.keys()) walk(id, IDENTITY, null, 0);
  }
  if (leaves.length === 0) throw new Error("That 3MF has no triangles in it.");

  let total = 0;
  const meshes = leaves.map((l) => {
    const verts = all(l.mesh, "vertex").map((v) => [Number(v.getAttribute("x")), Number(v.getAttribute("y")), Number(v.getAttribute("z"))]);
    const tris = all(l.mesh, "triangle").map((t) => [Number(t.getAttribute("v1")), Number(t.getAttribute("v2")), Number(t.getAttribute("v3"))]);
    total += tris.length;
    return { verts, tris };
  });

  const positions = new Float32Array(total * 9);
  const bodies: { start: number; color: string }[] = [];
  let at = 0;
  leaves.forEach((l, i) => {
    const { verts, tris } = meshes[i];
    bodies.push({ start: at, color: l.color ?? "#9aa3ad" });
    const m = l.m;
    for (const t of tris) {
      for (let k = 0; k < 3; k++) {
        const v = verts[t[k]];
        if (!v) continue;
        const o = (at * 3 + k) * 3;
        positions[o] = v[0] * m[0] + v[1] * m[3] + v[2] * m[6] + m[9];
        positions[o + 1] = v[0] * m[1] + v[1] * m[4] + v[2] * m[7] + m[10];
        positions[o + 2] = v[0] * m[2] + v[1] * m[5] + v[2] * m[8] + m[11];
      }
      at++;
    }
  });

  // A body that came out empty would put two bodies at one start.
  const kept = bodies.filter((b, i) => i === bodies.length - 1 || bodies[i + 1].start > b.start);
  return { positions, triangleCount: total, bodies: kept.length > 0 ? kept : [{ start: 0, color: "#9aa3ad" }] };
}
