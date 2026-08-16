import JSZip from "jszip";
import type { SplitMesh } from "./split_mesh";

function clean(n: number) {
  if (!Number.isFinite(n)) return 0;
  return +n.toFixed(6);
}

/**
 * Two-material 3MF, written as a zip container. Vertices are welded by
 * position so the two colour bodies share the seam rather than sitting as two
 * loose shells.
 */
export async function writeColored3MF(mesh: SplitMesh): Promise<ArrayBuffer> {
  const zip = new JSZip();

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`,
  );

  zip.folder("_rels")!.file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`,
  );

  const { positions, triangleCount, material } = mesh;

  const vertsXml: string[] = [];
  const vertexMap = new Map<string, number>();

  const addVertex = (o: number): number => {
    const x = clean(positions[o]);
    const y = clean(positions[o + 1]);
    const z = clean(positions[o + 2]);

    const key = `${x},${y},${z}`;
    const existing = vertexMap.get(key);
    if (existing !== undefined) return existing;

    const idx = vertsXml.length;
    vertsXml.push(`<vertex x="${x}" y="${y}" z="${z}"/>`);
    vertexMap.set(key, idx);
    return idx;
  };

  const trisXml: string[] = [];

  for (let i = 0; i < triangleCount; i++) {
    const o = i * 9;

    const a = addVertex(o);
    const b = addVertex(o + 3);
    const c = addVertex(o + 6);

    if (a === b || b === c || a === c) continue;

    const p = material[i];
    trisXml.push(
      `<triangle v1="${a}" v2="${b}" v3="${c}" pid="1" p1="${p}" p2="${p}" p3="${p}"/>`,
    );
  }

  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Application">Litogen Lite+</metadata>
  <resources>
    <basematerials id="1">
      <base name="Base" displaycolor="#FFFFFFFF"/>
      <base name="Highlight" displaycolor="#111111FF"/>
    </basematerials>

    <object id="2" type="model" name="Litogen Colored Lithophane">
      <mesh>
        <vertices>${vertsXml.join("")}</vertices>
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
