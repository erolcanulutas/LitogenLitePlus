# Litogen Lite+

Browser-based **lithophane generator**. Drop in a photo, pick a shape, get a 3D-printable
STL (or a two-colour 3MF) — everything runs locally in your browser.

👉 **Live:** https://erolcanulutas.github.io/LitogenLitePlus/

> Successor to [Litogen-Lite](https://github.com/erolcanulutas/Litogen-Lite). Same geometry
> engine, now with the source under version control and a proper build pipeline.

---

## Features

| | |
|---|---|
| 🔺 | Equilateral **triangle** lithophanes |
| ⚪ | **Circle** lithophanes |
| ⬢ | **Hexagon** lithophanes |
| ⬠ | **Pentagon** lithophanes |
| 🖼️ | Image import with in-browser crop, rotate and flip |
| 📐 | Millimetre-accurate width, thickness and frame control |
| 🎨 | Colour split → two stacked bodies exported as **3MF** for multi-material printing |
| ⚡ | All heavy work runs in a **Web Worker** — the UI never blocks |
| 🔒 | **Nothing is uploaded.** No backend, no API, no tracking |

---

## How it works

```
image  →  resample (OffscreenCanvas)  →  luminance heightmap  →  shape.build()
                                                                      ↓
       download  ←  binary STL / colour 3MF  ←  orient upright  ←  triangle mesh
```

1. The picked image is resampled to a fixed row count so mesh density is independent of
   the source resolution.
2. Each pixel becomes a height in `0..1` using Rec.709 luminance
   (`0.2126·R + 0.7152·G + 0.0722·B`).
3. The selected shape plugin turns that heightmap into a solid triangle mesh — dark pixels
   become thick, light pixels thin.
4. The mesh is rotated upright (printable orientation) and serialised. If a colour split
   height is set, the mesh is clipped at that Z plane and written as a two-material 3MF.

---

## Project layout

```
src/
  App.tsx            UI shell and all generator parameters
  ui/                ImageEditor (crop/rotate/flip), ImageControls, ImagePicker
  core/
    heightmap.ts     image → luminance grid
    sample.ts        bilinear heightmap sampling
    quality.ts       mesh density presets
    types.ts         ShapePlugin contract
    stl_writer.ts    binary STL serialiser
    3mf_writer.ts    colour 3MF serialiser (zip container)
    split_mesh.ts    clips a mesh at a Z plane into two materials
  shapes/            triangle, circle, hexagon, pentagon — one plugin per file
  worker/
    stl.worker.ts    the whole generation pipeline, off the main thread
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

---

## Roadmap

- [ ] Replace the `Vec3[]` mesh representation with `Float32Array` buffers (memory + speed)
- [ ] Emit the flat base as a single fan instead of matching the top-surface density
- [ ] Unify the quality presets so a level means the same thing for every shape
- [ ] Share one radial mesh builder between circle / hexagon / pentagon
- [ ] Live 3D preview of the generated mesh
- [ ] Gamma / contrast curve so dark tones stop clipping
- [ ] Colour split for every shape, not just pentagon
- [ ] Watertight validation (edge-pairing check) before export

---

## License

MIT — see [LICENSE](LICENSE).

## Author

Created by **Erol Can Ulutaş**
