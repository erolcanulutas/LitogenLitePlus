import { useRef, type KeyboardEvent, type PointerEvent } from "react";

type Props = {
  /** Layers through the whole thickness. The track spans layer 1 to this. */
  totalLayers: number;
  /** Last layer of every band but the topmost, ascending. */
  splitLayers: number[];
  /** One colour per band, so one more than splitLayers. */
  colors: string[];
  /** Slicer layer height, for the millimetre readouts. */
  layerHeight: number;
  /** Surface height of each tone, in layers, darkest first. Graphic only. */
  toneLayers: number[];
  /** Whether the surface is cut into tones at all. */
  showTones: boolean;
  /**
   * Layer the flat frame band tops out at, or null when there is no frame.
   *
   * It is a height the surface stops at just as a tone is, and it takes the
   * colour of whichever band it lands in — but it is set by the frame, not by
   * the picture, so it is shown and not dragged. Leaving it out made the tone
   * count look wrong: four tones, five heights in the exported model.
   */
  frameLayer: number | null;
  /** Bands no tone reaches, so their colour cannot show. */
  buried: readonly number[];
  /** Move boundary `index` to `layer`. The caller does the clamping. */
  onMoveSplit: (index: number, layer: number) => void;
  /** Move tone `index` to `layer`. The caller does the clamping. */
  onMoveTone: (index: number, layer: number) => void;
  onColor: (band: number, value: string) => void;
  /** Drop boundary `index`, merging the band above it into the one below. */
  onRemoveSplit: (index: number) => void;
};

/**
 * The colour bands and the tones, against the one axis they share.
 *
 * Both are heights through the model's thickness, and the whole difficulty of
 * a multicolour graphic is getting them to line up: a tone shows the colour of
 * whichever band its surface ends inside. Reading that off two controls in
 * different parts of the panel meant holding both sets of numbers in your
 * head, so they are on the same track — tones down the left in dashed amber,
 * colour boundaries across the full width with their layer and millimetre
 * beside the button that removes them.
 */
export default function BandSlider({
  totalLayers,
  splitLayers,
  colors,
  layerHeight,
  toneLayers,
  showTones,
  frameLayer,
  buried,
  onMoveSplit,
  onMoveTone,
  onColor,
  onRemoveSplit,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  /** Which marker is being dragged: a colour boundary or a tone. */
  const dragRef = useRef<{ kind: "split" | "tone"; index: number } | null>(null);

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

  const startDrag = (
    e: PointerEvent<HTMLDivElement>,
    kind: "split" | "tone",
    index: number,
  ) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { kind, index };
  };

  const onDrag = (e: PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const layer = layerAtY(e.clientY);
    if (d.kind === "split") onMoveSplit(d.index, layer);
    else onMoveTone(d.index, layer);
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const stepOf = (e: KeyboardEvent<HTMLDivElement>) =>
    e.key === "ArrowUp"
      ? 1
      : e.key === "ArrowDown"
        ? -1
        : e.key === "PageUp"
          ? 5
          : e.key === "PageDown"
            ? -5
            : 0;

  return (
    <div className="bandSlider">
      {/*
        The frame is a height the surface stops at, the same as a tone is, and
        leaving it unnamed made the count look wrong: four tones, five plateaus
        in the exported model. It sits at the very top, one layer from the
        topmost tone, so it is named on the axis rather than marked inside the
        track where the two labels would sit on each other.
      */}
      <div
        className={`bandEnd bandEndTop${frameLayer !== null ? " bandEndFrame" : ""}`}
      >
        {frameLayer !== null ? "Frame" : "Top"} · layer {totalLayers} ·{" "}
        {mm(totalLayers)} mm
      </div>

      <div className="bandTrack" ref={trackRef}>
        {colors.map((color, b) => {
          const first = b === 0 ? 1 : splitLayers[b - 1] + 1;
          const last = b < splitLayers.length ? splitLayers[b] : totalLayers;
          const bottom = pct(first - 1);
          const hidden = buried.includes(b);

          return (
            <div
              className={`bandSeg${hidden ? " bandSegBuried" : ""}`}
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
                title={
                  `Band ${b + 1} · layers ${first}-${last} · click to recolour` +
                  (hidden
                    ? " · no tone ends inside this band, so its colour cannot show"
                    : "")
                }
              />
            </div>
          );
        })}

        {/* Tones keep to the left half, so the two sets of grips never fight
            over the same pointer even at the same height. */}
        {showTones &&
          toneLayers.map((layer, k) => (
            <div
              className="toneMark"
              key={`tone${k}`}
              style={{ bottom: `${pct(layer)}%` }}
              onPointerDown={(e) => startDrag(e, "tone", k)}
              onPointerMove={onDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={(e) => {
                const s = stepOf(e);
                if (s === 0) return;
                e.preventDefault();
                onMoveTone(k, layer + s);
              }}
              role="slider"
              tabIndex={0}
              aria-label={`Tone ${k + 1} thickness`}
              aria-valuemin={1}
              aria-valuemax={totalLayers}
              aria-valuenow={layer}
              aria-valuetext={`layer ${layer}, ${mm(layer)} mm`}
              title={`Tone ${k + 1}${
                k === 0 ? " (darkest)" : k === toneLayers.length - 1 ? " (lightest)" : ""
              } tops out at ${mm(layer)} mm · drag to change`}
            >
              <span className="toneMarkPill">
                T{k + 1} · {mm(layer)} mm
              </span>
              <span className="toneMarkRule" />
            </div>
          ))}

        {/* After the bands, so a boundary sitting on one stays on top. */}
        {splitLayers.map((layer, i) => (
          <div
            className="bandKnob"
            key={`knob${i}`}
            style={{ bottom: `${pct(layer)}%` }}
          >
            <div
              className="bandKnobGrab"
              onPointerDown={(e) => startDrag(e, "split", i)}
              onPointerMove={onDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={(e) => {
                const s = stepOf(e);
                if (s === 0) return;
                e.preventDefault();
                onMoveSplit(i, layer + s);
              }}
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
          </div>
        ))}
      </div>

      <div className="bandEnd">Base · layer 1</div>
    </div>
  );
}
