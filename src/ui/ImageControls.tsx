import { type Dispatch, type SetStateAction } from "react";

type Props = {
  rotate: number;
  // DÜZELTME: setRotate artık hem sayı hem de fonksiyon alabilir
  setRotate: Dispatch<SetStateAction<number>>;
  flipH: boolean;
  setFlipH: (v: boolean) => void;
  flipV: boolean;
  setFlipV: (v: boolean) => void;
  onReset: () => void;
};

export default function ImageControls({
  rotate,
  setRotate,
  flipH,
  setFlipH,
  flipV,
  setFlipV,
  onReset,
}: Props) {
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
      </div>

      <input
        type="range"
        min={-180}
        max={180}
        value={rotate}
        // Range input her zaman string döndürür, number'a çeviriyoruz
        onChange={(e) => setRotate(Number(e.target.value))}
        className="range"
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
        {/* TypeScript artık bu fonksiyonel güncellemeyi kabul edecek */}
        <button className="btn" onClick={() => setRotate((r) => r - 90)}>↺ CCW</button>
        <button className="btn" onClick={() => setRotate((r) => r + 90)}>↻ CW</button>
        <button className="btn" onClick={() => setFlipH(!flipH)}>⇄ H Flip</button>
        <button className="btn" onClick={() => setFlipV(!flipV)}>⇅ V Flip</button>
      </div>

      <button className="btn" onClick={onReset}>Reset All</button>
    </div>
  );
}