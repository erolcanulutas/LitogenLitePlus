# Litogen Lite+

Browser-based **lithophane generator**. Drop in a picture, pick a shape, get a 3D-printable
STL — or a multi-body 3MF that prints in colour. Everything runs locally in your browser.

👉 **Live:** https://erolcanulutas.github.io/LitogenLitePlus/

> Successor to [Litogen-Lite](https://github.com/erolcanulutas/Litogen-Lite). Same geometry
> engine, now with the source under version control and a proper build pipeline.

---

## Features

| | |
|---|---|
| ⬢ | Five shapes: **triangle, circle, hexagon, pentagon, rectangle** |
| 🖼️ | Image import with in-browser crop, rotate and flip |
| 📐 | Millimetre-accurate width, thickness and frame control |
| 🌗 | **Photo**: the picture as a continuous relief — thick where it is dark, thin where it is light |
| ✒️ | **Graphic**: the picture quantised into flat tones, each standing at its own height, for logos and line art |
| 🎴 | **Inlay**: one flat slab with the tones set side by side into its top layers, so the filament changes across a layer instead of between two. Coasters, badges, signs |
| ▨ | **Tones as regions**: each tone traced out of the picture as a closed outline and given its own solid, instead of being decided by thresholds on brightness. See below |
| 🎯 | **Auto** tone detection: fits the picture's actual tones rather than dividing the range evenly, and reads each tone's colour off the picture |
| 🎨 | **Colour bands** counted in printer layers, exported as **3MF** — one part made of several bodies, so they stay registered |
| 🖥️ | **In-page 3D preview** of the exact exported mesh, tinted as the export assigns it |
| ⚡ | All heavy work runs in a **Web Worker** — the UI never blocks |
| 🔒 | **Nothing is uploaded.** No backend, no API, no tracking |

---

## Tones as regions

A lithophane says colour with thickness, so a tone has to sit at a height. Decide which
tone a point is by thresholding a brightness field and a tone whose brightness lies
*between* two others must appear wherever those two meet: white next to black is drawn as
a climb through every value in between, and a tone sitting at one of those values gets a
stripe along the edge. It can be thinned; it cannot be removed, because it is not an
artefact of the sampling.

So this does not sample. The picture is quantised to its tones once, the boundaries
between tones are traced as closed outlines, and each tone is extruded as its own solid.
A boundary between white and black is one curve with nothing in it.

```
picture ─ quantise ─ settle ─ cut into arcs ─ smooth each arc once ─ assemble rings
                                                                          │
        3MF  ←  one body per tone  ←  extrude  ←  triangulate (ear clipping, with holes)
```

Three things that had to be right, each of which took a wrong turn first:

- **Smooth each boundary once, not once per tone.** Every boundary is traced twice, once
  from the tone on each side. As staircases the two copies match. Smooth either one on its
  own and they stop matching, because the smoothing windows run past the points where three
  tones meet and pick up different neighbours — which tears the picture apart at the joints.
  `core/arcs.ts` cuts the boundaries into arcs between junctions, smooths each arc once with
  its junctions pinned, and hands the same arc to both tones.
- **Settle the quantised picture first.** A hard edge in a JPEG rings, hardest where the
  contrast is highest, and thresholding that ringing gives a boundary that jitters a pixel
  in and out every few pixels. Each jag reads as a junction, so arcs get cut into pieces too
  short to smooth. Two passes of a neighbour majority vote remove the jags and leave drawn
  edges where they are.
- **Take the wall from the lid's own boundary edges.** Built from the rings instead, the lid
  and the wall agree about where the boundary runs but not about the points along it, and
  every disagreement is a seam.

Measured on all five shapes: every body closes with **0 unmatched directed edges and
0.0000% volume drift**, volumes match the analytic slab, and sampling the slab on a
1400 × 1400 grid puts 99.997% of it under exactly one tone with no overlap.

The checkbox is on by default in Graphic and Inlay. Off, the surface is built the old way.

---

## How it works

```
image ─ resample (OffscreenCanvas) ─ luminance heightmap ─ shape.build()
                                                                │
     download  ←  binary STL / colour 3MF  ←  orient upright  ←  triangle mesh
```

1. The picked image is resampled to a fixed row count so mesh density is independent of the
   source resolution.
2. Each pixel becomes a height in `0..1` using Rec.709 luminance
   (`0.2126·R + 0.7152·G + 0.0722·B`).
3. The selected shape plugin turns that heightmap into a solid triangle mesh.
4. With regions on, the tones are then redrawn from their own outlines: an inlay keeps the
   shape's slab and gets new tones on top of it, a relief is rebuilt as one column per tone.
5. The mesh is rotated upright and serialised. Colour split heights clip it into bodies and
   it is written as a multi-material 3MF.

---

## Project layout

```
src/
  App.tsx              UI shell and all generator parameters
  ui/                  ImageEditor (crop/rotate/flip), ImageControls, MeshPreview
  core/
    heightmap.ts       image → luminance grid
    sample.ts          area-averaged heightmap sampling
    tones.ts           fits the picture's tones (Lloyd on the histogram) and their colours
    terrace.ts         brightness cuts, contour crossings solved against the field
    squash.ts          suppresses bands that are only the ramp between their neighbours
    radial.ts          the shared mesh builder behind circle / hexagon / pentagon / triangle
    wall.ts            rim walls, split at colour boundaries
    inlay.ts           flat inlay emitters and per-body grouping

    vectorise.ts       quantise, settle, trace each tone as closed rings
    arcs.ts            boundaries cut into arcs and smoothed once each
    triangulate.ts     rings (with holes) → triangles, by ear clipping
    extrude.ts         rings → a closed solid, wall taken from the lid's boundary
    stencil.ts         how far a shape reaches, read back off its own rim
    vector_inlay.ts    the shape's slab, with the tones redrawn on top
    vector_graphic.ts  one column per tone, plus the frame band

    quality.ts         mesh density presets
    types.ts           ShapePlugin contract
    mesh.ts            flat Float32Array triangle storage with per-triangle body tags
    stl_writer.ts      binary STL serialiser
    3mf_writer.ts      colour 3MF serialiser (zip container)
    split_mesh.ts      clips a mesh at Z planes into bodies
  shapes/              one plugin per shape
  worker/
    stl.worker.ts      the whole generation pipeline, off the main thread
```

Adding a shape means implementing the `ShapePlugin` interface in `src/core/types.ts` and
registering it in `src/shapes/index.ts`.

---

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build locally
npm run lint
```

Requires Node 20+.

Pushing to `main` builds and publishes to GitHub Pages automatically
(`.github/workflows/deploy.yml`) — `dist/` is never committed.

### Measuring, rather than reading

Reading this code has repeatedly missed what generating a mesh and measuring it caught. The
useful checks, in order of how often they have found something:

1. **Render it.** A small flat-shaded rasteriser over the exported triangles. Contour
   length, wall counts and positional error have all said "fine" while the picture plainly
   was not.
2. **Signed volume under translation.** Translation-invariant only for a closed surface, so
   if moving the mesh changes its volume there is a hole.
3. **Unmatched directed edges.** Every `a→b` matched by exactly one `b→a`.
4. **Volume against the analytic solid.** A hexagon of a known width has a known area.
5. **Coverage.** Sample the slab and count how many bodies cover each point — one is right,
   two is an overlap, none is a gap.

---

## Roadmap

- [x] `Float32Array` mesh buffers, isotropic cell sizing, one radial builder for all shapes
- [x] Area-average the heightmap per vertex so detail finer than the mesh stops aliasing
- [x] Live 3D preview of the generated mesh
- [x] Colour bands for every shape
- [x] Auto tone detection that fits the picture instead of dividing the range
- [x] Inlay mode: colour side by side in one layer, not stacked
- [x] Tones as regions, in both Inlay and Graphic
- [ ] Keep the closure and coverage checks running in CI so meshes cannot regress
- [ ] Gamma / contrast curve so dark tones stop clipping
- [ ] Adaptive subdivision: spend cells on detail, collapse flat regions

## Mesh invariants

The generators produce **closed, consistently wound** meshes: every directed edge `a→b`
matched by exactly one `b→a`, no zero-area triangles, and a signed volume that does not
change when the model is translated. For a multi-body export each body has to satisfy all
of that on its own, and the bodies together have to tile the model without overlapping.

---

## License

MIT — see [LICENSE](LICENSE).

## Author

Created by **Erol Can Ulutaş**
