import { buildRelief, MASK_PX_PER_MM, type Decoration } from "../core/decor";
import type { Mesh } from "../core/mesh";

/** Every icon in the assets folder, found by Vite at build time. */
const files = import.meta.glob("../assets/icons/*.svg", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

export type Icon = { id: string; label: string; url: string };

export const ICONS: Icon[] = Object.entries(files)
  .map(([path, url]) => {
    const id = path.replace(/^.*\//, "").replace(/\.svg$/, "");
    return { id, label: id.replace(/-/g, " "), url };
  })
  .sort((a, b) => a.label.localeCompare(b.label));

const byId = new Map(ICONS.map((i) => [i.id, i]));
const loaded = new Map<string, Promise<HTMLImageElement>>();

/** The image for an icon, loaded once. Rejects for a name that is not an icon. */
export function loadIcon(id: string): Promise<HTMLImageElement> {
  let p = loaded.get(id);
  if (!p) {
    const icon = byId.get(id);
    p = new Promise((resolve, reject) => {
      if (!icon) {
        reject(new Error(`No icon called ${id}`));
        return;
      }
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Icon ${id} would not load`));
      img.src = icon.url;
    });
    loaded.set(id, p);
  }
  return p;
}

/** Where an icon is drawn, in a canvas whose unit is `scale` pixels to the mm. */
export function drawDecoration(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  d: Decoration,
  heightMm: number,
  scale: number,
) {
  const px = d.size * scale;
  ctx.save();
  ctx.translate(d.x * scale, (heightMm - d.y) * scale);
  ctx.rotate((d.rotation * Math.PI) / 180);
  ctx.drawImage(img, -px / 2, -px / 2, px, px);
  ctx.restore();
}

type Rect = { x0: number; x1: number; y0: number; y1: number };

/**
 * Which pixels of the holder's front face an icon covers.
 *
 * Anything over the window is taken out, so a decoration can never stand in
 * front of the picture.
 */
export async function renderMask(
  decorations: readonly Decoration[],
  widthMm: number,
  heightMm: number,
  window: Rect,
): Promise<{ mask: Uint8Array; w: number; h: number }> {
  const w = Math.ceil(widthMm * MASK_PX_PER_MM);
  const h = Math.ceil(heightMm * MASK_PX_PER_MM);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("No canvas");

  const images = await Promise.all(decorations.map((d) => loadIcon(d.icon)));
  decorations.forEach((d, i) => drawDecoration(ctx, images[i], d, heightMm, MASK_PX_PER_MM));

  // A sliver of the window's own edge is spared the icon: a raised edge
  // against the opening would overhang it.
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillRect(
    window.x0 * MASK_PX_PER_MM,
    (heightMm - window.y1) * MASK_PX_PER_MM,
    (window.x1 - window.x0) * MASK_PX_PER_MM,
    (window.y1 - window.y0) * MASK_PX_PER_MM,
  );

  const data = ctx.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] >= 128 ? 1 : 0;
  return { mask, w, h };
}

/** The raised shapes for a set of decorations, ready to join the holder. */
export async function makeRelief(
  decorations: readonly Decoration[],
  widthMm: number,
  heightMm: number,
  window: Rect,
  baseZ: number,
  height: number,
): Promise<Mesh> {
  const { mask, w, h } = await renderMask(decorations, widthMm, heightMm, window);
  return buildRelief(mask, w, h, widthMm, heightMm, baseZ, height);
}
