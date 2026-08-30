import { useEffect, useRef, useState } from "react";

/**
 * A colour swatch that opens a picker of our own.
 *
 * `<input type="color">` hands the job to the operating system, and on Windows
 * that is a dialog with no eyedropper, no hex field worth the name and a
 * sixteen-square palette from 1995. This is the usual saturation-and-value
 * square with a hue strip under it, a hex box, and a row of the colours this
 * program actually reaches for.
 */

type Props = {
  value: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
  title?: string;
  /** Extra colours to offer, on top of the fixed row — the picture's tones. */
  presets?: string[];
  /**
   * What to do when the browser has no eyedropper of its own.
   *
   * Chrome and Edge can sample any pixel on the screen and are the right thing
   * to use where they exist. Everywhere else this falls back to whatever the
   * caller offers, which here means switching to the Pick tool.
   */
  onPickFallback?: () => void;
};

const FIXED = [
  "#000000", "#404040", "#808080", "#c0c0c0", "#ffffff",
  "#e11d48", "#ea580c", "#eab308", "#16a34a", "#0ea5e9", "#6366f1", "#a855f7",
];

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function toHex(r: number, g: number, b: number) {
  const two = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${two(r)}${two(g)}${two(b)}`;
}

function hsvToHex(h: number, s: number, v: number) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  return toHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

function hexToHsv(hex: string): { h: number; s: number; v: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;

  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export default function ColorField({
  value,
  onChange,
  disabled,
  title,
  presets,
  onPickFallback,
}: Props) {
  const [open, setOpen] = useState(false);
  const [hue, setHue] = useState(() => hexToHsv(value)?.h ?? 0);
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  const rootRef = useRef<HTMLDivElement>(null);

  // Caught up during the render that brings a new colour in, rather than in an
  // effect afterwards, so there is never a frame showing the old one.
  //
  // The hue of a grey is meaningless, so following it would swing the strip to
  // red and change the colour the moment anything else was touched. Only a
  // value with a hue of its own moves the strip.
  if (value !== seen) {
    setSeen(value);
    setText(value);
    const hsv = hexToHsv(value);
    if (hsv && hsv.s > 0.02) setHue(hsv.h);
  }

  useEffect(() => {
    if (!open) return;

    const away = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const hsv = hexToHsv(value) ?? { h: 0, s: 0, v: 0 };

  const pickFromSquare = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const s = clamp01((e.clientX - r.left) / r.width);
    const v = 1 - clamp01((e.clientY - r.top) / r.height);
    onChange(hsvToHex(hue, s, v));
  };

  const dragSquare = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pickFromSquare(e);
  };

  return (
    <div className="colorField" ref={rootRef}>
      <button
        type="button"
        className="paintSwatch"
        style={{ background: value }}
        disabled={disabled}
        title={title}
        onClick={() => setOpen((v) => !v)}
      />

      {open && !disabled && (
        <div className="colorPop">
          <div
            className="colorSquare"
            style={{ background: hsvToHex(hue, 1, 1) }}
            onPointerDown={dragSquare}
            onPointerMove={(e) => {
              if (e.buttons === 1) pickFromSquare(e);
            }}
          >
            <div className="colorSquareWhite" />
            <div className="colorSquareBlack" />
            <div
              className="colorDot"
              style={{
                left: `${hsv.s * 100}%`,
                top: `${(1 - hsv.v) * 100}%`,
              }}
            />
          </div>

          <input
            className="colorHue"
            type="range"
            min={0}
            max={359}
            value={Math.round(hue)}
            onChange={(e) => {
              const h = Number(e.target.value);
              setHue(h);
              onChange(hsvToHex(h, Math.max(hsv.s, 0.02), Math.max(hsv.v, 0.02)));
            }}
          />

          <div className="colorRow">
            <input
              className="colorHex"
              value={text}
              spellCheck={false}
              onChange={(e) => {
                setText(e.target.value);
                const hex = e.target.value.trim();
                if (/^#?[0-9a-f]{6}$/i.test(hex)) {
                  onChange(hex.startsWith("#") ? hex : `#${hex}`);
                }
              }}
            />
            <button
              type="button"
              className="colorDrop"
              title="Take a colour off the screen"
              onClick={async () => {
                type Dropper = { open: () => Promise<{ sRGBHex: string }> };
                const Ctor = (window as unknown as {
                  EyeDropper?: new () => Dropper;
                }).EyeDropper;

                if (!Ctor) {
                  setOpen(false);
                  onPickFallback?.();
                  return;
                }
                try {
                  const got = await new Ctor().open();
                  if (got?.sRGBHex) onChange(got.sRGBHex);
                } catch {
                  // Cancelled with Escape, which is not a failure.
                }
              }}
            >
              ⌖
            </button>
          </div>

          <div className="colorPresets">
            {[...(presets ?? []), ...FIXED].map((c, i) => (
              <button
                key={`${c}-${i}`}
                type="button"
                className="colorPreset"
                style={{ background: c }}
                title={c}
                onClick={() => onChange(c)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
