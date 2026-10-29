import type { Decoration } from "./decor";

type Rect = { x0: number; x1: number; y0: number; y1: number };

/** What a template needs to know about the frame it is laid out on. */
export type TemplateGeom = {
  W: number;
  H: number;
  window: Rect;
  rail: number;
};

export type Template = {
  id: string;
  label: string;
  /** Lays the decorations out; `say` turns a greeting into the language in use. */
  build: (g: TemplateGeom, say: (greeting: string) => string) => Decoration[];
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Ready-made frames: a handful of decorations along the borders, to start from
 * and change. Sized and placed from the frame's own borders, so they sit well
 * whatever the picture's size.
 */
function layout(g: TemplateGeom) {
  const strip = g.H - g.window.y1; // the top border
  const icon = clamp(strip * 1.25, 8, 18);
  return {
    icon,
    topY: (g.window.y1 + g.H) / 2,
    bottomY: g.rail / 2 + 0.5,
    left: Math.max(icon * 0.7, g.window.x0 / 2),
    right: g.W - Math.max(icon * 0.7, g.window.x0 / 2),
    mid: g.W / 2,
    words: clamp(g.rail * 0.55, 4.5, 9),
  };
}

const icon = (name: string, x: number, y: number, size: number, rotation = 0): Decoration => ({
  icon: name,
  x,
  y,
  size,
  rotation,
});

const words = (text: string, x: number, y: number, size: number, color: string, font = "sans"): Decoration => ({
  icon: "",
  text,
  font,
  bold: true,
  color,
  x,
  y,
  size,
  rotation: 0,
});

export const TEMPLATES: Template[] = [
  {
    id: "birthday",
    label: "Birthday",
    build: (g, say) => {
      const l = layout(g);
      return [
        icon("balloon", l.left, l.topY, l.icon, -10),
        icon("cake", l.mid, l.topY, l.icon),
        icon("balloon", l.right, l.topY, l.icon, 10),
        icon("party-popper", l.left, l.bottomY, l.icon * 0.8),
        words(say("Happy Birthday!"), l.mid, l.bottomY, l.words, "#d9344a"),
        icon("party-popper", l.right, l.bottomY, l.icon * 0.8, 90),
      ];
    },
  },
  {
    id: "halloween",
    label: "Halloween",
    build: (g, say) => {
      const l = layout(g);
      return [
        icon("pumpkin", l.left, l.topY, l.icon),
        icon("bat", l.mid, l.topY, l.icon),
        icon("ghost", l.right, l.topY, l.icon),
        icon("spider-web", 0, g.H, l.icon * 1.8),
        words(say("Happy Halloween"), l.mid, l.bottomY, l.words, "#e07a1f", "display"),
      ];
    },
  },
  {
    id: "beach",
    label: "Beach",
    build: (g, say) => {
      const l = layout(g);
      return [
        icon("sun", l.left, l.topY, l.icon),
        icon("palm-tree", g.W - 6, g.H - 3, l.icon * 1.7),
        icon("seashell", l.left, l.bottomY, l.icon * 0.8),
        words(say("Summer Holiday"), l.mid, l.bottomY, l.words, "#1f7ea8"),
        icon("wave", l.right, l.bottomY, l.icon * 0.9),
      ];
    },
  },
  {
    id: "christmas",
    label: "Christmas",
    build: (g, say) => {
      const l = layout(g);
      return [
        icon("christmas-tree", l.left, l.topY, l.icon),
        icon("snowflake", l.mid, l.topY, l.icon),
        icon("gift", l.right, l.topY, l.icon),
        icon("bell", l.left, l.bottomY, l.icon * 0.8, -15),
        words(say("Merry Christmas"), l.mid, l.bottomY, l.words, "#b3202a", "serif"),
        icon("bell", l.right, l.bottomY, l.icon * 0.8, 15),
      ];
    },
  },
  {
    id: "love",
    label: "Love",
    build: (g, say) => {
      const l = layout(g);
      return [
        icon("heart", l.left, l.topY, l.icon),
        icon("heart", l.mid, l.topY, l.icon * 1.15),
        icon("heart", l.right, l.topY, l.icon),
        icon("rose", l.left, l.bottomY, l.icon * 0.85),
        words(say("Forever & Always"), l.mid, l.bottomY, l.words, "#c2185b", "script"),
        icon("rose", l.right, l.bottomY, l.icon * 0.85),
      ];
    },
  },
  {
    id: "republic",
    label: "Republic Day (TR)",
    build: (g) => {
      const l = layout(g);
      return [
        icon("star-and-crescent", l.mid, l.topY, l.icon * 1.1),
        icon("tulip", l.left, l.topY, l.icon * 0.9),
        icon("tulip", l.right, l.topY, l.icon * 0.9),
        words("29 Ekim Cumhuriyet Bayramı!", l.mid, l.bottomY, l.words, "#c8102e"),
      ];
    },
  },
];
