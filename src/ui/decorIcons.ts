import {
  buildRelief,
  cutLoops,
  FLUSH_DEPTH_MM,
  MASK_PX_PER_MM,
  OVERHANG_MM,
  recessLoops,
  stepHeights,
  type DecorGeom,
  type DecorMask,
  type Decoration,
  FONTS,
  isText,
  type Relief,
  type ReliefMode,
} from "../core/decor";
import { clusterColors, hexToLab, labelPixels, type Lab } from "../core/palette";
import type { Recess } from "../core/holder";

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

let measurer: CanvasRenderingContext2D | null = null;

/** The CSS font for a piece of text, at `px` pixels. */
export function fontOf(d: Decoration, px: number): string {
  const css = FONTS.find((f) => f.id === d.font)?.css ?? FONTS[0].css;
  return `${d.bold ? "bold " : ""}${px}px ${css}`;
}

/**
 * How big a decoration is, in mm: an icon is a square, text is as wide as its
 * words. Measured at a large size and scaled, so it does not depend on how
 * small the letters happen to be drawn.
 */
export function decorationBox(d: Decoration): { w: number; h: number } {
  if (!isText(d)) return { w: d.size, h: d.size };
  if (!measurer) measurer = document.createElement("canvas").getContext("2d");
  let width = (d.text?.length ?? 0) * 0.6 * 100;
  if (measurer) {
    measurer.font = fontOf(d, 100);
    width = measurer.measureText(d.text || " ").width;
  }
  return { w: Math.max(d.size * 0.5, (width / 100) * d.size), h: d.size * 1.25 };
}

/** Where a decoration is drawn, in a canvas whose unit is `scale` pixels to the mm. */
export function drawDecoration(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | null,
  d: Decoration,
  heightMm: number,
  scale: number,
) {
  ctx.save();
  ctx.translate(d.x * scale, (heightMm - d.y) * scale);
  ctx.rotate((d.rotation * Math.PI) / 180);
  if (isText(d)) {
    ctx.font = fontOf(d, d.size * scale);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = d.color ?? "#1f2937";
    ctx.fillText(d.text || "", 0, 0);
  } else if (img) {
    const px = d.size * scale;
    ctx.drawImage(img, -px / 2, -px / 2, px, px);
  }
  ctx.restore();
}

/** Icons whose name or category matches what was typed, for the search box. */
export function searchIcons(query: string): Icon[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return ICONS.filter((i) => i.label.includes(q) || i.id.includes(q));
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
/** How the raised shapes are told apart: by height, and by colour. */
export type ReliefLook = {
  mode: ReliefMode;
  /** The most colours the icons are printed in; 0 prints them all in one. */
  colours: number;
  /**
   * The colours of filament to hand. When there are any, each colour of an icon
   * is printed in the nearest of these, whatever the icons were drawn in.
   */
  palette?: readonly string[];
};

/** Colours closer than this are one colour of filament. */
const COLOUR_GAP = 30;

export async function renderMask(
  decorations: readonly Decoration[],
  geom: DecorGeom,
  look: ReliefLook = { mode: "flat", colours: 0 },
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
    const images = await Promise.all(which.map((d) => (isText(d) ? null : loadIcon(d.icon))));
    ctx.save();
    ctx.translate(M * px, M * px);
    which.forEach((d, i) => drawDecoration(ctx, images[i], d, H, px));
    ctx.restore();
    return ctx.getImageData(0, 0, w, h).data;
  };

  const raised = decorations.filter((d) => !d.cut && !d.flush);
  const flushing = decorations.filter((d) => !d.cut && d.flush);
  const cutting = decorations.filter((d) => d.cut);
  const rd = raised.length > 0 ? await draw(raised) : null;
  const fd = flushing.length > 0 ? await draw(flushing) : null;
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
  const cutOut = new Uint8Array(w * h);
  const flush = new Uint8Array(w * h);
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
      }

      // A cut goes clean through, so it stays clear of the edge and the pocket,
      // and above the rail the legs stand on. A recess is only 1 mm deep, from
      // the front, and leaves the lip over the pocket and the rail's back as
      // they were, so it may be anywhere on the face but the window and the
      // edge; what is outside that is raised instead, so nothing goes missing.
      const roomy =
        inside(mx, my, CUT_MARGIN_MM) &&
        !inRect(pocket, mx, my, CUT_MARGIN_MM) &&
        my >= rail + CUT_MARGIN_MM;
      const sinkable = inside(mx, my, CUT_MARGIN_MM) && !inRect(window, mx, my, CUT_MARGIN_MM);
      if (fd && fd[i * 4 + 3] >= 128) {
        if (sinkable) {
          flush[i] = 1;
        } else if (my >= 0) {
          if (onFace && !inRect(window, mx, my)) onFrame[i] = 1;
          else beyond[i] = 1;
        }
      }

      if (cd && cd[i * 4 + 3] >= 128 && roomy) {
        cutOut[i] = 1;
      }
    }
  }

  if (cd) joinFloating(cutOut, border, w, h);

  // What is cut is not also raised, or sunk.
  for (let i = 0; i < onFrame.length; i++) {
    if (cutOut[i]) {
      onFrame[i] = 0;
      beyond[i] = 0;
      flush[i] = 0;
    }
  }

  // What fills a recess is a pixel smaller than it. A fill that overlapped the
  // frame round it put two solids in the same space, which a viewer shows as a
  // ragged outline and a slicer may colour either way; one that is smaller meets
  // the frame only along the floor and leaves a hair of clearance all round, which
  // is what an inlay wants anyway, since printed parts swell.
  const colours = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (onFrame[i] || beyond[i]) {
      const src = rd && rd[i * 4 + 3] >= 128 ? rd : fd;
      if (src) {
        colours[i * 4] = src[i * 4];
        colours[i * 4 + 1] = src[i * 4 + 1];
        colours[i * 4 + 2] = src[i * 4 + 2];
      }
    }
  }
  const flushBody = new Uint8Array(w * h);
  if (fd) {
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!flush[i]) continue;
        // Kept only if the pixel and all four beside it are part of the recess.
        if (flush[i - 1] && flush[i + 1] && flush[i - w] && flush[i + w]) {
          flushBody[i] = 1;
          colours[i * 4] = fd[i * 4];
          colours[i * 4 + 1] = fd[i * 4 + 1];
          colours[i * 4 + 2] = fd[i * 4 + 2];
        }
      }
    }
  }

  const { group, groupFrac, groupColors } = groupRaised(onFrame, beyond, flushBody, colours, look);

  return {
    onFrame,
    beyond,
    cutOut,
    flush,
    flushBody,
    group,
    groupFrac,
    groupColors,
    w,
    h,
    originX: -M,
    originY: -M,
    spanX: W + 2 * M,
    spanY: H + 2 * M,
  };
}

/** Brightness of a #rrggbb colour, 0 to 1. */
function brightness(hex: string): number {
  const v = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return (0.2126 * v(1) + 0.7152 * v(3) + 0.0722 * v(5)) / 255;
}

/**
 * Splits the raised pixels into bodies.
 *
 * By default a body is a height step: the icons' own brightness, in three steps
 * when heights follow colour, or one step when they do not. With colours on, a
 * body is one of the icons' colours, found in Lab so that shades of one colour
 * are one body, and each stands at the height its own brightness gives it.
 */
function groupRaised(
  onFrame: Uint8Array,
  beyond: Uint8Array,
  sunk: Uint8Array,
  rgba: Uint8ClampedArray | null,
  look: ReliefLook,
): { group: Uint8Array; groupFrac: number[]; groupColors: string[] } {
  const n = onFrame.length;
  const group = new Uint8Array(n);
  const fracs = stepHeights(look.mode);
  const stepOf = (lum: number) => Math.min(fracs.length - 1, Math.floor(lum * fracs.length));

  const raised: number[] = [];
  for (let i = 0; i < n; i++) if (onFrame[i] || beyond[i] || sunk[i]) raised.push(i);

  if (look.colours <= 0 || !rgba || raised.length === 0) {
    if (rgba && fracs.length > 1) {
      for (const i of raised) {
        const lum = (0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2]) / 255;
        group[i] = stepOf(lum);
      }
    }
    return { group, groupFrac: fracs, groupColors: fracs.map(() => "") };
  }

  // The icons' colours, from the pixels that are actually raised.
  const sample = new Uint8ClampedArray(raised.length * 4);
  raised.forEach((p, k) => {
    sample[k * 4] = rgba[p * 4];
    sample[k * 4 + 1] = rgba[p * 4 + 1];
    sample[k * 4 + 2] = rgba[p * 4 + 2];
    sample[k * 4 + 3] = 255;
  });
  const img = { width: raised.length, height: 1, data: sample } as unknown as ImageData;

  // With filaments named, the colours are theirs and nothing is looked for.
  const given = (look.palette ?? []).filter((c) => /^#[0-9a-f]{6}$/i.test(c));
  if (given.length > 0) {
    const label = labelPixels(sample, given.map(hexToLab));
    raised.forEach((p, k) => {
      group[p] = label[k];
    });
    return {
      group,
      groupFrac: given.map((c) => (look.mode === "flat" ? 1 : fracs[stepOf(brightness(c))])),
      groupColors: given.map((c) => c.toLowerCase()),
    };
  }

  const found = clusterColors(img, Math.max(2, look.colours), COLOUR_GAP);

  // Centres too near one another are one colour: keep the first of each.
  const centres: Lab[] = [];
  const colours: string[] = [];
  found.lab.forEach((c, k) => {
    const near = centres.some(
      (o) => (o[0] - c[0]) ** 2 + (o[1] - c[1]) ** 2 + (o[2] - c[2]) ** 2 < COLOUR_GAP * COLOUR_GAP,
    );
    if (!near) {
      centres.push(c);
      colours.push(found.colors[k]);
    }
  });

  const label = labelPixels(sample, centres);
  raised.forEach((p, k) => {
    group[p] = label[k];
  });

  return {
    group,
    groupFrac: colours.map((c) => (look.mode === "flat" ? 1 : fracs[stepOf(brightness(c))])),
    groupColors: colours,
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
  look: ReliefLook,
): Promise<{ relief: Relief; cuts: [number, number][][]; recess: Recess | null }> {
  const mask = await renderMask(decorations, geom, look);
  const sunk = recessLoops(mask);
  return {
    relief: buildRelief(mask, geom.frontZ, height, geom.lip),
    cuts: cutLoops(mask),
    recess: sunk.outer.length > 0 ? { ...sunk, depth: FLUSH_DEPTH_MM } : null,
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
      "sailboat", "ship", "anchor", "airplane", "tent", "camera", "tropical-fish",
      "compass", "luggage", "globe", "palm-sunglasses", "ice-cream", "watermelon",
      "bicycle", "rocket", "locomotive", "bus", "taxi", "automobile", "motor-scooter",
      "sunrise", "camping", "telescope", "castle", "statue-of-liberty", "mount-fuji",
      "national-park", "desert", "volcano", "map-of-japan", "world-map",
      "passport-control", "house", "ferris-wheel", "roller-coaster", "carousel-horse",
      "fountain", "bridge-at-night", "cityscape",
    ],
  },
  {
    id: "halloween",
    label: "Halloween",
    icons: [
      "pumpkin", "ghost", "bat", "spider-web", "skull", "candy", "candle", "wilted-flower",
      "skull-and-crossbones", "spider", "black-cat", "crystal-ball", "lollipop",
      "chocolate-bar", "coffin", "headstone", "eye", "brain", "alien-monster", "alien",
      "robot", "full-moon", "broom", "crescent-moon",
    ],
  },
  {
    id: "party",
    label: "Party & music",
    icons: [
      "party-popper", "cake", "gift", "balloon", "fireworks", "sparkles", "christmas-tree",
      "snowflake", "bell", "crown", "star", "snowman", "snowman-without-snow", "sparkler",
      "firecracker", "confetti-ball", "cupcake", "bottle-with-popping-cork",
      "clinking-glasses", "beer-mug", "wine-glass", "trophy", "1st-place-medal", "ribbon",
      "reminder-ribbon", "red-envelope", "tanabata-tree", "carp-streamer", "wind-chime",
      "glowing-star", "musical-notes", "musical-note", "microphone", "headphone", "guitar",
      "violin", "drum", "trumpet", "saxophone", "musical-keyboard", "hamsa",
    ],
  },
  {
    id: "culture",
    label: "Culture",
    icons: [
      "star-and-crescent", "mosque", "kaaba", "teapot", "hot-beverage", "pot-of-food",
      "bagel", "flatbread", "stuffed-flatbread", "falafel", "olive", "grapes",
      "hot-pepper", "garlic", "lemon", "tangerine", "peach", "honey-pot", "camel",
      "church", "synagogue", "hindu-temple", "shinto-shrine", "tokyo-tower", "moai",
      "nazar-amulet", "tulip",
    ],
  },
  {
    id: "nature",
    label: "Nature, animals & love",
    icons: [
      "heart", "flower", "rose", "sunflower", "clover", "butterfly", "rainbow", "mountain",
      "cat", "dog", "paw-prints", "bone", "hibiscus", "blossom", "herb", "cactus",
      "evergreen-tree", "deciduous-tree", "maple-leaf", "fallen-leaf", "mushroom",
      "bouquet", "seedling", "honeybee", "lady-beetle", "snail", "turtle", "dolphin",
      "whale", "octopus", "crab", "penguin", "owl", "peacock", "swan", "flamingo", "dove",
      "fox", "panda", "koala", "lion", "elephant", "giraffe", "rabbit-face", "hedgehog",
      "horse", "unicorn", "dragon", "cloud", "fire", "droplet", "high-voltage",
      "sparkling-heart", "two-hearts", "revolving-hearts", "heart-with-arrow", "kiss-mark",
      "love-letter", "ring", "gem-stone", "cherry-blossom", "comet", "cow-face",
      "pig-face", "frog", "monkey-face", "bird", "chicken", "duck", "parrot", "shark",
      "fish", "blowfish", "seal", "otter", "sloth", "raccoon", "bear", "wolf",
      "tiger-face", "leopard", "zebra",
    ],
  },
  {
    id: "fun",
    label: "Fun & hobbies",
    icons: [
      "video-game", "soccer-ball", "basketball", "baseball", "tennis", "puzzle-piece",
      "artist-palette", "paintbrush", "books", "open-book", "graduation-cap", "light-bulb",
      "key", "locked", "laptop", "joystick", "teddy-bear", "kite", "magic-wand",
      "telephone", "camera-with-flash", "movie-camera", "film-frames", "clapper-board",
      "ticket", "performing-arts", "circus-tent", "roller-skate", "skateboard", "sled",
      "ice-skate", "fishing-pole", "bowling", "boxing-glove",
    ],
  },
  {
    id: "food",
    label: "Food & drink",
    icons: [
      "pizza", "hamburger", "french-fries", "taco", "doughnut", "cookie", "red-apple",
      "strawberry", "cherries", "pineapple", "banana", "avocado", "carrot", "hot-dog",
      "popcorn", "pie", "teacup-without-handle", "tropical-drink", "cocktail-glass",
      "baguette-bread", "croissant", "pancakes", "waffle", "cheese-wedge", "egg",
      "cooking", "spaghetti", "sushi", "birthday-cake",
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
