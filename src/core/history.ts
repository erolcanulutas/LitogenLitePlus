import type { FrameInputs } from "./frameBuild";

/**
 * What the studio keeps of a piece of work, so it can be come back to: the
 * settings of the picture's model, the image editor's crop and paint, and the
 * frame with its candle stand. Never the picture itself: it has to be loaded
 * again, and a fingerprint of the file says whether it is the same one.
 */
export type EditorSnapshot = {
  crop: { cx: number; cy: number; w: number; rot: number };
  viewScale: number;
  /** What was painted on the picture, as a PNG of the paint layer alone, or null. */
  paint: string | null;
};

export type StudioSnapshot = {
  shapeId: string;
  widthMm: number;
  minT: number;
  maxT: number;
  frameMm: number;
  layerHeight: number;
  curved: boolean;
  curveDeg: number;
  orientation: string;
  graphic: boolean;
  inlayMode: boolean;
  toneLevels: number;
  toneCuts: number[];
  colors: string[];
  splitLayers: number[];
  quality: string;
  smoothing: number;
  vector: boolean;
  baseLayers: number;
  pictureLayers: number;
  colorGap: number;
  bgColor: string;
  rotate: number;
  flipH: boolean;
  flipV: boolean;
  boxRatio: number;
};

export type HistoryEntry = {
  id: string;
  at: number;
  /** The picture's file name, for telling entries apart. */
  name: string;
  /** SHA-256 of the picture file, and its size: what says it is the same picture. */
  fileHash: string;
  fileSize: number;
  studio: StudioSnapshot;
  editor: EditorSnapshot | null;
  frame: FrameInputs;
};

const KEY = "litogen.history";
const LIMIT = 30;

export function readHistory(): HistoryEntry[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Keeps the newest entries; when storage is full, drops the oldest until it fits. */
export function writeHistory(list: HistoryEntry[]): HistoryEntry[] {
  let kept = list.slice(0, LIMIT);
  for (;;) {
    try {
      localStorage.setItem(KEY, JSON.stringify(kept));
      return kept;
    } catch {
      if (kept.length <= 1) return kept;
      kept = kept.slice(0, kept.length - 1);
    }
  }
}

/** The fingerprint of a file's bytes: the same file gives the same one, whatever it is called. */
export async function hashFile(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** A short key for a piece of work: the picture and every setting. */
export async function entryId(fileHash: string, studio: StudioSnapshot, frame: FrameInputs): Promise<string> {
  const bytes = new TextEncoder().encode(fileHash + JSON.stringify(studio) + JSON.stringify(frame));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest).slice(0, 10))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
