import { type Dispatch, type SetStateAction } from "react";

type Props = {
  rotate: number;
  // DÜZELTME: setRotate artık hem sayı hem de fonksiyon alabilir
  setRotate: Dispatch<SetStateAction<number>>;
  flipH: boolean;
  setFlipH: (v: boolean) => void;
  flipV: boolean;
  setFlipV: (v: boolean) => void;
  /** Rotation step in degrees, or 0 to leave it free. */
  snapDeg: number;
  onReset: () => void;
};

export default function ImageControls({
  rotate,
  setRotate,
  flipH,
  setFlipH,
  flipV,
  setFlipV,
  snapDeg,
  onReset,
}: Props) {
  /** Nearest multiple of the step, or the value untouched when snapping is off. */
  const snap = (v: number) => (snapDeg > 0 ? Math.round(v / snapDeg) * snapDeg : v);

  return (
    <div
      className="panel"
      style={{
        padding: 14,
        display: "grid",
        gap: 12,
      }}
    >
      <div style={{ fontSize: 13, color: "var(--text-dim)" }}>
        Rotation: {Math.round(rotate)}°
        {snapDeg > 0 && ` · snapping to ${snapDeg}°`}
      </div>

      <input
        type="range"
        min={-180}
        max={180}
        step={snapDeg > 0 ? snapDeg : 1}
        value={rotate}
        // Range input her zaman string döndürür, number'a çeviriyoruz
        onChange={(e) => setRotate(snap(Number(e.target.value)))}
        className="range"
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
        {/* TypeScript artık bu fonksiyonel güncellemeyi kabul edecek */}
        <button className="btn" onClick={() => setRotate((r) => snap(r - 90))}>↺ CCW</button>
        <button className="btn" onClick={() => setRotate((r) => snap(r + 90))}>↻ CW</button>
        <button className="btn" onClick={() => setFlipH(!flipH)}>⇄ H Flip</button>
        <button className="btn" onClick={() => setFlipV(!flipV)}>⇅ V Flip</button>
      </div>

      <button className="btn" onClick={onReset}>Reset All</button>
    </div>
  );
}