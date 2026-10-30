/**
 * What the home page shows that is not words in the interface: the photographs
 * and the models. Put the files in public/home/ and list them here; whatever is
 * listed but missing shows as a placeholder, and nothing breaks.
 */

/** Where to write to, for people who want more tokens. Empty hides the line. */
export const CONTACT_EMAIL = "";

export type Showcase = { file: string; caption: string };

/** The picture at the top. */
export const HERO_IMAGE = "hero.jpg";

/** "Made with Litogen": prints, lit and unlit. */
export const GALLERY: Showcase[] = [
  { file: "gallery-1.jpg", caption: "Lithophane in a frame" },
  { file: "gallery-2.jpg", caption: "Lit from behind" },
  { file: "gallery-3.jpg", caption: "Layered logo" },
  { file: "gallery-4.jpg", caption: "Inlay in colour" },
  { file: "gallery-5.jpg", caption: "Curved lamp" },
  { file: "gallery-6.jpg", caption: "Frame with decorations" },
];

/** Ready-made models to start from. */
export const MODELS: Showcase[] = [
  { file: "model-1.jpg", caption: "Model one" },
  { file: "model-2.jpg", caption: "Model two" },
  { file: "model-3.jpg", caption: "Model three" },
];
