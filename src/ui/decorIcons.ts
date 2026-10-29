import {
  buildRelief,
  MASK_PX_PER_MM,
  OVERHANG_MM,
  RELIEF_STEPS,
  type DecorMask,
  type Decoration,
  type ReliefMode,
} from "../core/decor";
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
 * Which pixels of the holder an icon covers, and how bright each is.
 *
 * The canvas reaches OVERHANG_MM past the frame on every side so an icon can
 * hang over its edge. What is over the frame's face is told apart from what is
 * beyond it, because they are built differently; anything over the picture's
 * window is taken out, so a decoration can never stand in front of the
 * picture, and anything below the frame's underside is dropped, because that
 * is where the table is.
 */
export async function renderMask(
  decorations: readonly Decoration[],
  widthMm: number,
  heightMm: number,
  window: Rect,
): Promise<DecorMask> {
  const M = OVERHANG_MM;
  const px = MASK_PX_PER_MM;
  const w = Math.ceil((widthMm + 2 * M) * px);
  const h = Math.ceil((heightMm + 2 * M) * px);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("No canvas");

  const images = await Promise.all(decorations.map((d) => loadIcon(d.icon)));
  ctx.save();
  ctx.translate(M * px, M * px);
  decorations.forEach((d, i) => drawDecoration(ctx, images[i], d, heightMm, px));
  ctx.restore();

  const data = ctx.getImageData(0, 0, w, h).data;

  // Frame and window in canvas pixels: row 0 is the top, which is y = H + M.
  const left = M * px;
  const right = (M + widthMm) * px;
  const top = M * px;
  const bottom = (M + heightMm) * px;
  const wx0 = (M + window.x0) * px;
  const wx1 = (M + window.x1) * px;
  const wy0 = (M + heightMm - window.y1) * px;
  const wy1 = (M + heightMm - window.y0) * px;

  const onFrame = new Uint8Array(w * h);
  const beyond = new Uint8Array(w * h);
  const steps = new Uint8Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (data[i * 4 + 3] < 128) continue;

      const over = x >= left && x < right && y >= top && y < bottom;
      if (over) {
        if (x >= wx0 && x < wx1 && y >= wy0 && y < wy1) continue;
        onFrame[i] = 1;
      } else if (y < bottom) {
        beyond[i] = 1;
      } else {
        continue;
      }

      const lum =
        (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255;
      steps[i] = Math.min(RELIEF_STEPS - 1, Math.floor(lum * RELIEF_STEPS));
    }
  }

  return {
    onFrame,
    beyond,
    steps,
    w,
    h,
    originX: -M,
    originY: -M,
    spanX: widthMm + 2 * M,
    spanY: heightMm + 2 * M,
  };
}

/** The raised shapes for a set of decorations, ready to join the holder. */
export async function makeRelief(
  decorations: readonly Decoration[],
  widthMm: number,
  heightMm: number,
  window: Rect,
  frontZ: number,
  height: number,
  mode: ReliefMode,
): Promise<Mesh> {
  const mask = await renderMask(decorations, widthMm, heightMm, window);
  return buildRelief(mask, frontZ, height, mode);
}

/**
 * The icons by subject, for the palette. Anything not named here still shows,
 * under "More", so a new file dropped in the folder is never lost.
 */
export const CATEGORIES: { id: string; label: string; icons: string[] }[] = [
  {
    id: "beach",
    label: "Beach & travel",
    icons: [
      "palm-tree", "cocktail", "umbrella-beach", "sun", "wave", "seashell", "beach-ball",
      "sailboat", "ship", "anchor", "airplane", "tent", "camera", "tropical-fish", "compass",
      "luggage", "globe", "palm-sunglasses", "ice-cream", "watermelon", "bicycle",
    ],
  },
  {
    id: "halloween",
    label: "Halloween",
    icons: ["pumpkin", "ghost", "bat", "spider-web", "skull", "candy", "candle"],
  },
  {
    id: "party",
    label: "Party & holidays",
    icons: [
      "party-popper", "cake", "gift", "balloon", "fireworks", "sparkles", "christmas-tree",
      "snowflake", "bell", "crown", "star",
    ],
  },
  {
    id: "nature",
    label: "Nature & love",
    icons: [
      "heart", "flower", "rose", "tulip", "sunflower", "clover", "butterfly", "rainbow",
      "mountain", "cat", "dog", "paw-prints", "bone",
    ],
  },
];

/** Icons in a category, in its order, then any the categories do not name. */
export function iconsIn(categoryId: string): Icon[] {
  if (categoryId === "more") {
    const named = new Set(CATEGORIES.flatMap((c) => c.icons));
    return ICONS.filter((i) => !named.has(i.id));
  }
  const cat = CATEGORIES.find((c) => c.id === categoryId);
  if (!cat) return [];
  return cat.icons.map((id) => byId.get(id)).filter((i): i is Icon => i !== undefined);
}

/** Whether any icon falls outside the named categories. */
export const HAS_MORE = iconsIn("more").length > 0;
