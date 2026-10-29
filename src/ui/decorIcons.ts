import {
  buildRelief,
  cutLoops,
  MASK_PX_PER_MM,
  OVERHANG_MM,
  RELIEF_STEPS,
  type DecorGeom,
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

/** How close a cut may come to the frame's edge and to the pocket, in mm. */
const CUT_MARGIN_MM = 1.2;

/** Half the width of the bridge that joins a floating piece back, in px. */
const BRIDGE_RADIUS_PX = 3;

/**
 * Which pixels of the holder the decorations cover, and how bright each is.
 *
 * The canvas reaches OVERHANG_MM past the frame on every side so an icon can
 * hang over its edge. Pixels that have a frame under them are told apart from
 * those that do not — past the edge, over a rounded corner, or over the window —
 * because they are built differently; anything below the frame's underside is
 * dropped, because that is where the table is.
 */
export async function renderMask(
  decorations: readonly Decoration[],
  geom: DecorGeom,
): Promise<DecorMask> {
  const M = OVERHANG_MM;
  const px = MASK_PX_PER_MM;
  const { W, H, corner, window, pocket, rail } = geom;
  const w = Math.ceil((W + 2 * M) * px);
  const h = Math.ceil((H + 2 * M) * px);

  const draw = async (which: readonly Decoration[]) => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("No canvas");
    const images = await Promise.all(which.map((d) => loadIcon(d.icon)));
    ctx.save();
    ctx.translate(M * px, M * px);
    which.forEach((d, i) => drawDecoration(ctx, images[i], d, H, px));
    ctx.restore();
    return ctx.getImageData(0, 0, w, h).data;
  };

  const raised = decorations.filter((d) => !d.cut);
  const cutting = decorations.filter((d) => d.cut);
  const rd = raised.length > 0 ? await draw(raised) : null;
  const cd = cutting.length > 0 ? await draw(cutting) : null;

  /** Whether a point is on a rounded rectangle from (0,0) to (W,H) shrunk by `inset`. */
  const inside = (x: number, y: number, inset: number) => {
    if (x < inset || x > W - inset || y < inset || y > H - inset) return false;
    const r = Math.max(0, corner - inset);
    if (r <= 0) return true;
    const dx = Math.max(0, inset + r - x, x - (W - inset - r));
    const dy = Math.max(0, inset + r - y, y - (H - inset - r));
    return dx * dx + dy * dy <= r * r;
  };
  const inRect = (r: Rect, x: number, y: number, grow = 0) =>
    x >= r.x0 - grow && x <= r.x1 + grow && y >= r.y0 - grow && y <= r.y1 + grow;

  const onFrame = new Uint8Array(w * h);
  const beyond = new Uint8Array(w * h);
  const steps = new Uint8Array(w * h);
  const cutOut = new Uint8Array(w * h);
  /** The frame's border: on the frame and not over the pocket. */
  const border = new Uint8Array(w * h);

  for (let y = 0; y < h; y++) {
    const my = H + M - (y + 0.5) / px;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const mx = (x + 0.5) / px - M;
      const onFace = inside(mx, my, 0);
      if (onFace && !inRect(pocket, mx, my, CUT_MARGIN_MM)) border[i] = 1;

      if (rd && rd[i * 4 + 3] >= 128 && my >= 0) {
        if (onFace && !inRect(window, mx, my)) onFrame[i] = 1;
        else beyond[i] = 1;
        const lum = (0.2126 * rd[i * 4] + 0.7152 * rd[i * 4 + 1] + 0.0722 * rd[i * 4 + 2]) / 255;
        steps[i] = Math.min(RELIEF_STEPS - 1, Math.floor(lum * RELIEF_STEPS));
      }

      // A cut stays clear of the edge and the pocket, and above the rail the
      // legs stand on.
      if (
        cd && cd[i * 4 + 3] >= 128 &&
        inside(mx, my, CUT_MARGIN_MM) &&
        !inRect(pocket, mx, my, CUT_MARGIN_MM) &&
        my >= rail + CUT_MARGIN_MM
      ) {
        cutOut[i] = 1;
      }
    }
  }

  if (cd) joinFloating(cutOut, border, w, h);

  // What is cut is not also raised.
  for (let i = 0; i < onFrame.length; i++) {
    if (cutOut[i]) {
      onFrame[i] = 0;
      beyond[i] = 0;
    }
  }

  return {
    onFrame,
    beyond,
    cutOut,
    steps,
    w,
    h,
    originX: -M,
    originY: -M,
    spanX: W + 2 * M,
    spanY: H + 2 * M,
  };
}

/**
 * Joins back any piece of the frame a cut has left floating.
 *
 * The inside of an O, the gap between two petals: a piece of frame with a cut
 * all the way round it is not attached to anything and would print as a loose
 * speck. Each is joined to the main frame by a narrow bridge along the shortest
 * way through the cut, which is how a stencil keeps its centres.
 */
function joinFloating(cut: Uint8Array, border: Uint8Array, w: number, h: number) {
  const n = w * h;
  const label = new Int32Array(n);
  const sizes: number[] = [0];
  const queue = new Int32Array(n);

  const fill = (start: number, id: number) => {
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    label[start] = id;
    let count = 0;
    while (head < tail) {
      const p = queue[head++];
      count++;
      const x = p % w;
      const y = (p - x) / w;
      const visit = (q: number) => {
        if (border[q] && !cut[q] && label[q] === 0) {
          label[q] = id;
          queue[tail++] = q;
        }
      };
      if (x > 0) visit(p - 1);
      if (x < w - 1) visit(p + 1);
      if (y > 0) visit(p - w);
      if (y < h - 1) visit(p + w);
    }
    sizes[id] = count;
  };

  for (let i = 0; i < n; i++) {
    if (border[i] && !cut[i] && label[i] === 0) fill(i, sizes.length);
  }
  if (sizes.length <= 2) return;

  let main = 1;
  for (let id = 2; id < sizes.length; id++) if (sizes[id] > sizes[main]) main = id;

  const seen = new Int32Array(n);
  const parent = new Int32Array(n);
  let round = 0;

  for (let id = 1; id < sizes.length; id++) {
    if (id === main) continue;
    round++;

    // Search outwards from the piece, through the cut, until the main frame.
    let head = 0;
    let tail = 0;
    for (let i = 0; i < n; i++) {
      if (label[i] === id) {
        seen[i] = round;
        parent[i] = -1;
        queue[tail++] = i;
      }
    }

    let found = -1;
    while (head < tail && found < 0) {
      const p = queue[head++];
      const x = p % w;
      const y = (p - x) / w;
      const next = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of next) {
        if (q < 0 || seen[q] === round) continue;
        if (label[q] === main) {
          found = p;
          break;
        }
        if (cut[q]) {
          seen[q] = round;
          parent[q] = p;
          queue[tail++] = q;
        }
      }
    }

    // No way through the cut: the piece is simply cut away with it.
    if (found < 0) {
      for (let i = 0; i < n; i++) if (label[i] === id) cut[i] = 1;
      continue;
    }

    const R = BRIDGE_RADIUS_PX;
    for (let p = found; p >= 0; p = parent[p]) {
      if (!cut[p]) continue;
      const x = p % w;
      const y = (p - x) / w;
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          if (dx * dx + dy * dy > R * R) continue;
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const q = yy * w + xx;
          if (cut[q]) {
            cut[q] = 0;
            label[q] = main;
          }
        }
      }
    }
    for (let i = 0; i < n; i++) if (label[i] === id) label[i] = main;
  }
}

/** The raised shapes and the cuts for a set of decorations. */
export async function makeDecor(
  decorations: readonly Decoration[],
  geom: DecorGeom,
  height: number,
  mode: ReliefMode,
): Promise<{ relief: Mesh; cuts: [number, number][][] }> {
  const mask = await renderMask(decorations, geom);
  return {
    relief: buildRelief(mask, geom.frontZ, height, mode, geom.lip),
    cuts: cutLoops(mask),
  };
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
