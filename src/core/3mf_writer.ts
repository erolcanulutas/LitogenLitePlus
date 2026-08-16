import JSZip from "jszip";
import type { Tri, Vec3 } from "./types";

export type ColoredTri = {
  tri: Tri;
  materialIndex: 0 | 1;
};

function clean(n: number) {
  if (!Number.isFinite(n)) return 0;
  return +n.toFixed(6);
}

function vertexKey(v: Vec3) {
  return `${clean(v[0])},${clean(v[1])},${clean(v[2])}`;
}

export async function writeColored3MF(items: ColoredTri[]): Promise<ArrayBuffer> {
  const zip = new JSZip();

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`
  );

  zip.folder("_rels")!.file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`
  );

  const vertices: Vec3[] = [];
  const vertexMap = new Map<string, number>();

  function addVertex(v: Vec3) {
    const vv: Vec3 = [clean(v[0]), clean(v[1]), clean(v[2])];
    const key = vertexKey(vv);

    const existing = vertexMap.get(key);
    if (existing !== undefined) return existing;

    const idx = vertices.length;
    vertices.push(vv);
    vertexMap.set(key, idx);
    return idx;
  }

  const trisXml: string[] = [];

  for (const item of items) {
    const a = addVertex(item.tri[0]);
    const b = addVertex(item.tri[1]);
    const c = addVertex(item.tri[2]);

    if (a === b || b === c || a === c) continue;

    trisXml.push(
      `<triangle v1="${a}" v2="${b}" v3="${c}" pid="1" p1="${item.materialIndex}" p2="${item.materialIndex}" p3="${item.materialIndex}"/>`
    );
  }

  const vertsXml = vertices
    .map((v) => `<vertex x="${v[0]}" y="${v[1]}" z="${v[2]}"/>`)
    .join("");

  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Application">Litogen Lite</metadata>
  <resources>
    <basematerials id="1">
      <base name="Base" displaycolor="#FFFFFFFF"/>
      <base name="Highlight" displaycolor="#111111FF"/>
    </basematerials>

    <object id="2" type="model" name="Litogen Colored Lithophane">
      <mesh>
        <vertices>${vertsXml}</vertices>
        <triangles>${trisXml.join("")}</triangles>
      </mesh>
    </object>
  </resources>

  <build>
    <item objectid="2"/>
  </build>
</model>`;

  zip.folder("3D")!.file("3dmodel.model", model);

  return await zip.generateAsync({
    type: "arraybuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}