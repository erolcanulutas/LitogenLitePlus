import { useRef, type KeyboardEvent, type PointerEvent } from "react";

type Props = {
  /** Layers through the whole thickness. The track spans layer 1 to this. */
  totalLayers: number;
  /** Last layer of every band but the topmost, ascending. */
  splitLayers: number[];
  /** One colour per band, so one more than splitLayers. */
  colors: string[];
  /** Slicer layer height, for the millimetre readout. */
  layerHeight: number;
  /** Move boundary `index` to `layer`. The caller does the clamping. */
  onMoveSplit: (index: number, layer: number) => void;
  onColor: (band: number, value: string) => void;
  /** Drop boundary `index`, merging the band above it into the one below. */
  onRemoveSplit: (index: number) => void;
};

/**
 * The colour bands, drawn as the stack they actually are.
 *
 * This replaces a list of numeric fields, which left the reader to hold the
 * mapping from layer numbers onto a physical stack in their head — and listed
 * the base band first, the opposite way round from the print. Here the track
 * is the model's thickness: the bottom is the flat back, the top carries the
 * relief, every boundary is a knob to drag, and the colour between two knobs
 * is that band's own.
 */
export default function BandSlider({
  totalLayers,
  splitLayers,
  colors,
  layerHeight,
  onMoveSplit,
  onColor,
  onRemoveSplit,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<number | null>(null);

  const pct = (layer: number) => (layer / totalLayers) * 100;
  const mm = (layer: number) => (layer * layerHeight).toFixed(2);

  /** Layer under the pointer. The track runs bottom-up: layer 1 on the floor. */
  const layerAtY = (clientY: number): number => {
    const el = trackRef.current;
    if (!el) return 1;
    const r = el.getBoundingClientRect();
    if (r.height <= 0) return 1;
    return Math.round((1 - (clientY - r.top) / r.height) * totalLayers);
  };

  const startDrag = (e: PointerEvent<HTMLDivElement>, index: number) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = index;
  };

  const onDrag = (e: PointerEvent<HTMLDivElement>) => {
    const index = dragRef.current;
    if (index === null) return;
    onMoveSplit(index, layerAtY(e.clientY));
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current === null) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>, index: number) => {
    const step =
      e.key === "ArrowUp" ? 1
      : e.key === "ArrowDown" ? -1
      : e.key === "PageUp" ? 5
      : e.key === "PageDown" ? -5
      : 0;

    if (step === 0) return;
    e.preventDefault();
    onMoveSplit(index, splitLayers[index] + step);
  };

  return (
    <div className="bandSlider">
      <div className="bandEnd bandEndTop">
        top · layer {totalLayers} · {mm(totalLayers)} mm
      </div>

      <div className="bandTrack" ref={trackRef}>
        {colors.map((color, b) => {
          const first = b === 0 ? 1 : splitLayers[b - 1] + 1;
          const last = b < splitLayers.length ? splitLayers[b] : totalLayers;
          const bottom = pct(first - 1);

          return (
            <div
              className="bandSeg"
              key={`seg${b}`}
              style={{
                bottom: `${bottom}%`,
                height: `${pct(last) - bottom}%`,
                background: color,
              }}
            >
              {/* Transparent, and stretched over the whole band: the picker
                  opens wherever the band is clicked, with no swatch to aim
                  at. The band itself is the swatch. */}
              <input
                className="bandSegPick"
                type="color"
                value={color}
                onChange={(e) => onColor(b, e.target.value)}
                title={`Band ${b + 1} · layers ${first}-${last} · click to recolour`}
              />
            </div>
          );
        })}

        {/* After the bands, so a knob sitting on a boundary stays on top. */}
        {splitLayers.map((layer, i) => (
          <div
            className="bandKnob"
            key={`knob${i}`}
            style={{ bottom: `${pct(layer)}%` }}
            onPointerDown={(e) => startDrag(e, i)}
            onPointerMove={onDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={(e) => onKey(e, i)}
            role="slider"
            tabIndex={0}
            aria-label={`Band ${i + 1} top layer`}
            aria-valuemin={i > 0 ? splitLayers[i - 1] + 1 : 1}
            aria-valuemax={
              i + 1 < splitLayers.length
                ? splitLayers[i + 1] - 1
                : totalLayers - 1
            }
            aria-valuenow={layer}
            aria-valuetext={`layer ${layer}, ${mm(layer)} mm`}
          >
            <span className="bandKnobPill">
              {layer} · {mm(layer)} mm
            </span>

            <button
              className="bandKnobDrop"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onRemoveSplit(i)}
              title="Remove this boundary"
              tabIndex={-1}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="bandEnd">base · layer 1</div>
    </div>
  );
}
