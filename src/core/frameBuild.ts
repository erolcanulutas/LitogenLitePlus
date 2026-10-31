import { writeColored3MF } from "./3mf_writer";
import { bendRadius } from "./bend";
import type { DecorGeom, Decoration, ReliefMode } from "./decor";
import {
  PICTURE_SEAT_MM,
  assembleHolder,
  buildHolder,
  holderForPrinting,
  holderLayout,
  holderStanding,
  legSpacingFor,
} from "./holder";
import type { Mesh } from "./mesh";
import { shapeOutline, type OutlineShape } from "./outline";
import { buildStand } from "./stand";
import { writeBinarySTL } from "./stl_writer";
import { makeDecor } from "../ui/decorIcons";

/**
 * Everything a frame and its candle stand are made from, apart from the picture
 * itself: so a frame can be built again from what was kept, without the picture.
 */
export type FrameInputs = {
  shape: string;
  /** The picture's width and height in mm, and its thickness. */
  width: number;
  height: number;
  thickness: number;
  /** Arc the picture is wrapped through, in degrees, or 0 for flat. */
  curveDeg: number;
  /** Panel angle, 45 to 90. */
  angle: number;
  border: number;
  corner: number;
  fit: number;
  play: number;
  tealight: number;
  relief: number;
  reliefMode: ReliefMode;
  flushClearance: number;
  iconColours: number;
  frameColour: string;
  pose: "face" | "standing";
  decorations: Decoration[];
  /** The filaments ticked in the account, which icon colours are snapped to. */
  palette: string[];
};

const lipFor = (border: number) => Math.min(4, Math.max(2, +(border * 0.3).toFixed(1)));

/** The frame's parameters and layout: the same numbers the studio's preview is built from. */
export function frameSetup(i: FrameInputs) {
  const outline = i.shape === "rectangle" ? null : shapeOutline(i.shape as OutlineShape, i.width, i.height);
  const pictureRadius = i.curveDeg > 0 ? bendRadius(i.width, i.curveDeg) : 0;
  const frameRadius = pictureRadius > PICTURE_SEAT_MM + 5 ? pictureRadius - PICTURE_SEAT_MM : 0;
  const base = {
    pictureW: frameRadius > 0 ? i.width * (frameRadius / pictureRadius) : i.width,
    pictureH: i.height,
    pictureT: i.thickness,
    border: i.border,
    lip: lipFor(i.border),
    fit: i.fit,
    pocketPlay: i.play,
    tiltDeg: 90 - i.angle,
    corner: i.corner,
    outline,
    bend: frameRadius,
  };
  let lean = base.tiltDeg;
  if (frameRadius > 0) {
    while (lean > 0 && !holderLayout({ ...base, tiltDeg: lean }).shearOk) lean -= 1;
  }
  const leaned = { ...base, tiltDeg: lean };
  const legSpacing = legSpacingFor(outline, leaned);
  const params = { ...leaned, prongSpacing: legSpacing };
  const L = holderLayout(params);
  const geom: DecorGeom = {
    W: L.W, H: L.H, corner: L.corner, window: L.window, pocket: L.pocket, rail: L.rail,
    frontZ: L.T, lip: L.T - L.pocketDepth, poly: L.poly,
    squeeze: L.bend > 0 ? L.bend / (L.bend + L.T) : 1,
  };
  return { params, L, geom, legSpacing };
}

/** A short fingerprint of a design: what it is made of, not how it was asked for. */
export async function designFingerprint(positions: Float32Array, extra: string): Promise<string> {
  const tail = new TextEncoder().encode(extra);
  const head = new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength);
  const all = new Uint8Array(head.length + tail.length);
  all.set(head, 0);
  all.set(tail, head.length);
  const digest = await crypto.subtle.digest("SHA-256", all);
  return Array.from(new Uint8Array(digest).slice(0, 16))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The frame as a file: a 3MF with a body for each colour when the icons are
 * printed in their own, an STL otherwise. `ref` says which design it is, apart
 * from the pose it is laid in, so the same frame downloaded again is known.
 */
export async function exportFrame(i: FrameInputs): Promise<{ file: ArrayBuffer; extension: "stl" | "3mf"; ref: string; name: string }> {
  const { params, geom } = frameSetup(i);
  let whole: Mesh;
  let bodies: { start: number; color: string }[] = [];
  if (i.decorations.length > 0) {
    const made = await makeDecor(i.decorations, geom, i.relief, {
      mode: i.reliefMode,
      colours: i.iconColours,
      palette: i.palette,
    }, i.flushClearance);
    const built = assembleHolder(params, made.cuts, made.recess, made.relief);
    whole = built.mesh;
    bodies = built.bodies.map((g) => ({ start: g.start, color: g.color || i.frameColour }));
  } else {
    whole = buildHolder(params);
  }
  const out = i.pose === "standing" ? holderStanding(whole, params.tiltDeg) : holderForPrinting(whole);
  const ref = await designFingerprint(
    whole.positions.subarray(0, whole.triangleCount * 9),
    `${i.iconColours > 0 && bodies.length > 0 ? "3mf" : "stl"}|${i.frameColour}|${bodies.map((b) => b.color).join(",")}`,
  );
  if (i.iconColours > 0 && bodies.length > 0) {
    const file = await writeColored3MF(
      { positions: out.positions, triangleCount: out.triangleCount, bandStarts: [0, ...bodies.map((b) => b.start)] },
      [i.frameColour, ...bodies.map((b) => b.color)],
    );
    return { file, extension: "3mf", ref, name: `litogen-frame-${i.angle}deg.3mf` };
  }
  return { file: writeBinarySTL(out), extension: "stl", ref, name: `litogen-frame-${i.angle}deg.stl` };
}

/** The candle stand that goes with a frame: its prongs are as far apart as that frame's legs. */
export function exportStand(i: FrameInputs): { file: ArrayBuffer; name: string } {
  const { legSpacing } = frameSetup(i);
  return { file: writeBinarySTL(buildStand({ tealight: i.tealight, prongSpacing: legSpacing })), name: "litogen-candle-stand.stl" };
}
