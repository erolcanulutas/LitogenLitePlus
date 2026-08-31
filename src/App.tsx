import React, { useMemo, useRef, useState, useEffect } from "react";
import ImageEditor from "./ui/ImageEditor";
import type { ImageEditorHandle, Tool } from "./ui/ImageEditor";

import ImageControls from "./ui/ImageControls";
import BandSlider from "./ui/BandSlider";
import ColorField from "./ui/ColorField";
import type { PreviewMesh } from "./ui/MeshPreview";

// three.js is most of the bundle, and plenty of sessions never open the 3D
// tab, so it is fetched on first use rather than on page load.
const MeshPreview = React.lazy(() => import("./ui/MeshPreview"));
import { SHAPES } from "./shapes";
import STLWorker from "./worker/stl.worker?worker";
import type { Quality } from "./core/quality";
import type { ShapeId } from "./core/types";
import { suggestToneLevels } from "./core/tones";
import { signIn, signOut, signUp, whoAmI, type Account } from "./core/account";
import { drawGoogleButton, signInOutcome } from "./core/google";

/* -------------------------------------------------------------
 * BRAND FONT & STYLES
 * ------------------------------------------------------------- */
const BRAND_STYLE = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@500;700;800&display=swap');

body {
  font-family: 'Outfit', sans-serif;
  margin: 0;
  overflow: hidden; 
  background-color: #020617;
  color: #f8fafc;
}

.appShell {
  display: flex;
  height: 100vh;
  width: 100vw;
  padding: 16px;
  gap: 16px;
  box-sizing: border-box;
}

.brandRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.googleSlot {
  display: flex;
  justify-content: center;
  min-height: 44px;
  margin-bottom: 4px;
}

.orRule {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 14px 0;
  color: #64748b;
  font-size: 12px;
}

.orRule::before,
.orRule::after {
  content: "";
  flex: 1;
  height: 1px;
  background: #1e293b;
}

.accountError {
  margin-top: 10px;
  padding: 7px 10px;
  font-size: 12px;
  color: #fecaca;
  background: rgba(190, 18, 60, 0.18);
  border: 1px solid rgba(244, 63, 94, 0.35);
  border-radius: 8px;
}

.brand-title {
  font-family: 'Outfit', sans-serif;
  font-weight: 800;
  font-size: 24px;
  background: linear-gradient(135deg, #fff 0%, #a5f3fc 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.leftPanel {
  width: 340px;
  min-width: 340px;
  height: 100%;
  background: #0f172a;
  border: 1px solid #1e293b;
  border-radius: 16px;
  padding: 16px;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  scrollbar-width: thin;
}

.rightPanel {
  flex: 1;
  height: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.section {
  padding: 12px 0;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}

.label-row {
  display: flex;
  justify-content: space-between; 
  align-items: center;
  margin-bottom: 6px;
  height: 20px;
}

.info-icon-wrapper {
  position: relative;
  display: inline-flex;
}

.info-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  font-size: 11px;
  font-weight: bold;
  color: #64748b;
  border: 1px solid #334155;
  border-radius: 50%;
  cursor: help;
  transition: all 0.2s;
  background: rgba(255,255,255,0.02);
}

.info-icon:hover {
  color: #a5f3fc;
  border-color: #a5f3fc;
  background: rgba(165, 243, 252, 0.1);
}

.tooltip-content {
  visibility: hidden;
  width: 200px;
  background-color: #1e293b;
  color: #cbd5e1;
  text-align: center;
  border-radius: 6px;
  padding: 8px;
  position: absolute;
  z-index: 50;
  bottom: 135%;
  right: -10px;
  opacity: 0;
  transition: opacity 0.2s;
  font-size: 0.75rem;
  font-weight: 500;
  border: 1px solid #334155;
  box-shadow: 0 4px 12px rgba(0,0,0,0.5);
  pointer-events: none;
}

.tooltip-content::after {
  content: "";
  position: absolute;
  top: 100%;
  right: 14px;
  margin-left: -5px;
  border-width: 5px;
  border-style: solid;
  border-color: #334155 transparent transparent transparent;
}

.info-icon-wrapper:hover .tooltip-content {
  visibility: visible;
  opacity: 1;
}

.previewHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.viewTabs {
  display: flex;
  gap: 4px;
}

.viewTab {
  background: transparent;
  border: 1px solid transparent;
  color: #64748b;
  font-family: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.viewTab:hover { color: #cbd5e1; }

.viewTab.active {
  color: #a5f3fc;
  border-color: #1e293b;
  background: rgba(165, 243, 252, 0.08);
}

.shadeToggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  color: #64748b;
  cursor: pointer;
  user-select: none;
}

.staleChip {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #fbbf24;
  border: 1px solid rgba(251, 191, 36, 0.4);
  background: rgba(251, 191, 36, 0.12);
  border-radius: 999px;
  padding: 3px 9px;
}

.staleBanner {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  max-width: 90%;
  padding: 8px 14px;
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.92);
  border: 1px solid rgba(251, 191, 36, 0.35);
  color: #fde68a;
  font-size: 0.78rem;
  text-align: center;
  pointer-events: none;
}

.preview-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 24px;
  color: #475569;
  font-size: 0.85rem;
  pointer-events: none;
}

.segmented {
  display: flex;
  gap: 4px;
  background: #0f172a;
  border: 1px solid #1e293b;
  border-radius: 8px;
  padding: 3px;
}

.segment {
  flex: 1;
  background: transparent;
  border: none;
  color: #64748b;
  font-family: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  padding: 7px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.segment:hover { color: #cbd5e1; }

.segment.active {
  color: #0f172a;
  background: #a5f3fc;
}

.modalBackdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(2, 6, 23, 0.72);
  backdrop-filter: blur(2px);
}

.modalCard {
  width: 100%;
  max-width: 420px;
  background: #0f172a;
  border: 1px solid #1e293b;
  border-radius: 14px;
  padding: 22px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
}

.modalTitle {
  font-size: 1.05rem;
  font-weight: 800;
  color: #f8fafc;
  margin-bottom: 10px;
}

.modalBody {
  margin: 0 0 18px;
  font-size: 0.85rem;
  line-height: 1.55;
  color: #94a3b8;
}

.modalActions {
  display: grid;
  gap: 8px;
}

.linkBtn {
  display: block;
  width: 100%;
  margin-top: 14px;
  background: none;
  border: none;
  color: #475569;
  font-family: inherit;
  font-size: 0.75rem;
  cursor: pointer;
  text-decoration: underline;
}

.linkBtn:hover { color: #94a3b8; }

.bandSwatch {
  width: 34px;
  height: 30px;
  padding: 2px;
  border: 1px solid #334155;
  border-radius: 6px;
  background: #1e293b;
  cursor: pointer;
  flex: none;
}

.bandSlider {
  user-select: none;
  -webkit-user-select: none;
}

.bandTrack {
  position: relative;
  width: 100%;
  height: 240px;
  border: 1px solid #334155;
  border-radius: 10px;
  overflow: hidden;
  background: #0b1220;
}

.bandSeg {
  position: absolute;
  left: 0;
  right: 0;
}

.inlayColors {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(72px, 1fr));
  gap: 8px;
  margin-bottom: 4px;
}

.inlayColor {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  opacity: 0.85;
  cursor: pointer;
}

.inlayColor input[type="color"] {
  width: 100%;
  height: 30px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}

.checkRow {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  font-size: 12px;
  cursor: pointer;
  user-select: none;
}

.paintSwatch {
  width: 26px;
  height: 22px;
  padding: 0;
  border: 1px solid #334155;
  border-radius: 5px;
  background: transparent;
  cursor: pointer;
}

.paintRange {
  width: 90px;
}

.paintBar {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  padding: 8px 10px;
  margin-bottom: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  background: #ffffff08;
}

.toolRow {
  display: flex;
  gap: 4px;
}

/*
 * A segment normally lives inside a .segmented, which is where its background
 * and border come from; on the toolbar there is no such box round them, so
 * they were reading as bare words. Faint enough to stay out of the way, solid
 * enough to look like something you press.
 */
.toolBtn {
  flex: 0 0 auto;
  padding: 4px 8px;
  font-size: 11px;
  min-width: 0;
  color: #94a3b8;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 7px;
}

.toolBtn:hover {
  color: #cbd5e1;
  background: rgba(255, 255, 255, 0.09);
  border-color: rgba(255, 255, 255, 0.2);
}

.toolBtn.active {
  color: #0f172a;
  background: #a5f3fc;
  border-color: #a5f3fc;
}

/* Fixed slots, so picking a tool greys controls out rather than moving them. */
.paintSet {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #cbd5e1;
}

.paintSet:has(input:disabled),
.paintSet:has(button:disabled),
.paintFont:disabled,
.paintText:disabled {
  opacity: 0.35;
}

.paintTag {
  width: 38px;
  text-align: right;
  user-select: none;
}

.paintRange {
  width: 70px;
}

.paintFont {
  width: 128px;
  padding: 4px 6px;
  font-size: 11px;
}

.textBoxWrap {
  position: absolute;
  transform-origin: 0 0;
  z-index: 20;
}

.textBox {
  min-width: 90px;
  min-height: 34px;
  width: 260px;
  height: 74px;
  /* No padding and no border: the box the text wraps to on the canvas is this
     box, so anything inset here would make the two disagree. The dashed edge
     is an outline, which sits outside the layout. */
  padding: 0;
  border: none;
  outline: 1px dashed rgba(255, 255, 255, 0.85);
  background: rgba(0, 0, 0, 0.22);
  border-radius: 0;
  resize: both;
  overflow: hidden;
  line-height: 1.2;
}

.textBox::placeholder {
  color: rgba(255, 255, 255, 0.45);
}

.textBoxBar {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}

.colorDrop {
  margin-left: 6px;
  padding: 4px 8px;
  font-size: 13px;
  line-height: 1;
  color: #fff;
  background: #ffffff12;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 8px;
  cursor: pointer;
}

.colorRow {
  display: flex;
  align-items: center;
}

/*
 * Hung over the bar rather than set into it: a notice that comes and goes
 * cannot take up room in a row that is already full, or everything after it
 * jumps down a line the moment it appears.
 */
.paintArmed {
  position: absolute;
  bottom: calc(100% + 7px);
  left: 12px;
  z-index: 30;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  color: #0b1220;
  background: #7dd3fc;
  border-radius: 7px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
}

.paintArmed::after {
  content: "";
  position: absolute;
  top: 100%;
  left: 16px;
  border: 6px solid transparent;
  border-top-color: #7dd3fc;
  border-bottom: 0;
}

.paintText {
  width: 190px;
  padding: 5px 8px;
  font-size: 12px;
  color: #fff;
  background: #00000040;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  outline: none;
}

.paintEnd {
  display: flex;
  gap: 6px;
}

/* Between groups: drawing and its settings, then text and its settings, then
   what can be done to what is already down. */
.paintDiv {
  width: 1px;
  align-self: stretch;
  min-height: 22px;
  margin: 0 2px;
  background: rgba(255, 255, 255, 0.16);
}

.colorField {
  position: relative;
  display: inline-flex;
}

.colorPop {
  position: fixed;
  z-index: 60;
  width: 208px;
  padding: 10px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 10px;
  background: #0b1220;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.55);
}

.colorSquare {
  position: relative;
  width: 188px;
  height: 122px;
  border-radius: 6px;
  cursor: crosshair;
  touch-action: none;
}

.colorSquareWhite,
.colorSquareBlack {
  position: absolute;
  inset: 0;
  border-radius: 6px;
}

.colorSquareWhite {
  background: linear-gradient(to right, #fff, transparent);
}

.colorSquareBlack {
  background: linear-gradient(to top, #000, transparent);
}

.colorDot {
  position: absolute;
  width: 11px;
  height: 11px;
  margin: -6px 0 0 -6px;
  border: 2px solid #fff;
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6);
  pointer-events: none;
}

.colorHue {
  width: 188px;
  margin: 10px 0 8px;
  appearance: none;
  height: 12px;
  border-radius: 6px;
  background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
}

.colorHue::-webkit-slider-thumb {
  appearance: none;
  width: 12px;
  height: 16px;
  border: 2px solid #fff;
  border-radius: 3px;
  background: transparent;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6);
  cursor: pointer;
}

.colorHex {
  width: 100%;
  padding: 5px 8px;
  font-size: 12px;
  color: #fff;
  background: #00000040;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  outline: none;
}

.colorPresets {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 4px;
  margin-top: 8px;
}

.colorPreset {
  height: 18px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 4px;
  cursor: pointer;
}

.checkRow input[type="checkbox"] {
  width: 15px;
  height: 15px;
  accent-color: #4ea1c9;
  cursor: pointer;
  margin: 0;
}

.bandSegPick {
  display: block;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  -webkit-appearance: none;
  appearance: none;
  opacity: 0;
  cursor: pointer;
}

.bandKnob {
  position: absolute;
  left: 0;
  right: 0;
  height: 0;
  z-index: 2;
  pointer-events: none;
}

/*
 * The grab area keeps to the right of the track so it never contends with a
 * tone mark at the same height, and it is where the readout and the remove
 * button live.
 */
.bandKnobGrab {
  position: absolute;
  left: 48%;
  right: 0;
  top: -11px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  padding-right: 6px;
  pointer-events: auto;
  cursor: ns-resize;
  touch-action: none;
}

.bandKnob::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 2px;
  margin-top: -1px;
  background: #f8fafc;
  box-shadow: 0 0 0 1px rgba(2, 6, 23, 0.55);
}

.bandKnobGrab:focus-visible { outline: none; }
.bandKnob:has(.bandKnobGrab:focus-visible)::before { background: #a5f3fc; }

.bandKnobPill {
  position: relative;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid #475569;
  background: rgba(2, 6, 23, 0.9);
  color: #e2e8f0;
  font-size: 0.62rem;
  font-weight: 600;
  white-space: nowrap;
  pointer-events: none;
}

.bandKnobDrop {
  position: relative;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 1px solid #475569;
  border-radius: 50%;
  background: rgba(2, 6, 23, 0.9);
  color: #cbd5e1;
  font-family: inherit;
  font-size: 0.7rem;
  line-height: 1;
  cursor: pointer;
}

.bandKnobDrop:hover {
  color: #fca5a5;
  border-color: #7f1d1d;
  background: rgba(127, 29, 29, 0.9);
}

/*
 * Tones, down the left in dashed amber so they read as a different kind of
 * thing from the colour boundaries: one is where the surface stops, the other
 * is where the filament changes.
 */
/*
 * Above the boundary line, because the two coincide by default: a new band is
 * placed on a tone. Amber dash to the left of a white line across the rest is
 * what a boundary sitting where it should looks like.
 */
.toneMark {
  position: absolute;
  left: 0;
  width: 46%;
  height: 20px;
  margin-bottom: -10px;
  z-index: 3;
  display: flex;
  align-items: center;
  padding-left: 6px;
  cursor: ns-resize;
  touch-action: none;
}

/*
 * The label first and only a short dash after it, so a tone reads as a mark
 * at a height. Drawn as a rule across the track it read as a divider, and
 * four of them looked like they cut the track into five.
 */
.toneMarkRule {
  flex: 1;
  margin-left: 6px;
  border-top: 2px dashed #fbbf24;
}

.toneMark:focus-visible { outline: none; }
.toneMark:focus-visible .toneMarkRule { border-top-color: #a5f3fc; }
.toneMark:focus-visible .toneMarkPill { border-color: #a5f3fc; }

.toneMarkPill {
  position: relative;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid rgba(251, 191, 36, 0.55);
  background: rgba(2, 6, 23, 0.9);
  color: #fde68a;
  font-size: 0.6rem;
  font-weight: 600;
  white-space: nowrap;
  pointer-events: none;
}

/* A band nothing reaches, hatched so it reads as unreachable, not just dark. */
.bandSegBuried::before {
  content: "";
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    -45deg,
    rgba(2, 6, 23, 0.55) 0 5px,
    rgba(2, 6, 23, 0) 5px 10px
  );
  pointer-events: none;
}

.bandWarn {
  margin-top: 6px;
  font-size: 0.7rem;
  line-height: 1.45;
  color: #fbbf24;
}

.autoBtn {
  padding: 2px 9px;
  border-radius: 999px;
  border: 1px solid #334155;
  background: rgba(255, 255, 255, 0.02);
  color: #94a3b8;
  font-family: inherit;
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: all 0.15s ease;
}

.autoBtn:hover:not(:disabled) {
  color: #a5f3fc;
  border-color: #a5f3fc;
  background: rgba(165, 243, 252, 0.1);
}

.autoBtn:disabled { opacity: 0.4; cursor: default; }

.bandEnd {
  font-size: 0.66rem;
  color: #475569;
  margin: 4px 2px 0;
}

.bandEndTop { margin: 0 2px 4px; }

/* Named, and tinted with the tones, because it is one of the same heights. */
.bandEndFrame { color: #b08a3c; }

.bandHint {
  margin-top: 6px;
  font-size: 0.7rem;
  color: #475569;
}

.build-tag {
  font-size: 0.65rem;
  font-weight: 500;
  color: #64748b;
  letter-spacing: 0.02em;
  margin-top: 2px;
  user-select: all;
  cursor: text;
}

.leftPanel::-webkit-scrollbar { width: 4px; }
.leftPanel::-webkit-scrollbar-thumb { background: #334155; border-radius: 10px; }

.dynamic-footer {
  padding-top: 20px;
  color: #64748b;
  font-size: 0.7rem;
  text-align: center;
  opacity: 0.6;
  margin-top: auto; 
}

.custom-file-upload {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  height: 44px;
  padding: 0 12px;
  cursor: pointer;
  background-color: #1e293b;
  border: 1px dashed #475569;
  border-radius: 8px;
  color: #cbd5e1;
  font-size: 0.9rem;
  font-weight: 500;
  transition: all 0.2s ease;
  white-space: nowrap;
  overflow: hidden;
}

.custom-file-upload:hover {
  background-color: #334155;
  border-color: #94a3b8;
  color: #fff;
}

.custom-file-upload.drag-active {
  background-color: rgba(6, 182, 212, 0.15);
  border-color: #06b6d4;
  color: #fff;
}

.primaryBtn {
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.primaryBtn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(6, 182, 212, 0.2);
}

.status-msg {
  margin-top: 8px;
  font-size: 0.8rem;
  text-align: center;
  min-height: 1.2em;
}

.status-error { color: #ef4444; }
.status-success { color: #10b981; }
`;

const InfoIcon = ({ text }: { text: string }) => (
  <div className="info-icon-wrapper">
    <span className="info-icon">?</span>
    <span className="tooltip-content">{text}</span>
  </div>
);

const FOOTER_MESSAGES = [
  "Made with ❤️ by Erol Can Ulutaş",
  "Made with ❤️ by Erol Can Ulutaş",
  "Made with ❤️ by Erol Can Ulutaş",
  "Turn your memories into light.",
  "IcosaLume: The Geometry of Light.",
  "Ready for your 3D Printer.",
  "Precision lithophane generation.",
  "Bring your photos to life.",
  "Crafting light with IcosaLume.",
  "Shadows that tell a story.",
  "Layer by layer perfection.",
  "From pixels to plastic.",
  "Illuminate your world.",
  "Geometry meets photography.",
  "Your memories, set in plastic.",
  "Designed for makers.",
  "The art of hidden light.",
  "Create something unique today.",
  "Just slice and print.",
  "Polygons of light.",
  "Simply IcosaLume.",
  "Light up the room.",
  "Create something beautiful.",
  "Slice. Print. Illuminate.",
  "Shadows that tell a story.",
  "A new dimension for your photos.",
  "Infinite details in every layer.",
  "Make it permanent.",
  "The perfect personalized gift.",
  "See your memories glow.",
  "Tangible nostalgia.",
  "Where technology meets nostalgia.",
];

/**
 * Cheap content fingerprint for the editor's output.
 *
 * The editor re-emits on every redraw, including ones that change nothing —
 * a panel resize, say. Comparing content rather than identity keeps the
 * preview from claiming to be out of date when the picture is unchanged.
 */
function imageSignature(d: ImageData): string {
  const a = d.data;
  let hash = 0x811c9dc5;
  // A few thousand samples is ample to tell one crop from another.
  const step = Math.max(4, ((a.length / 4000) | 0) & ~3);
  for (let i = 0; i < a.length; i += step) {
    hash = Math.imul(hash ^ a[i], 0x01000193) >>> 0;
  }
  return `${d.width}x${d.height}:${hash.toString(16)}`;
}

/** What a drag in the editor does. The frame is one of them. */
const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: "crop", label: "Crop", hint: "Move, resize and rotate the frame around the picture." },
  { id: "brush", label: "Brush", hint: "Draw freehand. White prints thin, dark prints thick." },
  { id: "erase", label: "Erase", hint: "Rub paint off again — the picture underneath comes back." },
  { id: "line", label: "Line", hint: "Drag out a straight line." },
  { id: "rect", label: "Box", hint: "Drag out a filled rectangle." },
  { id: "ellipse", label: "Oval", hint: "Drag out a filled ellipse." },
  { id: "fill", label: "Fill", hint: "Flood everything of a near enough colour, from wherever you click." },
];

/** Text sits with its own settings rather than in the row of drawing tools. */
const TEXT_TOOL = {
  id: "text" as Tool,
  label: "Text",
  hint: "Click, type, Ctrl+Enter. It then sits there as a box you can drag, resize and restyle until you move on; double-click it to retype.",
};

/**
 * Typefaces for the text tool.
 *
 * All of them ship with Windows apart from Outfit, which the page already
 * loads for its own headings — so the list costs nothing to offer and every
 * name in it draws as itself in the dropdown.
 */
const FONTS = [
  "Outfit", "Arial", "Arial Black", "Impact", "Segoe UI", "Tahoma", "Verdana",
  "Trebuchet MS", "Georgia", "Times New Roman", "Palatino Linotype", "Garamond",
  "Cambria", "Constantia", "Corbel", "Candara", "Franklin Gothic Medium",
  "Century Gothic", "Courier New", "Consolas", "Lucida Console",
  "Comic Sans MS", "Segoe Script", "Segoe Print", "Ink Free", "Bahnschrift",
];

const FLAT_HINT_KEY = "litogen.hideFlatHint";

/** Step the editor's rotation lands on while snapping is switched on. */
const ROTATION_SNAP_DEG = 10;

/**
 * How much narrower an upright model is built than the width that was asked
 * for.
 *
 * Standing up, the width runs across the bed, where an extrusion is laid to
 * the outside of the path and the first layers spread under their own weight.
 * The part comes out a few tenths over and stops dropping into its frame.
 * Lying flat the same dimension runs up the build axis, where layers land on
 * their nominal height, so nothing is taken off there.
 */
const VERTICAL_TRIM_MM = 0.5;

/** Default palette for new bands: light at the bottom, darker going up. */
const BAND_PALETTE = [
  "#f2f2f2", "#1f2937", "#b91c1c", "#1d4ed8",
  "#047857", "#b45309", "#6d28d9", "#0f172a",
];

function downloadArrayBuffer(buf: ArrayBuffer, filename: string) {
  const blob = new Blob([buf], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * What a picture is standing on, read off its own edge.
 *
 * Whatever fills the corners of the crop has to be some colour, and the only
 * answer that is ever right is the one the picture already uses behind itself.
 * White was the default and is wrong for most logos — this one sits on black,
 * so every uncovered corner came out as a bright square unless it was set by
 * hand.
 *
 * The edge is where to look. A picture drawn on a backdrop carries it all the
 * way to its border, so the most common colour around the outside is the
 * backdrop; a photograph has no single one and the vote comes out split, which
 * is why a clear majority is asked for before the answer is used at all.
 */
function edgeColorOf(img: HTMLImageElement): string | null {
  const w = Math.min(256, img.naturalWidth || img.width);
  const h = Math.min(256, img.naturalHeight || img.height);
  if (w < 4 || h < 4) return null;

  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);

  let d: Uint8ClampedArray;
  try {
    d = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return null;
  }

  // Counted coarsely, so an edge that is not perfectly flat still agrees with
  // itself. One bucket per 16 levels is far finer than any eye needs and far
  // coarser than the noise in a border.
  const bin = new Map<number, { n: number; r: number; g: number; b: number }>();
  let total = 0;

  const take = (x: number, y: number) => {
    const o = (y * w + x) * 4;
    if (d[o + 3] < 128) return;
    const key =
      ((d[o] >> 4) << 8) | ((d[o + 1] >> 4) << 4) | (d[o + 2] >> 4);
    const e = bin.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++;
    e.r += d[o];
    e.g += d[o + 1];
    e.b += d[o + 2];
    bin.set(key, e);
    total++;
  };

  for (let x = 0; x < w; x++) {
    take(x, 0);
    take(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    take(0, y);
    take(w - 1, y);
  }

  if (total === 0) return null;

  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const e of bin.values()) if (!best || e.n > best.n) best = e;
  if (!best || best.n / total < 0.6) return null;

  const hex = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v / best!.n)))
      .toString(16)
      .padStart(2, "0");
  return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`;
}

export default function App() {
  /**
   * Who is signed in, if anyone.
   *
   * Asked once on load and kept from then on. Nothing is gated on it yet — it
   * is the account the paid shapes will eventually be attached to — so a
   * server that cannot be reached costs nothing but a signed-out header.
   */
  const [account, setAccount] = useState<Account | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountMode, setAccountMode] = useState<"in" | "up">("in");
  const [accountEmail, setAccountEmail] = useState("");
  const [accountPass, setAccountPass] = useState("");
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);

  const googleSlot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    whoAmI().then((a) => {
      if (live) setAccount(a);
    });

    // Coming back from Google, the server has already decided; the address says
    // which way, and whoAmI above is what actually reads the result.
    if (signInOutcome() === "failed") {
      setAccountError("Google could not sign you in. Try again, or use a password.");
      setAccountOpen(true);
    }

    return () => {
      live = false;
    };
  }, []);

  // Google draws its own button, so it can only be drawn once there is
  // somewhere to put it — which is when the panel opens.
  useEffect(() => {
    if (!accountOpen || !googleSlot.current) return;
    drawGoogleButton(googleSlot.current);
  }, [accountOpen]);

  async function submitAccount() {
    setAccountBusy(true);
    setAccountError(null);
    try {
      const who =
        accountMode === "in"
          ? await signIn(accountEmail, accountPass)
          : await signUp(accountEmail, accountPass);
      setAccount(who);
      setAccountOpen(false);
      setAccountPass("");
    } catch (e) {
      setAccountError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setAccountBusy(false);
    }
  }

  const [shapeId, setShapeId] = useState<ShapeId>("rectangle");

  const shape = useMemo(() => SHAPES.find((s) => s.id === shapeId)!, [shapeId]);

  /**
   * Proportions of the shapes that do not fix their own.
   *
   * Held here rather than in the editor because the mesh needs it too: for a
   * rectangle the printed height is whatever the crop box was dragged to, so
   * the number has to reach the worker as well as the canvas.
   */
  /**
   * Wrap the model round a cylinder, and through how much of one.
   *
   * The angle is what the model's width subtends, so it means the same thing
   * whatever the print is scaled to: 90 degrees is a quarter turn of a barrel
   * whether that barrel is 40mm across or 200. The relief ends up on the
   * outside of the curve, which is the way a lithophane sits round a lamp.
   */
  const [curved, setCurved] = useState(false);
  const [curveDeg, setCurveDeg] = useState(60);

  const [boxRatio, setBoxRatio] = useState(1.5);
  const cropRatio = shape.freeRatio ? boxRatio : shape.cropRatio;

  const [file, setFile] = useState<File | null>(null);
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [imgData, setImgData] = useState<ImageData | null>(null);

  // Fills whatever the photo does not cover. White by default: untouched
  // corners then come out thin and bright rather than solid and opaque.
  const [bgColor, setBgColor] = useState("#ffffff");

  const [rotate, setRotate] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [snapRotation, setSnapRotation] = useState(false);

  /**
   * Painting on the picture before it becomes a model.
   *
   * Cheaper than going back to an image editor for what this actually gets
   * used for: taking out a stray mark the tracing keeps finding, closing a gap
   * in a logo, blocking off a corner. White prints thin and dark prints thick,
   * so the brush colour is a thickness as much as a colour.
   */
  const [tool, setTool] = useState<Tool>("crop");
  const [paintColor, setPaintColor] = useState("#ffffff");
  const [paintSize, setPaintSize] = useState(28);
  const [fillTolerance, setFillTolerance] = useState(40);
  const [shapeFill, setShapeFill] = useState(true);
  const [opacity, setOpacity] = useState(1);
  const [softness, setSoftness] = useState(0);
  const [fontFamily, setFontFamily] = useState("Outfit");
  const [fontSize, setFontSize] = useState(64);
  /**
   * Picking a colour off the picture is a errand, not a mode.
   *
   * The swatch arms it, the next click on the picture answers it, and the tool
   * that was in use comes straight back — so it never has to be found again in
   * the toolbar, and there is no button for a state nobody stays in.
   */
  const [pickInto, setPickInto] = useState<"brush" | "backdrop">("brush");
  const pickReturn = useRef<Tool>("crop");

  const armPicker = (into: "brush" | "backdrop") => {
    pickReturn.current = tool === "pick" ? "crop" : tool;
    setPickInto(into);
    setTool("pick");
  };
  /** What the last Auto reading found, or null if it has not been asked. */
  const [autoNote, setAutoNote] = useState<string | null>(null);

  const editorRef = useRef<ImageEditorHandle>(null);


  const [widthMm, setWidthMm] = useState(80);
  const [minT, setMinT] = useState(0.8);
  const [maxT, setMaxT] = useState(3.0);
  const [frameMm, setFrameMm] = useState(1.5);
  const [layerHeight, setLayerHeight] = useState(0.2);

  // Band boundaries as layer counts through the thickness, ascending, plus one
  // colour per band (so one more colour than boundaries). Empty means a
  // single-colour STL. Counting in layers keeps every boundary on something
  // the printer can actually land on.
  const [splitLayers, setSplitLayers] = useState<number[]>([]);
  const [colors, setColors] = useState<string[]>(["#f2f2f2"]);

  /**
   * The printed height of each tone but the darkest, in layers, ascending.
   *
   * A terraced surface is a staircase, and these are its treads. The darkest
   * tone is the full thickness and needs no mark of its own — the axis
   * already names it — which is why N tones come with N - 1 marks. Held only
   * once someone drags one; a change of tone count drops it, since heights
   * for a different number of tones mean nothing.
   */
  const [toneOverride, setToneOverride] = useState<number[] | null>(null);

  /**
   * Brightness boundaries between the tones, as Auto measured them.
   *
   * Empty divides the range evenly, which is what a picture with no flat
   * tones wants. A flat-toned one wants the cuts halfway between the tones it
   * is actually drawn with: even division puts a boundary wherever it likes,
   * and a tone sitting close to one loses its thin features when a mesh cell
   * averages across the boundary. Dropped whenever the count changes by hand,
   * since boundaries measured for one count mean nothing at another.
   */
  const [toneCuts, setToneCuts] = useState<number[]>([]);

  /**
   * The bands the graphic surface had, held while the photo surface shows.
   *
   * A photograph wants one plain filament, so switching to it drops back to
   * that rather than carrying a graphic's palette across. Switching back
   * would then have thrown the palette away, hence the stash.
   */
  const graphicBandsRef = useRef<{ splits: number[]; colors: string[] } | null>(
    null,
  );

  /** What the crop box's proportions come to in millimetres. */
  const heightMm = widthMm / cropRatio;

  const totalLayers = Math.max(1, Math.round(maxT / layerHeight));
  const [quality, setQuality] = useState<Quality>("normal");
  const [smoothing, setSmoothing] = useState(1.0);
  // Whether the surface is cut, and how finely, held apart. Folding them into
  // one number meant Photo had to write 0 over the tone count, so coming back
  // to Graphic had nothing left to come back to.
  const [graphic, setGraphic] = useState(false);

  /**
   * Inlay: one flat slab with the picture set into its top layers, rather
   * than a relief. The filament changes partway across a layer instead of
   * between two, which is what a coaster or a sign wants. Counted in layers,
   * not millimetres, because the whole point is that the change lands on a
   * layer the printer stops at.
   */
  const [inlayMode, setInlayMode] = useState(false);

  /**
   * Read the tones as numbers off a tone map, rather than as thresholds on a
   * brightness field.
   *
   * Thresholds cannot help putting a tone that lies between two others
   * wherever those two meet — brightness has to pass through its values on the
   * way — so a white shape on black comes out outlined in it. Off, the surface
   * is built the way it always was.
   */
  const [vector, setVector] = useState(true);
  /**
   * How big a crop the editor hands over.
   *
   * Reading tones as regions traces boundaries along the crop's own pixel
   * grid, so the crop is what the edges are made of and 900 across shows every
   * one of its steps. Everything else resamples what it is given down to the
   * printed layers and cannot tell the difference, so it keeps the small one.
   */
  const traceDetail = vector && (inlayMode || graphic) ? 1600 * 1390 : 900 * 780;
  const [baseLayers, setBaseLayers] = useState(6);
  const [pictureLayers, setPictureLayers] = useState(4);

  const [toneLevels, setToneLevels] = useState(2);
  const levels = graphic || inlayMode ? toneLevels : 0;

  /**
   * Where a given number of tones would sit, in layers, thickest first.
   *
   * Taken for a count rather than read off the current one, because placing
   * the colour bands for a count has to happen in the same breath as setting
   * it, before the state has moved.
   */
  /**
   * The N - 1 boundaries for a count of N tones, in layers, ascending.
   *
   * Taken for a count rather than read off the current one, because the
   * colour bands are placed in the same breath as the count is set, before
   * the state has moved.
   */
  function toneDividersOf(count: number): number[] {
    const hold = (v: number) => Math.max(1, Math.min(totalLayers - 1, Math.round(v)));

    if (toneOverride && toneOverride.length === count - 1) {
      return toneOverride.map(hold);
    }

    // Evenly down the thickness, the darkest tread at the top and the
    // lightest on Min, so the two numbers in the Thickness section are the
    // two ends of the staircase.
    const even: number[] = [];
    for (let k = count - 1; k >= 1; k--) {
      even.push(hold((maxT - (k * (maxT - minT)) / (count - 1)) / layerHeight));
    }
    return even;
  }

  /**
   * Surface height of every tone, thickest first.
   *
   * The treads themselves, with the full thickness on the front for the
   * darkest tone. What the panel shows is therefore what the model is built
   * to, layer for layer, rather than a boundary the surface never touches.
   */
  function tonePlateausOf(dividers: readonly number[]): number[] {
    return [totalLayers, ...[...dividers].reverse()];
  }

  const toneDividers = useMemo(
    () => toneDividersOf(toneLevels),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toneLevels, toneOverride, totalLayers, minT, maxT, layerHeight],
  );

  const tonePlateaus = useMemo(
    () => tonePlateausOf(toneDividers),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toneDividers, totalLayers],
  );

  /**
   * Colour bands that no tone can reach.
   *
   * A band shows its colour where the surface stops inside it. Terraced, the
   * surface only ever stops at a tone height, or at the top of the frame, so
   * a band with none of those between its first and last layer is buried
   * under the one above and prints where nobody will see it.
   */
  const buriedBands = useMemo(() => {
    if (!graphic) return [] as number[];

    const ends = new Set<number>(tonePlateaus);
    if (frameMm > 0.05) ends.add(totalLayers);

    const out: number[] = [];
    for (let b = 0; b <= splitLayers.length; b++) {
      const first = b === 0 ? 1 : splitLayers[b - 1] + 1;
      const last = b < splitLayers.length ? splitLayers[b] : totalLayers;
      let reached = false;
      for (const e of ends) {
        if (e >= first && e <= last) {
          reached = true;
          break;
        }
      }
      if (!reached) out.push(b);
    }
    return out;
  }, [graphic, tonePlateaus, splitLayers, totalLayers, frameMm]);

  // Vertical prints the lithophane standing up; flat lays it down so the
  // relief runs along the print axis.
  const [orientation, setOrientation] = useState<"vertical" | "flat">(
    "vertical",
  );
  // What actually gets built. The trim is a uniform scale, so the shape keeps
  // its proportions and simply comes out a touch under all round.
  const buildWidthMm =
    orientation === "vertical"
      ? Math.max(1, widthMm - VERTICAL_TRIM_MM)
      : widthMm;
  const buildHeightMm = buildWidthMm / cropRatio;
  const [flatHintOpen, setFlatHintOpen] = useState(false);

  const [previewMesh, setPreviewMesh] = useState<PreviewMesh | null>(null);

  // The preview shows whatever was generated last. Without tracking which
  // settings produced it, changing the crop and switching tabs shows the old
  // model with no hint that it is out of date — which reads as the generator
  // disagreeing with the editor.
  const [imgVersion, setImgVersion] = useState(0);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const imgSigRef = useRef("");

  /** Everything the generated mesh depends on. */
  const settingsKey = JSON.stringify([
    imgVersion, shapeId, widthMm, cropRatio, minT, maxT, frameMm, curved, curveDeg,
    quality, smoothing, levels, tonePlateaus, toneCuts, layerHeight, splitLayers, colors,
    inlayMode, baseLayers, pictureLayers, vector,
    orientation,
  ]);
  const previewStale = previewMesh !== null && previewKey !== settingsKey;
  const [view, setView] = useState<"editor" | "preview">("editor");
  const [flatShading, setFlatShading] = useState(true);
  const [lightBackground, setLightBackground] = useState(true);
  const [showGrid, setShowGrid] = useState(true);

  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{
    type: "error" | "success";
    text: string;
  } | null>(null);

  const [footerText, setFooterText] = useState(FOOTER_MESSAGES[0]);
  const [isDragOver, setIsDragOver] = useState(false);

  const jobIdRef = useRef(0);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const randomMsg =
      FOOTER_MESSAGES[Math.floor(Math.random() * FOOTER_MESSAGES.length)];
    setFooterText(randomMsg);
  }, []);

  useEffect(() => {
    if (!file) {
      setImgEl(null);
      return;
    }

    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      setImgEl(img);
      const found = edgeColorOf(img);
      if (found) setBgColor(found);
      URL.revokeObjectURL(url);
    };

    img.src = url;
    setStatusMsg(null);
  }, [file]);

  /**
   * Takes in a new picture, and drops whatever was built from the last one.
   *
   * The model on the 3D tab belongs to the previous photo, so leaving it
   * standing means a fresh import is answered with the old one still on
   * screen. Clearing it also sends the view back to the editor, which is
   * where the new picture has to be cropped anyway.
   */
  function pickFile(next: File | null) {
    setFile(next);
    setStatusMsg(null);
    setPreviewMesh(null);
    setPreviewKey(null);
    setView("editor");
    setAutoNote(null);
  }

  function resetThicknessDefaults() {
    setMaxT(3.0);
    setMinT(0.8);
    setFrameMm(1.5);
    setCurved(false);
    setCurveDeg(60);
    setSplitLayers([]);
    setColors(["#f2f2f2"]);
  }

  function handleImageData(d: ImageData | null) {
    setImgData(d);
    const sig = d ? imageSignature(d) : "";
    if (sig !== imgSigRef.current) {
      imgSigRef.current = sig;
      setImgVersion((v) => v + 1);
    }
  }

  /** Proportions the crop box reports back, held to something printable. */
  function handleCropRatio(ratio: number) {
    if (!Number.isFinite(ratio) || ratio <= 0) return;
    // Wide enough to be no practical limit; the bound only keeps the editor's
    // output canvas from being asked for a degenerate shape.
    setBoxRatio(Math.max(0.05, Math.min(20, ratio)));
  }

  function setBandColor(index: number, value: string) {
    setColors((prev) => prev.map((c, i) => (i === index ? value : c)));
  }

  /**
   * Drops or pulls in band boundaries that no longer fit a thinner model.
   *
   * Splits and colours have to move together, so both are worked out here and
   * set outright. Deriving one inside the other's updater does not work —
   * updaters run later, not during the call.
   */
  function clampBandsTo(newMaxT: number) {
    const limit = Math.max(1, Math.round(newMaxT / layerHeight)) - 1;

    const next: number[] = [];
    for (const s of splitLayers) {
      const v = Math.min(s, limit);
      if (v >= 1 && (next.length === 0 || v > next[next.length - 1])) {
        next.push(v);
      }
    }

    if (next.length === splitLayers.length) {
      if (next.some((v, i) => v !== splitLayers[i])) setSplitLayers(next);
      return;
    }

    setSplitLayers(next);
    setColors(colors.slice(0, next.length + 1));
  }

  /**
   * Puts back the bands the graphic surface had, or builds them from the tone
   * count the first time round.
   *
   * Anything the thickness has done meanwhile is taken into account: a
   * boundary past the top of a thinner model is dropped, and the colours are
   * trimmed or topped up to match whatever survives.
   */
  function restoreGraphicBands() {
    const kept = graphicBandsRef.current;
    if (!kept) {
      applyToneBands(toneLevels);
      return;
    }

    const splits: number[] = [];
    for (const v of kept.splits) {
      const at = Math.min(Math.round(v), totalLayers - 1);
      if (at >= 1 && (splits.length === 0 || at > splits[splits.length - 1])) {
        splits.push(at);
      }
    }

    const cols = kept.colors.slice(0, splits.length + 1);
    while (cols.length < splits.length + 1) {
      cols.push(BAND_PALETTE[cols.length % BAND_PALETTE.length]);
    }

    setSplitLayers(splits);
    setColors(cols);
  }

  /**
   * Gives a tone count its colour bands: one band per tone, so four tones
   * come out as three boundaries and four pieces.
   *
   * A boundary sits on the tone itself, which leaves that tone in the band
   * below it and hands the bands above everything thicker.
   *
   * `palette` is each tone's own colour read off the picture, darkest first.
   * Given one, the bands start out looking like the artwork — a black, red
   * and white logo comes up black, red and white — which is a far better
   * starting point than the stock palette, and still only a starting point:
   * every band stays clickable to recolour. Without one, colours already
   * picked are kept and a new band takes the next from the palette.
   */
  function applyToneBands(count: number, palette?: readonly string[]) {
    const rising = toneDividersOf(count);

    const next: number[] = [];
    for (const layer of rising) {
      const at = Math.min(layer, totalLayers - 1);
      if (at >= 1 && (next.length === 0 || at > next[next.length - 1])) {
        next.push(at);
      }
    }

    setSplitLayers(next);
    setColors((prev) => {
      // Bands run bottom-up and the bottom band is the thinnest, so it is the
      // *lightest* tone that belongs to colours[0] — the picture's tones
      // arrive darkest first and have to be turned around.
      const fromImage = palette ? [...palette].reverse() : null;

      const out: string[] = [];
      for (let i = 0; i < next.length + 1; i++) {
        if (fromImage && i < fromImage.length) out.push(fromImage[i]);
        else if (i < prev.length) out.push(prev[i]);
        else out.push(BAND_PALETTE[i % BAND_PALETTE.length]);
      }
      return out;
    });
  }

  /**
   * Keeps one colour per body when the tone count moves.
   *
   * An inlay has a body for the base and one per tone, and no boundaries
   * through the thickness at all, so the band slider's bookkeeping does not
   * apply — only the length of the colour list does.
   */
  function applyInlayColors(count: number) {
    setColors((prev) => {
      const out = prev.slice(0, count + 1);
      while (out.length < count + 1) {
        out.push(BAND_PALETTE[out.length % BAND_PALETTE.length]);
      }
      return out;
    });
  }

  /**
   * Reads the tone count off the picture.
   *
   * The right number is a property of the artwork, not a taste: a two-colour
   * logo has two, a flat-shaded drawing has however many shades it was drawn
   * with. Finding it by hand means trying numbers until the preview stops
   * changing, which is what this does in one pass over the histogram.
   */
  function autoToneLevels() {
    if (!imgData) return;

    const found = suggestToneLevels(imgData);
    setToneLevels(found.levels);
    setToneCuts(found.smooth ? [] : found.cuts);

    if (inlayMode) {
      // One body per tone, on a base that starts out matching whichever tone
      // covers most of the picture — usually its background, which is the one
      // a coaster wants underneath.
      setColors([found.colors[found.dominant], ...found.colors]);
    } else {
      applyToneBands(found.levels, found.colors);
    }

    setToneOverride(null);
    setAutoNote(
      found.smooth
        ? `No flat tones in this picture — ${found.levels} is a starting point, not a reading.`
        : `${found.levels} flat tones, holding ${Math.round(found.covered * 100)}% of the picture.`,
    );
  }

  /** Moves one tone's tread, keeping the staircase climbing. */
  function setToneAt(index: number, value: number) {
    if (Number.isNaN(value)) return;
    const next = [...toneDividers];
    const floor = index > 0 ? next[index - 1] + 1 : 1;
    const ceiling =
      index + 1 < next.length ? next[index + 1] - 1 : totalLayers - 1;
    if (ceiling < floor) return;
    next[index] = Math.max(floor, Math.min(ceiling, Math.round(value)));
    setToneOverride(next);
  }

  /** Sets a band's last layer, keeping the list strictly increasing. */
  function setSplitAt(index: number, value: number) {
    if (Number.isNaN(value)) return;
    setSplitLayers((prev) => {
      const lowest = index > 0 ? prev[index - 1] + 1 : 1;
      const highest =
        index + 1 < prev.length ? prev[index + 1] - 1 : totalLayers - 1;
      if (highest < lowest) return prev;

      const clamped = Math.max(lowest, Math.min(highest, Math.round(value)));
      return prev.map((s, i) => (i === index ? clamped : s));
    });
  }

  /**
   * Where a new boundary would go.
   *
   * Terraced, the surface only ever stops at a tone height, so a boundary put
   * anywhere else divides nothing that can be seen. Landing it on the next
   * tone up leaves that tone in the band below and gives the band above the
   * tones thicker than it. Smooth output has no such steps, so it keeps the
   * old halfway rule.
   */
  function nextBandBoundary(): number | null {
    if (splitLayers.length >= 7) return null;
    const last = splitLayers.length > 0 ? splitLayers[splitLayers.length - 1] : 0;

    if (graphic) {
      const rising = toneDividersOf(toneLevels);
      const at = rising[splitLayers.length];
      if (at !== undefined && at > last && at <= totalLayers - 1) return at;
    }

    const next = Math.round((last + totalLayers) / 2);
    if (next <= last || next > totalLayers - 1) return null;
    return next;
  }

  function addBand() {
    const next = nextBandBoundary();
    if (next === null) return;

    const wasSingleColour = splitLayers.length === 0;

    setSplitLayers([...splitLayers, next]);
    setColors([...colors, BAND_PALETTE[colors.length % BAND_PALETTE.length]]);

    // Standing up, the bands run through the model's depth, so every layer
    // contains all of them and the printer swaps filament on each one. Worth
    // saying once, at the moment it starts to matter.
    if (
      wasSingleColour &&
      orientation === "vertical" &&
      localStorage.getItem(FLAT_HINT_KEY) !== "1"
    ) {
      setFlatHintOpen(true);
    }
  }

  function removeBand(index: number) {
    setSplitLayers((prev) => prev.filter((_, i) => i !== index));
    setColors((prev) => prev.filter((_, i) => i !== index + 1));
  }

  function ensureWorker() {
    if (!workerRef.current) workerRef.current = new STLWorker();
    return workerRef.current!;
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFile = e.dataTransfer.files[0];

      if (droppedFile.type.startsWith("image/")) {
        pickFile(droppedFile);
      }
    }
  };

  async function generate(download = true) {
    if (!imgData || isGenerating) return;

    setIsGenerating(true);
    setStatusMsg(null);

    const currentJobId = ++jobIdRef.current;
    const w = ensureWorker();

    try {
      const p = new Promise<{
        file: ArrayBuffer;
        extension: "stl" | "3mf";
        preview: ArrayBuffer;
        previewTriangles: number;
        previewBands: number[];
      }>((resolve, reject) => {
        const handler = (e: MessageEvent) => {
          if (e.data.ok) {
            resolve({
              file: e.data.file,
              extension: e.data.extension,
              preview: e.data.preview,
              previewTriangles: e.data.previewTriangles,
              previewBands: e.data.previewBands,
            });
          } else {
            reject(e.data.error);
          }

          w.removeEventListener("message", handler);
        };

        w.addEventListener("message", handler);

        w.postMessage({
          id: currentJobId,
          shapeId,
          image: imgData,
          widthMm: +buildWidthMm.toFixed(4),
          heightMm: +buildHeightMm.toFixed(4),
          minT,
          maxT,
          frameMm,
          quality,
          smoothing,
          levels,
          orientation,
          curveDeg: curved ? curveDeg : 0,
          splitHeightsMm: splitLayers.map((n) => +(n * layerHeight).toFixed(4)),
          toneHeightsMm: graphic
            ? tonePlateaus.map((n) => +(n * layerHeight).toFixed(4))
            : [],
          toneCuts: levels > 0 ? toneCuts : [],
          inlayBaseLayers: inlayMode ? baseLayers : 0,
          inlayTopLayers: inlayMode ? pictureLayers : 0,
          vector,
          colors,
          layerHeight,
          emboss: "back",
        });
      });

      const result = await p;

      if (jobIdRef.current === currentJobId) {
        setPreviewMesh({
          positions: new Float32Array(result.preview),
          triangleCount: result.previewTriangles,
          bandStarts: result.previewBands,
          colors: [...colors],
          // Built on +z, and standing it up turns that into -y.
          faceAxis: orientation === "flat" ? [0, 0, 1] : [0, -1, 0],
        });
        setPreviewKey(settingsKey);
        setView("preview");

        if (download) {
          const baseName = file?.name.replace(/\.[^/.]+$/, "") || "image";
          downloadArrayBuffer(
            result.file,
            `litogen-${baseName}.${result.extension}`,
          );
        }

        setStatusMsg({
          type: "success",
          text: download
            ? `${result.extension.toUpperCase()} Ready! · ${result.previewTriangles.toLocaleString()} tris`
            : `${result.previewTriangles.toLocaleString()} triangles`,
        });
      }
    } catch {
      setStatusMsg({ type: "error", text: "Failed!" });
    } finally {
      if (jobIdRef.current === currentJobId) setIsGenerating(false);
    }
  }

  return (
    <div className="appShell">
      <style>{BRAND_STYLE}</style>

      <aside className="leftPanel">
        <div className="panelHeader" style={{ paddingBottom: 10 }}>
          <div className="brandRow">
            <div className="brand-title">Litogen</div>
            {account ? (
              <button
                className="autoBtn"
                title={`Signed in as ${account.email} · ${account.plan}`}
                onClick={async () => {
                  await signOut();
                  setAccount(null);
                }}
              >
                Sign out
              </button>
            ) : (
              <button
                className="autoBtn"
                title="Sign in, or make an account"
                onClick={() => {
                  setAccountError(null);
                  setAccountOpen(true);
                }}
              >
                Sign in
              </button>
            )}
          </div>
          <div className="build-tag" title="Bug bildirirken bu satırı da yaz">
            v{__APP_VERSION__} · {__BUILD_SHA__} · {__BUILD_DATE__}
            {account ? ` · ${account.email}` : ""}
          </div>
        </div>

        <div className="section">
          <label
            className={`custom-file-upload ${isDragOver ? "drag-active" : ""}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <span>📷 {file.name.slice(0, 10)}...</span>
            ) : (
              <span>📂 Select Image or Drag&Drop</span>
            )}
          </label>

        </div>

        <div className="section">
          <div className="label-row">
            <div className="sectionTitle">Surface</div>
            <InfoIcon text="Photo samples the picture as a continuous surface. Graphic quantises it into tones and cuts the mesh along the picture's own contours, so hard edges come out exactly straight instead of stair-stepped. Use Graphic for logos, text and line art. Switching also moves the print orientation to the one that suits it — upright for a photograph, flat for a graphic, where colour bands cost one filament change each instead of one per layer. Change it back underneath if you would rather not." />
          </div>

          <div className="segmented">
            <button
              className={`segment ${levels === 0 ? "active" : ""}`}
              onClick={() => {
                setInlayMode(false);
                if (!graphic) return;
                graphicBandsRef.current = { splits: splitLayers, colors };
                setGraphic(false);
                setOrientation("vertical");
                setSplitLayers([]);
                setColors([BAND_PALETTE[0]]);
              }}
            >
              Photo
            </button>
            {/* Only on an actual change of surface: pressing the one that
                is already on leaves the tone count and the orientation
                exactly as they were set. */}
            <button
              className={`segment ${graphic && !inlayMode ? "active" : ""}`}
              onClick={() => {
                setInlayMode(false);
                if (graphic) return;
                setGraphic(true);
                setOrientation("flat");
                restoreGraphicBands();
              }}
            >
              Graphic
            </button>
            <button
              className={`segment ${inlayMode ? "active" : ""}`}
              onClick={() => {
                if (inlayMode) return;
                if (graphic) graphicBandsRef.current = { splits: splitLayers, colors };
                setInlayMode(true);
                setGraphic(false);
                setOrientation("flat");
                setSplitLayers([]);
                applyInlayColors(toneLevels);
              }}
            >
              Inlay
            </button>
          </div>

          {(inlayMode || graphic) && (
            <label className="checkRow">
              <input
                type="checkbox"
                checked={vector}
                onChange={(e) => setVector(e.target.checked)}
              />
              <span>Tones as regions</span>
              <InfoIcon text="Traces each tone out of the picture as a closed outline and gives it its own solid, instead of deciding tones by thresholds on brightness. Read off brightness, a tone that sits between two others — a red between black and white, say — cannot help appearing where those two meet, so shapes come out outlined in it, and every edge steps along the sampling grid. Traced, the boundary between two tones is one line with nothing in it, drawn at the picture's own resolution. Off, the surface is built the way it was before." />
            </label>
          )}

          <div className="bandHint">
            {inlayMode
              ? "One flat slab, the picture set into its top layers — the filament changes across a layer, not between two."
              : levels === 0
                ? "Sampled as a continuous surface — what a photograph wants."
                : "Cut along the picture's own contours, so hard edges come out straight."}
          </div>

        </div>

        <div className="section">
          <div className="label-row">
            <label className="miniLabel">Shape</label>
            <InfoIcon text="Choose the geometric base shape for your lithophane (Triangle, Circle, Hexagon, Pentagon)." />
          </div>

          <select
            className="spinInput"
            value={shapeId}
            onChange={(e) => {
              setShapeId(e.target.value as ShapeId);
              // The crop follows the shape, so that is what wants looking at.
              setView("editor");
            }}
          >
            {SHAPES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>

          <label className="checkRow">
            <input
              type="checkbox"
              checked={curved}
              onChange={(e) => setCurved(e.target.checked)}
            />
            <span>Curve</span>
            <InfoIcon text="Wraps the model round a cylinder, with the picture on the outside of the curve — the way a lithophane sits round a lamp. The angle is what the width wraps through, so it means the same at any print size: 90 degrees is a quarter turn, 180 a half. The base curves with it, so the print stands on an arc rather than a straight edge and wants a brim." />
          </label>

          {curved && (
            <>
              <div className="label-row" style={{ marginTop: 10 }}>
                <label className="miniLabel">Curve (degrees)</label>
                <InfoIcon text="How much of a turn the model's width wraps through. Small angles give a gentle bow; 180 folds it into a half cylinder." />
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                <input
                  className="range"
                  type="range"
                  min={5}
                  max={180}
                  step={5}
                  value={curveDeg}
                  onChange={(e) => setCurveDeg(Number(e.target.value))}
                />
                <div className="spinRow">
                  <input
                    className="spinInput"
                    type="number"
                    min={5}
                    max={180}
                    step={5}
                    value={curveDeg}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isNaN(v)) setCurveDeg(Math.max(5, Math.min(180, v)));
                    }}
                  />
                  <div className="spinBtns">
                    <button
                      className="spinBtn"
                      onClick={() => setCurveDeg((v) => Math.min(180, v + 5))}
                    >
                      ▲
                    </button>
                    <button
                      className="spinBtn"
                      onClick={() => setCurveDeg((v) => Math.max(5, v - 5))}
                    >
                      ▼
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}

          <div className="label-row" style={{ marginTop: 12 }}>
            <label className="miniLabel">Width (mm)</label>
            <InfoIcon text="Horizontal width of the print, defined as the maximum distance between the leftmost and rightmost points." />
          </div>

          <div className="spinRow">
            <input
              className="spinInput"
              type="number"
              step={0.01}
              value={widthMm}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!Number.isNaN(v)) setWidthMm(+v.toFixed(2));
              }}
            />

            <div className="spinBtns">
              <button
                className="spinBtn"
                onClick={() => setWidthMm((v) => +(v + 1).toFixed(2))}
              >
                ▲
              </button>
              <button
                className="spinBtn"
                onClick={() =>
                  setWidthMm((v) => +(Math.max(10, v - 1)).toFixed(2))
                }
              >
                ▼
              </button>
            </div>
          </div>

          {shape.freeRatio && (
            <div className="bandHint">
              Height {heightMm.toFixed(1)} mm · drag the crop box's side or
              corner grips to change it
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button
              className="btn"
              style={{
                flex: 1,
                justifyContent: "center",
                padding: "8px 4px",
                fontSize: "0.85rem",
              }}
              onClick={() => {
                if (shapeId === "pentagon") {
                  const side = 50;
                  const width = side * 1.618;
                  setWidthMm(+width.toFixed(2));
                } else {
                  setWidthMm(60);
                }
                resetThicknessDefaults();
              }}
            >
              Small
            </button>

            <button
              className="btn"
              style={{
                flex: 1,
                justifyContent: "center",
                padding: "8px 4px",
                fontSize: "0.85rem",
              }}
              onClick={() => {
                if (shapeId === "pentagon") {
                  const side = 60;
                  const width = side * 1.618;
                  setWidthMm(+width.toFixed(2));
                } else {
                  setWidthMm(80);
                }
                resetThicknessDefaults();
              }}
            >
              Large
            </button>
          </div>
        </div>

        <div className="section">
          <div className="sectionTitle" style={{ marginBottom: 12 }}>
            Thickness
          </div>

          {!inlayMode && (<>
          <div className="label-row">
            <label className="miniLabel">Max (mm)</label>
            <InfoIcon text="The thickness of the darkest (black) areas. Ideal value: 2.5mm - 3.2mm." />
          </div>

          <div className="spinRow">
            <input
              className="spinInput"
              type="number"
              step={0.1}
              value={maxT}
              onChange={(e) => {
                const v = +e.target.value;
                setMaxT(v);
                clampBandsTo(v);
              }}
            />
            <div className="spinBtns">
              <button
                className="spinBtn"
                onClick={() => setMaxT(+(maxT + 0.1).toFixed(2))}
              >
                ▲
              </button>
              <button
                className="spinBtn"
                onClick={() => {
                  const next = +(maxT - 0.1).toFixed(2);
                  setMaxT(next);
                  clampBandsTo(next);
                }}
              >
                ▼
              </button>
            </div>
          </div>

          <div className="label-row">
            <label className="miniLabel">Min (mm)</label>
            <InfoIcon text="The thickness of the lightest (white) areas. Do not go below 0.6mm." />
          </div>

          <div className="spinRow">
            <input
              className="spinInput"
              type="number"
              step={0.1}
              value={minT}
              onChange={(e) => setMinT(+e.target.value)}
            />
            <div className="spinBtns">
              <button
                className="spinBtn"
                onClick={() => setMinT((v) => +(v + 0.1).toFixed(2))}
              >
                ▲
              </button>
              <button
                className="spinBtn"
                onClick={() => setMinT((v) => +(v - 0.1).toFixed(2))}
              >
                ▼
              </button>
            </div>
          </div>

          <div className="label-row">
            <label className="miniLabel">Frame (mm)</label>
            <InfoIcon text="The thickness of the frame surrounding the model." />
          </div>

          <div className="spinRow">
            <input
              className="spinInput"
              type="number"
              step={0.1}
              value={frameMm}
              onChange={(e) => setFrameMm(+e.target.value)}
            />
            <div className="spinBtns">
              <button
                className="spinBtn"
                onClick={() => setFrameMm((v) => +(v + 0.1).toFixed(2))}
              >
                ▲
              </button>
              <button
                className="spinBtn"
                onClick={() => setFrameMm((v) => +(v - 0.1).toFixed(2))}
              >
                ▼
              </button>
            </div>
          </div>

          </>)}

          {inlayMode && (
            <>
              <div className="label-row">
                <label className="miniLabel">Base Layers</label>
                <InfoIcon text="Solid colour under the picture. These print in one filament and carry the part; the picture never reaches down into them." />
              </div>
              <div className="spinRow">
                <input
                  className="spinInput"
                  type="number"
                  min={1}
                  max={200}
                  step={1}
                  value={baseLayers}
                  onChange={(e) => {
                    const v = Math.round(Number(e.target.value));
                    if (!Number.isNaN(v)) setBaseLayers(Math.max(1, Math.min(200, v)));
                  }}
                />
                <div className="spinBtns">
                  <button className="spinBtn" onClick={() => setBaseLayers((v) => Math.min(200, v + 1))}>▲</button>
                  <button className="spinBtn" onClick={() => setBaseLayers((v) => Math.max(1, v - 1))}>▼</button>
                </div>
              </div>

              <div className="label-row" style={{ marginTop: 12 }}>
                <label className="miniLabel">Picture Layers</label>
                <InfoIcon text="Layers the picture is set into, on top of the base. Every tone stands in all of them, side by side, so the filament changes partway across a layer rather than between two." />
              </div>
              <div className="spinRow">
                <input
                  className="spinInput"
                  type="number"
                  min={1}
                  max={200}
                  step={1}
                  value={pictureLayers}
                  onChange={(e) => {
                    const v = Math.round(Number(e.target.value));
                    if (!Number.isNaN(v)) setPictureLayers(Math.max(1, Math.min(200, v)));
                  }}
                />
                <div className="spinBtns">
                  <button className="spinBtn" onClick={() => setPictureLayers((v) => Math.min(200, v + 1))}>▲</button>
                  <button className="spinBtn" onClick={() => setPictureLayers((v) => Math.max(1, v - 1))}>▼</button>
                </div>
              </div>

              <div className="bandHint">
                {baseLayers + pictureLayers} layers ·{" "}
                {((baseLayers + pictureLayers) * layerHeight).toFixed(2)} mm total
              </div>
            </>
          )}

          <div className="label-row" style={{ marginTop: 12 }}>
            <label className="miniLabel">Print Orientation</label>
            <InfoIcon text="Vertical stands the model up — best for a single colour, and built a little under size so it still fits its frame. Flat lays it down so the thickness runs along the print axis, which turns each colour band into a contiguous run of layers: one filament change per band instead of one per layer, and no trim needed. An inlay is flat by nature, but standing one up is what you want for a curved panel." />
          </div>

          <div className="segmented">
            <button
              className={`segment ${orientation === "vertical" ? "active" : ""}`}
              onClick={() => setOrientation("vertical")}
            >
              Vertical
            </button>
            <button
              className={`segment ${orientation === "flat" ? "active" : ""}`}
              onClick={() => setOrientation("flat")}
            >
              Flat
            </button>
          </div>

          {orientation === "vertical" && (
            <div className="bandHint">
              Built at {buildWidthMm.toFixed(2)} mm, {VERTICAL_TRIM_MM.toFixed(2)}{" "}
              mm under the {widthMm.toFixed(2)} mm set above — upright prints
              come out a touch wide and stop fitting their frame. Flat needs no
              trim.
            </div>
          )}

          <div className="label-row" style={{ marginTop: 12 }}>
            <label className="miniLabel">Layer Height (mm)</label>
            <InfoIcon text="Your slicer's layer height. Colour bands are counted in these, so every boundary lands on a layer the printer can actually stop at." />
          </div>

          <div className="spinRow">
            <input
              className="spinInput"
              type="number"
              min={0.04}
              max={0.4}
              step={0.02}
              value={layerHeight}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!Number.isNaN(v) && v >= 0.04 && v <= 0.4) {
                  setLayerHeight(+v.toFixed(2));
                }
              }}
            />
          </div>

        </div>

        <div className="section">
          <div className="sectionTitle" style={{ marginBottom: 12 }}>
            {graphic ? "Tones & Color" : "Color"}
          </div>

          {levels > 0 && (
            <>
              <div className="label-row" style={{ marginTop: 12 }}>
                <label className="miniLabel">Tone levels</label>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    className="autoBtn"
                    onClick={autoToneLevels}
                    disabled={!imgData}
                    title={
                      imgData
                        ? "Count the flat tones in the picture and use that"
                        : "Load a picture first"
                    }
                  >
                    Auto
                  </button>
                  <InfoIcon text="How many brightness levels the picture is flattened to. 2 gives a pure silhouette — right for a black and white logo. More levels keep some shading, at the cost of extra walls. Unrelated to Color Bands below, which splits the print between filaments." />
                </div>
              </div>

              <div className="spinRow">
                <input
                  className="spinInput"
                  type="number"
                  min={2}
                  max={16}
                  step={1}
                  value={levels}
                  onChange={(e) => {
                    const v = Math.round(Number(e.target.value));
                    if (Number.isNaN(v)) return;
                    const next = Math.max(2, Math.min(16, v));
                    setToneLevels(next);
                    setToneCuts([]);
                    if (inlayMode) applyInlayColors(next);
                    else applyToneBands(next);
                    setAutoNote(null);
                  }}
                />
                <div className="spinBtns">
                  <button
                    className="spinBtn"
                    onClick={() => {
                      const next = Math.min(16, toneLevels + 1);
                      setToneLevels(next);
                      setToneCuts([]);
                      if (inlayMode) applyInlayColors(next);
                      else applyToneBands(next);
                      setAutoNote(null);
                    }}
                  >
                    ▲
                  </button>
                  <button
                    className="spinBtn"
                    onClick={() => {
                      const next = Math.max(2, toneLevels - 1);
                      setToneLevels(next);
                      setToneCuts([]);
                      if (inlayMode) applyInlayColors(next);
                      else applyToneBands(next);
                      setAutoNote(null);
                    }}
                  >
                    ▼
                  </button>
                </div>
              </div>
            </>
          )}

          {autoNote && (
            <div className="bandHint" style={{ marginBottom: 12 }}>
              {autoNote}
            </div>
          )}

          {inlayMode ? (
            <>
              <div className="label-row">
                <label className="miniLabel">Colors · {levels + 1} bodies</label>
                <InfoIcon text="One body for the base and one for each tone, all exported as a 3MF. They stand in the same layers rather than on top of each other, so a slicer changes filament partway across a layer. Assign one to each." />
              </div>

              <div className="inlayColors">
                {Array.from({ length: levels + 1 }, (_, b) => (
                  <label className="inlayColor" key={`ic${b}`}>
                    <input
                      type="color"
                      value={colors[b] ?? "#cccccc"}
                      onChange={(e) => setBandColor(b, e.target.value)}
                    />
                    <span>{b === 0 ? "Base" : `Tone ${b}`}</span>
                  </label>
                ))}
              </div>

              <div className="bandHint">
                Base is the solid colour under the picture; tones run darkest
                first. Auto above reads all of them off the picture.
              </div>
            </>
          ) : (
          <>
          <div className="label-row">
            <label className="miniLabel">
              Color Bands ·{" "}
              {orientation === "flat"
                ? `${totalLayers} layers`
                : `${maxT.toFixed(2)} mm thick`}
            </label>
            <InfoIcon text="Slices the lithophane into stacked bodies through its thickness and exports a 3MF instead of an STL. The bodies come out as one part made of several bodies, so they stay registered — assign a filament to each. One band means a plain single-colour STL." />
          </div>

          {orientation === "vertical" && (
            <div className="bandHint">
              Standing up, the print is {buildHeightMm.toFixed(1)} mm tall —{" "}
              {Math.max(1, Math.round(buildHeightMm / layerHeight))} layers. The
              bands below run through its {maxT.toFixed(2)} mm of thickness,
              which is across the layers rather than along them, so every layer
              contains all of them and the printer changes filament on each one.
              Lay it flat and each band becomes a run of layers instead.
            </div>
          )}

          <BandSlider
            totalLayers={totalLayers}
            splitLayers={splitLayers}
            colors={colors}
            layerHeight={layerHeight}
            toneLayers={toneDividers}
            showTones={graphic}
            frameLayer={frameMm > 0.05 ? totalLayers : null}
            buried={buriedBands}
            onMoveSplit={setSplitAt}
            onMoveTone={setToneAt}
            onColor={setBandColor}
            onRemoveSplit={removeBand}
          />

          {buriedBands.length > 0 && (
            <div className="bandWarn">
              {buriedBands.length === 1
                ? `Band ${buriedBands[0] + 1} sits between tones — nothing on the surface stops inside it, so its colour stays buried under the band above.`
                : `Bands ${buriedBands
                    .map((n) => n + 1)
                    .join(", ")} sit between tones — nothing on the surface stops inside them, so those colours stay buried under the band above.`}{" "}
              Move a boundary onto a tone mark, or drop the band.
            </div>
          )}

          <div className="bandHint">
            {splitLayers.length === 0
              ? `Single colour · ${(totalLayers * layerHeight).toFixed(2)} mm thick · click the bar to recolour`
              : graphic
                ? `Drag a divider to move it · click one to recolour · amber marks are the printed tone heights · exports as 3MF`
                : `Drag a divider to move it · click a band to recolour · exports as 3MF`}
          </div>

          <button
            className="btn"
            style={{ width: "100%", marginTop: 8, justifyContent: "center" }}
            onClick={addBand}
            disabled={nextBandBoundary() === null}
            title={
              nextBandBoundary() === null
                ? "No layers left to give a new band — raise Max thickness or lower Layer height"
                : undefined
            }
          >
            + Add color band
          </button>
          </>
          )}

          <button
            className="btn"
            style={{ marginTop: 12, width: "100%" }}
            onClick={resetThicknessDefaults}
          >
            Reset Defaults
          </button>
        </div>

        <div className="section">
          <div className="label-row">
            <div className="sectionTitle">Quality</div>
            <InfoIcon text="High: More detail and more triangles (larger file). Normal: Balanced." />
          </div>

          <select
            className="spinInput"
            value={quality}
            onChange={(e) => setQuality(e.target.value as Quality)}
          >
            <option value="draft">Draft</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select>

          {/* Graphic answers to this too, and needs to.

              It used to be hidden here, on a measurement that said widening
              the window moved a logo's dark area by 0.2%. True, and the
              wrong thing to measure: the window's effect is at the
              boundaries. Where two tones meet and a third tone's brightness
              lies between them, that third gets a band along the edge. The
              window sets how wide. Narrow, and the band comes out thinner
              than a mesh cell, which the surface cannot carry — it breaks
              into slivers and the edge reads as a comb. Wide, and the band
              resolves cleanly but is visibly there.

              Measured on the Rolex mark, hexagon at 80mm: at 1.0 the gold
              band along a letter is 0.245mm against a 0.156mm cell and
              combs; at 3.0 it is 0.64mm and comes out clean. Neither is
              free, so it is a choice, and it belongs to whoever is looking
              at the print. */}
          <>
            <div className="label-row" style={{ marginTop: 12 }}>
              <label className="miniLabel">Edge Smoothing</label>
              <InfoIcon text="Widens sampling beyond one mesh cell. Low keeps edges crisp but hard edges come out stair-stepped; high trades a little sharpness for clean edges. Photos ~1, logos and line art 1.5-3. Costs no extra triangles." />
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <input
                className="range"
                type="range"
                min={0.4}
                max={3}
                step={0.1}
                value={smoothing}
                onChange={(e) => setSmoothing(+Number(e.target.value).toFixed(1))}
              />
              <div className="spinRow">
                <input
                  className="spinInput"
                  type="number"
                  min={0.4}
                  max={3}
                  step={0.1}
                  value={smoothing}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isNaN(v)) {
                      setSmoothing(+Math.max(0.4, Math.min(3, v)).toFixed(1));
                    }
                  }}
                />
                <div className="spinBtns">
                  <button
                    className="spinBtn"
                    onClick={() => setSmoothing((v) => +Math.min(3, v + 0.1).toFixed(1))}
                  >
                    ▲
                  </button>
                  <button
                    className="spinBtn"
                    onClick={() => setSmoothing((v) => +Math.max(0.4, v - 0.1).toFixed(1))}
                  >
                    ▼
                  </button>
                </div>
              </div>
            </div>
          </>

        </div>

        <div style={{ padding: "10px 0" }}>
          <button
            className="primaryBtn"
            style={{ width: "100%", opacity: isGenerating ? 0.7 : 1 }}
            onClick={() => generate(true)}
            disabled={isGenerating}
          >
            {isGenerating ? "Processing..." : "Generate STL"}
          </button>

          <button
            className="btn"
            style={{ width: "100%", marginTop: 8, justifyContent: "center" }}
            onClick={() => generate(false)}
            disabled={isGenerating}
            title="Build the model and show it in 3D without downloading"
          >
            Preview in 3D
          </button>

          {statusMsg && (
            <div
              className={`status-msg ${
                statusMsg.type === "error" ? "status-error" : "status-success"
              }`}
            >
              {statusMsg.text}
            </div>
          )}
        </div>

        <div className="dynamic-footer">{footerText}</div>
      </aside>

      <main className="rightPanel">
        <div
          className="previewCard"
          style={{
            height: "100%",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            minHeight: 0,
          }}
        >
          <div className="previewHeader">
            <div className="viewTabs">
              <button
                className={`viewTab ${view === "editor" ? "active" : ""}`}
                onClick={() => setView("editor")}
              >
                Image Editor
              </button>
              <button
                className={`viewTab ${view === "preview" ? "active" : ""}`}
                onClick={() => setView("preview")}
              >
                3D Preview
              </button>
            </div>

            {view === "editor" && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  marginRight: 10,
                }}
              >
                <label
                  className="shadeToggle"
                  title={`Rotation lands on multiples of ${ROTATION_SNAP_DEG}° — both the crop box's handle and the rotation slider below. Off, either is free.`}
                >
                  <input
                    type="checkbox"
                    checked={snapRotation}
                    onChange={(e) => setSnapRotation(e.target.checked)}
                  />
                  Snap {ROTATION_SNAP_DEG}°
                </label>

                <label
                  className="shadeToggle"
                  title="Fills anything the photo does not cover. Leave it white so bare areas print thin and let light through — otherwise they come out as the thickest, most opaque part of the model."
                >
                  Backdrop
                  <ColorField
                    value={bgColor}
                    onChange={setBgColor}
                    presets={colors}
                    onPick={() => armPicker("backdrop")}
                  />
                </label>
              </div>
            )}

            {view === "preview" && (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {previewStale && <span className="staleChip">out of date</span>}
                <label
                  className="shadeToggle"
                  title="Draw every triangle in one tone, the way a slicer does, so the mesh's real facets are visible. Off smooths the normals."
                >
                  <input
                    type="checkbox"
                    checked={flatShading}
                    onChange={(e) => setFlatShading(e.target.checked)}
                  />
                  Flat shading
                </label>
                <label className="shadeToggle">
                  <input
                    type="checkbox"
                    checked={lightBackground}
                    onChange={(e) => setLightBackground(e.target.checked)}
                  />
                  Light background
                </label>
                <label className="shadeToggle">
                  <input
                    type="checkbox"
                    checked={showGrid}
                    onChange={(e) => setShowGrid(e.target.checked)}
                  />
                  Grid
                </label>
              </div>
            )}
          </div>

          {view === "editor" && (
            <div className="paintBar">
              {tool === "pick" && (
                <span className="paintArmed">
                  Click the picture to take{" "}
                  {pickInto === "backdrop" ? "the backdrop" : "the brush"} colour
                </span>
              )}

              <div className="toolRow">
                {TOOLS.map((t) => (
                  <button
                    key={t.id}
                    className={`segment toolBtn ${tool === t.id ? "active" : ""}`}
                    onClick={() => setTool(t.id)}
                    title={t.hint}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Every setting is always here, greyed when the tool has no use
                  for it. Showing only what applies made the row rearrange
                  itself under the pointer every time a tool was picked. */}
              <div className="paintSet" title="Brush colour. White prints thin, dark prints thick.">
                <ColorField
                  value={paintColor}
                  onChange={setPaintColor}
                  disabled={tool === "crop" || tool === "erase"}
                  presets={colors}
                  onPick={() => armPicker("brush")}
                />
              </div>

              <label className="paintSet" title={`Brush and outline width: ${paintSize} px`}>
                <span className="paintTag">Size</span>
                <input
                  className="range paintRange"
                  type="range"
                  min={2}
                  max={160}
                  step={1}
                  value={paintSize}
                  disabled={tool === "crop" || tool === "fill" || tool === "pick" || tool === "text"}
                  onChange={(e) => setPaintSize(Number(e.target.value))}
                />
              </label>

              <label className="paintSet" title={`How much shows through: ${Math.round(opacity * 100)}%`}>
                <span className="paintTag">Opacity</span>
                <input
                  className="range paintRange"
                  type="range"
                  min={5}
                  max={100}
                  step={5}
                  value={Math.round(opacity * 100)}
                  disabled={tool === "crop" || tool === "pick"}
                  onChange={(e) => setOpacity(Number(e.target.value) / 100)}
                />
              </label>

              <label className="paintSet" title={`How far the edge is feathered: ${Math.round(softness * 100)}%`}>
                <span className="paintTag">Soft</span>
                <input
                  className="range paintRange"
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={Math.round(softness * 100)}
                  disabled={tool === "crop" || tool === "fill" || tool === "pick"}
                  onChange={(e) => setSoftness(Number(e.target.value) / 100)}
                />
              </label>

              <label className="paintSet" title={`How far a fill spreads into neighbouring colours: ${fillTolerance}`}>
                <span className="paintTag">Spread</span>
                <input
                  className="range paintRange"
                  type="range"
                  min={0}
                  max={160}
                  step={2}
                  value={fillTolerance}
                  disabled={tool !== "fill"}
                  onChange={(e) => setFillTolerance(Number(e.target.value))}
                />
              </label>

              <label className="paintSet shadeToggle" title="Boxes and ovals come out solid, or as an outline of the brush's width.">
                <input
                  type="checkbox"
                  checked={shapeFill}
                  disabled={tool !== "rect" && tool !== "ellipse"}
                  onChange={(e) => setShapeFill(e.target.checked)}
                />
                <span>Solid</span>
              </label>

              <span className="paintDiv" />

              <button
                className={`segment toolBtn ${tool === TEXT_TOOL.id ? "active" : ""}`}
                onClick={() => setTool(TEXT_TOOL.id)}
                title={TEXT_TOOL.hint}
              >
                {TEXT_TOOL.label}
              </button>

              <label className="paintSet" title={`Text size: ${fontSize} px`}>
                <span className="paintTag">Size</span>
                <input
                  className="range paintRange"
                  type="range"
                  min={8}
                  max={300}
                  step={2}
                  value={fontSize}
                  disabled={tool !== "text"}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                />
              </label>

              <label className="paintSet" title="Typeface for the text tool">
                <span className="paintTag">Font</span>
                <select
                  className="paintFont"
                  value={fontFamily}
                  disabled={tool !== "text"}
                  onChange={(e) => setFontFamily(e.target.value)}
                >
                  {FONTS.map((name) => (
                    <option key={name} value={name} style={{ fontFamily: name }}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>

              <span className="paintDiv" />

              <div className="paintEnd">
                <button className="autoBtn" onClick={() => editorRef.current?.undoPaint()} title="Step back">
                  Undo
                </button>
                <button className="autoBtn" onClick={() => editorRef.current?.redoPaint()} title="Step forward again">
                  Redo
                </button>
                <button className="autoBtn" onClick={() => editorRef.current?.clearPaint()} title="Take all the paint off">
                  Clear
                </button>
              </div>
            </div>
          )}

          {/* Both stay mounted: the editor owns the crop, and remounting the
              WebGL context on every tab switch is wasteful. */}
          <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
            <div
              style={{
                position: "absolute",
                inset: 0,
                visibility: view === "editor" ? "visible" : "hidden",
              }}
            >
              <ImageEditor
                ref={editorRef}
                image={imgEl}
                cropRatio={cropRatio}
                freeRatio={shape.freeRatio}
                onCropRatioChange={handleCropRatio}
                shapeId={shapeId}
                rotate={rotate}
                flipH={flipH}
                flipV={flipV}
                bgColor={bgColor}
                detail={traceDetail}
                tool={tool}
                paintColor={paintColor}
                paintSize={paintSize}
                fillTolerance={fillTolerance}
                shapeFill={shapeFill}
                opacity={opacity}
                softness={softness}
                fontFamily={fontFamily}
                fontSize={fontSize}
                onPickColor={(hex) => {
                  if (pickInto === "backdrop") setBgColor(hex);
                  else setPaintColor(hex);
                  setTool(pickReturn.current);
                }}
                frameMm={frameMm}
                widthMm={widthMm}
                snapDeg={snapRotation ? ROTATION_SNAP_DEG : 0}
                onImageData={handleImageData}
              />
            </div>

            <div
              style={{
                position: "absolute",
                inset: 0,
                visibility: view === "preview" ? "visible" : "hidden",
              }}
            >
              {(view === "preview" || previewMesh) && (
                <React.Suspense
                  fallback={<div className="preview-empty">Loading viewer…</div>}
                >
                  <MeshPreview
                    mesh={previewMesh}
                    flatShading={flatShading}
                    lightBackground={lightBackground}
                    showGrid={showGrid}
                  />
                </React.Suspense>
              )}

              {previewStale && (
                <div className="staleBanner">
                  Settings changed since this was built — press{" "}
                  <strong>Preview in 3D</strong> to rebuild.
                </div>
              )}
            </div>
          </div>

          {view === "editor" && (
          <ImageControls
            rotate={rotate}
            setRotate={setRotate}
            flipH={flipH}
            setFlipH={setFlipH}
            flipV={flipV}
            setFlipV={setFlipV}
            snapDeg={snapRotation ? ROTATION_SNAP_DEG : 0}
            onReset={() => {
              setRotate(0);
              setFlipH(false);
              setFlipV(false);
              editorRef.current?.reset();
            }}
          />
          )}
        </div>
      </main>

      {accountOpen && (
        <div className="modalBackdrop" onClick={() => setAccountOpen(false)}>
          <div className="modalCard" onClick={(e) => e.stopPropagation()}>
            <div className="modalTitle">
              {accountMode === "in" ? "Sign in" : "Make an account"}
            </div>

            <div className="googleSlot" ref={googleSlot} />

            <div className="orRule"><span>or</span></div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!accountBusy) submitAccount();
              }}
            >
              <input
                className="spinInput"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={accountEmail}
                onChange={(e) => setAccountEmail(e.target.value)}
                style={{ marginBottom: 8 }}
              />
              <input
                className="spinInput"
                type="password"
                autoComplete={accountMode === "in" ? "current-password" : "new-password"}
                placeholder={accountMode === "in" ? "Password" : "Password, eight or more"}
                value={accountPass}
                onChange={(e) => setAccountPass(e.target.value)}
              />

              {accountError && <div className="accountError">{accountError}</div>}

              <div className="modalActions" style={{ marginTop: 14 }}>
                <button className="btn" type="submit" disabled={accountBusy}>
                  {accountBusy
                    ? "…"
                    : accountMode === "in"
                      ? "Sign in"
                      : "Create"}
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    setAccountMode(accountMode === "in" ? "up" : "in");
                    setAccountError(null);
                  }}
                >
                  {accountMode === "in" ? "I need an account" : "I have one"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {flatHintOpen && (
        <div className="modalBackdrop" onClick={() => setFlatHintOpen(false)}>
          <div className="modalCard" onClick={(e) => e.stopPropagation()}>
            <div className="modalTitle">Print this one flat?</div>
            <p className="modalBody">
              Standing up, the colour bands run through the model's depth, so
              every layer contains all of them and the printer changes filament
              on <em>each layer</em>.
              <br />
              <br />
              Laid flat, the bands stack along the print axis instead — each one
              becomes a contiguous run of layers, so it is a single change per
              band. That is also what makes the layer numbers here line up with
              your slicer.
            </p>

            <div className="modalActions">
              <button
                className="primaryBtn"
                onClick={() => {
                  setOrientation("flat");
                  setFlatHintOpen(false);
                }}
              >
                Switch to flat
              </button>
              <button
                className="btn"
                style={{ justifyContent: "center" }}
                onClick={() => setFlatHintOpen(false)}
              >
                Keep vertical
              </button>
            </div>

            <button
              className="linkBtn"
              onClick={() => {
                localStorage.setItem(FLAT_HINT_KEY, "1");
                setFlatHintOpen(false);
              }}
            >
              Don't show this again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}