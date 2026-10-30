/**
 * What the home page shows that is not words in the interface: the photographs
 * and the models. Put the files in public/home/ and list them here; whatever is
 * listed but missing shows as a placeholder, and nothing breaks.
 */

/** Where to write to, for people who want more tokens. Empty hides the line. */
export const CONTACT_EMAIL = "";

/** Where the Lume series started. */
export const MAKERWORLD_URL = "https://makerworld.com/tr/models/2738020-lume-series-icosalume-dodecalume";

export type Showcase = { file: string; caption: string };

/** The photographs that slide across the top, in order. */
export const HERO_IMAGES: Showcase[] = [
  { file: "hero-1.jpg", caption: "" },
  { file: "hero-2.jpg", caption: "" },
  { file: "hero-3.jpg", caption: "" },
  { file: "hero-4.jpg", caption: "" },
  { file: "hero-5.jpg", caption: "" },
];

/** "Made with Litogen": real models, turned and zoomed in place. STL files in public/home/models/. */
export const SHOWCASE_MODELS: { file: string; caption: string; color?: string }[] = [
  { file: "models/frame-decorated.stl", caption: "Frame with decorations" },
  { file: "models/frame-hexagon.stl", caption: "Hexagon frame" },
  { file: "models/frame-curved.stl", caption: "Curved frame" },
  { file: "models/frame-circle.stl", caption: "Round frame" },
];

/**
 * Ready-made models: a picture that opens in the editor when clicked, as if it
 * had just been uploaded. The picture is both the thumbnail and what is loaded.
 */
export const MODELS: Showcase[] = [
  { file: "model-1.jpg", caption: "Model one" },
  { file: "model-2.jpg", caption: "Model two" },
  { file: "model-3.jpg", caption: "Model three" },
  { file: "model-4.jpg", caption: "Model four" },
];
