import JSZip from "jszip";
import type { SplitMesh } from "./split_mesh";

function clean(n: number) {
  if (!Number.isFinite(n)) return 0;
  return +n.toFixed(6);
}

/**
 * Serialises one contiguous run of triangles as a 3MF <mesh>, welding
 * vertices by position so the body is a proper solid rather than a soup.
 */
function meshXml(
  positions: Float32Array,
  from: number,
  to: number,
): string {
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

  for (let i = from; i < to; i++) {
    const o = i * 9;
    const a = addVertex(o);
    const b = addVertex(o + 3);
    const c = addVertex(o + 6);

    if (a === b || b === c || a === c) continue;

    trisXml.push(`<triangle v1="${a}" v2="${b}" v3="${c}"/>`);
  }

  return `<mesh><vertices>${vertsXml.join("")}</vertices><triangles>${trisXml.join("")}</triangles></mesh>`;
}

/**
 * Two-body 3MF for multi-material printing.
 *
 * The halves go in as two separate objects, each carrying its own base
 * material, because that is what slicers actually act on — they assign
 * filament per object. Tagging triangles of a single body with different
 * materials is valid 3MF but PrusaSlicer and Bambu Studio both ignore it, so
 * that produced a file that looked right and printed in one colour.
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

  const { positions, triangleCount, belowCount } = mesh;

  const lower = meshXml(positions, 0, belowCount);
  const upper = meshXml(positions, belowCount, triangleCount);

  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Application">Litogen Lite+</metadata>
  <resources>
    <basematerials id="1">
      <base name="Base" displaycolor="#FFFFFFFF"/>
      <base name="Highlight" displaycolor="#111111FF"/>
    </basematerials>

    <object id="2" type="model" name="Base" pid="1" pindex="0">${lower}</object>
    <object id="3" type="model" name="Highlight" pid="1" pindex="1">${upper}</object>
  </resources>

  <build>
    <item objectid="2"/>
    <item objectid="3"/>
  </build>
</model>`;

  zip.folder("3D")!.file("3dmodel.model", model);

  return await zip.generateAsync({
    type: "arraybuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}
