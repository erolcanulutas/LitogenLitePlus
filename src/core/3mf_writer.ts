import JSZip from "jszip";
import type { BandedMesh } from "./split_mesh";

function clean(n: number) {
  if (!Number.isFinite(n)) return 0;
  return +n.toFixed(6);
}

/** "#rrggbb" or "#rrggbbaa" -> the "#RRGGBBAA" 3MF wants. */
function displayColor(css: string): string {
  const hex = css.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  if (hex.length === 6) return `#${hex}FF`;
  if (hex.length === 8) return `#${hex}`;
  return "#CCCCCCFF";
}

/**
 * Serialises one contiguous run of triangles as a 3MF <mesh>, welding
 * vertices by position so the body is a proper solid rather than a soup.
 */
function meshXml(positions: Float32Array, from: number, to: number): string {
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
 * Multi-material 3MF.
 *
 * Each colour band goes in as its own object so a slicer can assign filament
 * to it — tagging triangles of a single body with different materials is valid
 * 3MF but PrusaSlicer and Bambu Studio both ignore it, which produced a file
 * that looked right and printed in one colour.
 *
 * The bands are then gathered under one assembly object referencing them as
 * <components>, and that is the only thing placed in <build>. A slicer
 * therefore shows a single part made of several bodies: they move together and
 * stay registered, rather than arriving as loose objects that can drift apart.
 */
export async function writeColored3MF(
  mesh: BandedMesh,
  colors: readonly string[],
): Promise<ArrayBuffer> {
  const zip = new JSZip();

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
  <Default Extension="config" ContentType="application/xml"/>
</Types>`,
  );

  zip.folder("_rels")!.file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`,
  );

  const { positions, triangleCount, bandStarts } = mesh;
  const bandCount = bandStarts.length;

  const bases: string[] = [];
  const objects: string[] = [];
  const components: string[] = [];

  // ids: 1 is the material group, 2..n+1 the bands, n+2 the assembly.
  const FIRST_BAND_ID = 2;

  for (let b = 0; b < bandCount; b++) {
    const from = bandStarts[b];
    const to = b + 1 < bandCount ? bandStarts[b + 1] : triangleCount;
    const id = FIRST_BAND_ID + b;
    const color = displayColor(colors[b] ?? "#CCCCCC");

    bases.push(`<base name="Band ${b + 1}" displaycolor="${color}"/>`);
    objects.push(
      `<object id="${id}" type="model" name="Band ${b + 1}" pid="1" pindex="${b}">${meshXml(positions, from, to)}</object>`,
    );
    components.push(`<component objectid="${id}"/>`);
  }

  const assemblyId = FIRST_BAND_ID + bandCount;

  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Application">Litogen Lite+</metadata>
  <resources>
    <basematerials id="1">${bases.join("")}</basematerials>
    ${objects.join("\n    ")}
    <object id="${assemblyId}" type="model" name="Lithophane">
      <components>${components.join("")}</components>
    </object>
  </resources>

  <build>
    <item objectid="${assemblyId}"/>
  </build>
</model>`;

  zip.folder("3D")!.file("3dmodel.model", model);

  // Bambu Studio and Orca read filament assignment from here rather than from
  // the core spec's materials, so without it every band lands on filament 1
  // and has to be reassigned by hand. Slicers that do not know this file
  // ignore it.
  //
  // Note this assigns a slot, not a colour: what comes out is whatever
  // filament is loaded in that slot. A file cannot dictate the colour.
  const parts = bandStarts.map(
    (_, b) =>
      `    <part id="${FIRST_BAND_ID + b}" subtype="normal_part">
      <metadata key="name" value="Band ${b + 1}"/>
      <metadata key="extruder" value="${b + 1}"/>
    </part>`,
  );

  zip.folder("Metadata")!.file(
    "model_settings.config",
    `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="${assemblyId}">
    <metadata key="name" value="Lithophane"/>
${parts.join("\n")}
  </object>
</config>`,
  );

  return await zip.generateAsync({
    type: "arraybuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}
