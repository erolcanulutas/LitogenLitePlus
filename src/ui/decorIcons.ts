import {
  buildRelief,
  cutLoops,
  FLUSH_DEPTH_MM,
  MASK_PX_PER_MM,
  OVERHANG_MM,
  recessLoops,
  stepHeights,
  traceFlush,
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
import { outsideBy } from "../core/outline";

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
    if (d.tint) {
      // A silhouette: the icon's shape filled with one colour.
      const side = Math.max(1, Math.ceil(px));
      const tmp = document.createElement("canvas");
      tmp.width = side;
      tmp.height = side;
      const t = tmp.getContext("2d");
      if (t) {
        t.drawImage(img, 0, 0, side, side);
        t.globalCompositeOperation = "source-in";
        t.fillStyle = d.tint;
        t.fillRect(0, 0, side, side);
        ctx.drawImage(tmp, -px / 2, -px / 2, px, px);
      }
    } else {
      ctx.drawImage(img, -px / 2, -px / 2, px, px);
    }
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
    if (geom.squeeze && geom.squeeze < 1) {
      ctx.translate((W / 2) * px, 0);
      ctx.scale(geom.squeeze, 1);
      ctx.translate((-W / 2) * px, 0);
    }
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
    if (geom.poly) return outsideBy(geom.poly.outer, x, y) <= -inset;
    if (x < inset || x > W - inset || y < inset || y > H - inset) return false;
    const r = Math.max(0, corner - inset);
    if (r <= 0) return true;
    const dx = Math.max(0, inset + r - x, x - (W - inset - r));
    const dy = Math.max(0, inset + r - y, y - (H - inset - r));
    return dx * dx + dy * dy <= r * r;
  };
  const inRect = (r: Rect, x: number, y: number, grow = 0) =>
    x >= r.x0 - grow && x <= r.x1 + grow && y >= r.y0 - grow && y <= r.y1 + grow;
  // A frame that follows a shape is not boxes, so these ask the shape instead.
  const frame = geom.poly;
  const inPocket = (x: number, y: number, grow = 0) =>
    frame ? outsideBy(frame.pocket, x, y) <= grow : inRect(pocket, x, y, grow);
  const inWindow = (x: number, y: number, grow = 0) =>
    frame ? outsideBy(frame.window, x, y) <= grow : inRect(window, x, y, grow);

  const onFrame = new Uint8Array(w * h);
  const beyond = new Uint8Array(w * h);
  const cutOut = new Uint8Array(w * h);
  const flush = new Uint8Array(w * h);
  const sinkableMask = new Uint8Array(w * h);
  /** Parts of a flush decoration that could not be sunk: built level with the face rather than standing out of it. */
  const flat = new Uint8Array(w * h);
  /** The frame's border: on the frame and not over the pocket. */
  const border = new Uint8Array(w * h);

  for (let y = 0; y < h; y++) {
    const my = H + M - (y + 0.5) / px;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const mx = (x + 0.5) / px - M;
      const onFace = inside(mx, my, 0);
      if (onFace && !inPocket(mx, my, CUT_MARGIN_MM)) border[i] = 1;

      if (rd && rd[i * 4 + 3] >= 128 && my >= 0) {
        if (onFace && !inWindow(mx, my)) onFrame[i] = 1;
        else beyond[i] = 1;
      }

      // A cut goes clean through, so it stays clear of the edge and the pocket,
      // and above the rail the legs stand on. A recess is only 1 mm deep, from
      // the front, and leaves the lip over the pocket and the rail's back as
      // they were, so it may be anywhere on the face but the window and the
      // edge; what is outside that is raised instead, so nothing goes missing.
      const roomy =
        inside(mx, my, CUT_MARGIN_MM) &&
        !inPocket(mx, my, CUT_MARGIN_MM) &&
        my >= rail + CUT_MARGIN_MM;
      const sinkable = inside(mx, my, CUT_MARGIN_MM) && !inWindow(mx, my, CUT_MARGIN_MM);
      if (sinkable) sinkableMask[i] = 1;
      if (fd && fd[i * 4 + 3] >= 128) {
        if (sinkable) {
          flush[i] = 1;
        } else if (my >= 0) {
          if (onFace && !inWindow(mx, my)) onFrame[i] = 1;
          else beyond[i] = 1;
          // Where a raised decoration is also, it stays raised.
          if (!(rd && rd[i * 4 + 3] >= 128)) flat[i] = 1;
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
      flat[i] = 0;
    }
  }

  // What fills a recess is the recess: the same pixels, traced once, so the fill
  // and the pocket it goes in share their vertices and meet without a gap or an
  // overlap.
  const colours = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const src = onFrame[i] || beyond[i] ? (rd && rd[i * 4 + 3] >= 128 ? rd : fd) : flush[i] ? fd : null;
    if (src) {
      colours[i * 4] = src[i * 4];
      colours[i * 4 + 1] = src[i * 4 + 1];
      colours[i * 4 + 2] = src[i * 4 + 2];
    }
  }
  closeDiagonals(flush, w, h);
  const flushBody = new Uint8Array(flush);

  const { group, groupFrac, groupColors } = groupRaised(onFrame, beyond, flushBody, colours, look);

  return {
    onFrame,
    beyond,
    cutOut,
    flush,
    flushBody,
    flat,
    sinkable: sinkableMask,
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

/**
 * Takes out every place where two pixels of a mask meet only at a corner.
 *
 * Traced, such a place is a point where the outline touches itself, or touches
 * another outline, and a face cannot be cut round a point that is two edges at
 * once. A pixel of the gap is filled, which joins the two squarely; one pixel,
 * a sixth of a millimetre, is nothing to the shape.
 */
function closeDiagonals(mask: Uint8Array, w: number, h: number) {
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let y = 0; y + 1 < h; y++) {
      for (let x = 0; x + 1 < w; x++) {
        const a = mask[y * w + x];
        const b = mask[y * w + x + 1];
        const c = mask[(y + 1) * w + x];
        const d = mask[(y + 1) * w + x + 1];
        if (a && d && !b && !c) {
          mask[y * w + x + 1] = 1;
          changed = true;
        } else if (b && c && !a && !d) {
          mask[y * w + x] = 1;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
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
  clearance = 0,
): Promise<{ relief: Relief; cuts: [number, number][][]; recess: Recess | null }> {
  const mask = await renderMask(decorations, geom, look);
  const flushRegions = traceFlush(mask);
  // Room for the fill: the pocket is traced from the shapes grown a pixel or two.
  const growPx = clearance > 0 ? Math.max(1, Math.round(clearance * MASK_PX_PER_MM)) : 0;
  const sunk = recessLoops(mask, growPx > 0 ? traceFlush(mask, growPx) : flushRegions);
  return {
    relief: buildRelief(mask, geom.frontZ, height, geom.lip, flushRegions),
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
      "violin", "drum", "trumpet", "saxophone", "musical-keyboard", "hamsa", "fire",
      "droplet", "rainbow", "cloud", "bullseye", "joystick", "game-die", "slot-machine",
      "chess-pawn", "puzzle-piece", "teddy-bear", "nesting-dolls", "magic-wand",
      "crystal-ball", "luggage", "compass", "sunglasses", "umbrella", "gem-stone",
      "artist-palette", "camera", "accordion", "banjo", "maracas", "long-drum",
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
      "love-letter", "ring", "gem-stone", "cherry-blossom", "comet", "cow-face", "pig-face",
      "frog", "monkey-face", "bird", "chicken", "duck", "parrot", "shark", "fish",
      "blowfish", "seal", "otter", "sloth", "raccoon", "bear", "wolf", "tiger-face",
      "leopard", "zebra", "potted-plant", "four-leaf-clover", "lotus", "rosette",
      "pine-decoration", "sheaf-of-rice", "wood", "rock", "tulip", "palm-tree",
      "tanabata-tree", "wilted-flower",
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
      "baguette-bread", "croissant", "pancakes", "waffle", "cheese-wedge", "egg", "cooking",
      "spaghetti", "sushi", "birthday-cake", "broccoli", "eggplant", "tomato", "potato",
      "onion", "cucumber", "leafy-green", "peanuts", "chestnut", "coconut", "kiwi-fruit",
      "mango", "melon", "blueberries", "pear", "green-apple", "pretzel", "sandwich",
      "burrito", "tamale", "dumpling", "fortune-cookie", "takeout-box", "bento-box",
      "curry-rice", "shaved-ice", "soft-ice-cream", "custard", "glass-of-milk", "mate",
      "bubble-tea", "beverage-box", "cup-with-straw", "salt", "butter", "bacon",
      "cut-of-meat", "poultry-leg", "meat-on-bone", "shallow-pan-of-food", "green-salad",
      "canned-food", "bowl-with-spoon", "fondue", "peach", "lemon", "grapes", "watermelon",
      "tangerine", "bagel", "flatbread", "falafel", "olive", "teapot", "hot-beverage",
      "sake", "tumbler-glass", "ice-cream", "candy", "chocolate-bar", "lollipop", "cupcake",
      "honey-pot", "spoon", "fork-and-knife", "chopsticks",
    ],
  },
  {
    id: "sports",
    label: "Sports",
    icons: [
      "volleyball", "american-football", "rugby-football", "ping-pong", "badminton",
      "goal-net", "flag-in-hole", "ice-hockey", "field-hockey", "cricket-game", "lacrosse",
      "bow-and-arrow", "sports-medal", "skis", "flying-disc", "stadium", "running-shoe",
      "wheel",
    ],
  },
  {
    id: "baby",
    label: "Baby & kids",
    icons: [
      "baby-bottle", "baby-chick", "baby-symbol", "footprints", "hatching-chick",
      "backpack", "school", "honeybee",
    ],
  },
  {
    id: "wedding",
    label: "Wedding & hearts",
    icons: [
      "wedding", "heart-on-fire", "heart-with-ribbon", "heart-decoration",
      "heart-exclamation", "heart-suit", "face-blowing-a-kiss", "smiling-face-with-hearts",
      "smiling-face-with-heart-eyes", "kissing-face", "kissing-face-with-closed-eyes",
      "top-hat", "dress", "high-heeled-shoe", "lipstick",
    ],
  },
  {
    id: "weather",
    label: "Weather & sky",
    icons: [
      "sun-behind-cloud", "sun-behind-large-cloud", "sun-behind-small-cloud",
      "sun-behind-rain-cloud", "cloud-with-rain", "cloud-with-lightning",
      "cloud-with-lightning-and-rain", "cloud-with-snow", "umbrella-with-rain-drops",
      "umbrella-on-ground", "tornado", "fog", "wind-face", "thermometer", "shooting-star",
      "milky-way", "ringed-planet", "night-with-stars", "new-moon-face",
      "first-quarter-moon-face", "sunrise-over-mountains", "cityscape-at-dusk",
    ],
  },
  {
    id: "school",
    label: "School & work",
    icons: [
      "pencil", "pen", "memo", "notebook", "notebook-with-decorative-cover",
      "straight-ruler", "triangular-ruler", "microscope", "test-tube", "atom-symbol",
      "briefcase", "chart-increasing", "calendar", "paperclip", "scissors",
      "magnifying-glass-tilted-left", "lab-coat", "glasses", "abacus", "classical-building",
    ],
  },
  {
    id: "winter",
    label: "Winter & Christmas",
    icons: [
      "scarf", "gloves", "coat", "socks", "ice", "skis", "cloud-with-snow", "candle",
      "lollipop", "cookie", "hot-beverage",
    ],
  },
  {
    id: "faith",
    label: "Faith",
    icons: [
      "prayer-beads", "red-paper-lantern", "crescent-moon", "star-of-david", "menorah",
      "wheel-of-dharma", "om", "yin-yang", "peace-symbol", "dango", "rice-ball",
      "steaming-bowl", "latin-cross", "orthodox-cross", "church", "dove",
      "place-of-worship", "candle", "ewe", "camel", "bell", "open-book", "books",
      "sparkles", "wedding", "christmas-tree", "star", "glowing-star", "palm-tree", "fish",
      "heart-on-fire", "sun-behind-cloud", "sunrise", "rainbow", "star-and-crescent",
      "mosque", "kaaba", "synagogue", "hindu-temple", "shinto-shrine", "nazar-amulet",
      "hamsa", "church",
    ],
  },
  {
    id: "vehicles",
    label: "Vehicles",
    icons: [
      "ambulance", "fire-engine", "police-car", "tractor", "delivery-truck", "helicopter",
      "parachute", "satellite", "flying-saucer", "speedboat", "canoe", "motorcycle",
      "racing-car", "oncoming-taxi", "tram", "monorail", "metro", "bullet-train",
      "oncoming-bus",
    ],
  },
  {
    id: "symbols",
    label: "Symbols",
    icons: [
      "hundred-points", "check-mark-button", "cross-mark", "collision", "dizzy",
      "speech-balloon", "thought-balloon", "zzz", "recycling-symbol", "fleur-de-lis",
      "trident-emblem", "red-circle", "blue-circle", "infinity", "triangular-flag",
      "heart-suit",
    ],
  },
  {
    id: "faces",
    label: "Faces",
    icons: [
      "grinning-face", "smiling-face-with-sunglasses", "smiling-face",
      "smiling-face-with-smiling-eyes", "smiling-face-with-halo", "smiling-face-with-horns",
      "star-struck", "winking-face", "partying-face", "nerd-face", "cowboy-hat-face",
      "pleading-face", "thinking-face", "face-with-tears-of-joy", "loudly-crying-face",
      "clown-face", "grinning-cat", "grinning-face-with-big-eyes",
      "winking-face-with-tongue",
    ],
  },
  {
    id: "fashion",
    label: "Fashion",
    icons: [
      "kimono", "bikini", "t-shirt", "jeans", "necktie", "billed-cap", "sunglasses",
      "goggles", "handbag", "purse", "dress", "socks", "top-hat", "running-shoe",
      "lipstick", "gem-stone",
    ],
  },
  {
    id: "home",
    label: "Home & tools",
    icons: [
      "hammer", "wrench", "gear", "toolbox", "nut-and-bolt", "brick", "houses",
      "house-with-garden", "door", "couch-and-lamp", "bed", "bathtub", "basket", "bucket",
      "sewing-needle", "thread", "yarn", "knot", "window", "hammer-and-wrench",
    ],
  },
  {
    id: "flags",
    label: "Flags",
    icons: [
      "chequered-flag", "triangular-flag", "crossed-flags", "white-flag", "black-flag",
      "rainbow-flag", "pirate-flag", "transgender-flag", "flag-turkey", "flag-azerbaijan",
      "flag-germany", "flag-united-kingdom", "flag-united-states", "flag-france",
      "flag-italy", "flag-netherlands", "flag-greece", "flag-russia", "flag-ukraine",
      "flag-japan", "flag-china", "flag-south-korea", "flag-india", "flag-brazil",
      "flag-argentina", "flag-canada", "flag-australia", "flag-saudi-arabia",
      "flag-pakistan", "flag-iran", "flag-egypt", "flag-switzerland", "flag-sweden",
      "flag-norway", "flag-denmark", "flag-finland", "flag-poland", "flag-portugal",
      "flag-ireland", "flag-belgium", "flag-austria", "flag-bulgaria", "flag-romania",
      "flag-hungary", "flag-czechia", "flag-slovakia", "flag-bosnia-and-herzegovina",
      "flag-albania", "flag-north-macedonia", "flag-georgia", "flag-kazakhstan",
      "flag-uzbekistan", "flag-south-africa", "flag-nigeria", "flag-morocco",
      "flag-tunisia", "flag-algeria", "flag-lebanon", "flag-jordan", "flag-iraq",
      "flag-united-arab-emirates", "flag-qatar", "flag-kuwait", "flag-libya", "flag-syria",
      "flag-palestine", "flag-kosovo", "flag-slovenia", "flag-lithuania", "flag-latvia",
      "flag-estonia", "flag-iceland", "flag-luxembourg", "flag-malta", "flag-thailand",
      "flag-vietnam", "flag-indonesia", "flag-malaysia", "flag-singapore",
      "flag-philippines", "flag-chile", "flag-colombia", "flag-peru", "flag-uruguay",
      "flag-cuba", "flag-new-zealand", "flag-israel", "flag-afghanistan", "flag-bangladesh",
      "flag-kyrgyzstan", "flag-belarus", "flag-moldova", "flag-armenia",
      "flag-european-union",
    ],
  },
  {
    id: "zodiac",
    label: "Zodiac",
    icons: [
      "aries", "taurus", "gemini", "cancer", "leo", "virgo", "libra", "scorpio",
      "sagittarius", "capricorn", "aquarius", "pisces", "ophiuchus",
    ],
  },
  {
    id: "animals",
    label: "More animals",
    icons: [
      "hamster", "mouse-face", "rat", "rabbit", "chipmunk", "bat", "polar-bear", "kangaroo",
      "llama", "bison", "ox", "water-buffalo", "boar", "deer", "moose", "goat", "ram",
      "donkey", "rhinoceros", "hippopotamus", "crocodile", "lizard", "snake", "t-rex",
      "sauropod", "eagle", "turkey", "rooster", "goose", "dodo", "feather", "mosquito",
      "ant", "beetle", "bug", "jellyfish", "squid", "lobster", "shrimp", "oyster",
      "spouting-whale", "beaver", "badger", "skunk", "orangutan", "gorilla", "monkey",
      "mouse", "poodle", "guide-dog", "cat-face", "dog-face", "horse-face", "tiger",
      "mammoth", "front-facing-baby-chick", "baby-chick", "hatching-chick", "pig", "cow",
      "fly", "worm", "cricket", "scorpion", "leopard", "camel",
    ],
  },
  {
    id: "science",
    label: "Science & space",
    icons: [
      "rocket", "ringed-planet", "satellite", "satellite-antenna", "telescope", "dna",
      "stethoscope", "syringe", "pill", "test-tube", "microscope", "atom-symbol",
      "flying-saucer", "alien", "milky-way", "shooting-star", "comet",
      "globe-showing-europe-africa", "globe-showing-americas",
      "globe-showing-asia-australia", "globe-with-meridians", "world-map", "magnet",
      "battery", "light-bulb", "alembic", "abacus", "compass", "hourglass-done",
      "crystal-ball", "brain", "adhesive-bandage", "thermometer", "x-ray", "bone", "tooth",
    ],
  },
  {
    id: "money",
    label: "Money & office",
    icons: [
      "bank", "coin", "credit-card", "dollar-banknote", "euro-banknote", "yen-banknote",
      "money-bag", "money-with-wings", "key", "locked", "locked-with-key", "package",
      "label", "bookmark", "envelope", "megaphone", "loudspeaker", "hourglass-done",
      "alarm-clock", "stopwatch", "watch", "keyboard", "computer-mouse", "printer",
      "file-folder", "clipboard", "pushpin", "link", "gem-stone", "trophy", "handshake",
      "light-bulb", "bullseye", "chart-increasing", "briefcase",
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
