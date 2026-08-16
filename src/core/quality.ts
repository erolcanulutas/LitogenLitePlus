export type Quality = "draft" | "normal" | "high";

export type QualityParams = {
  angMul: number;      // angular density multiplier
  radial: number;      // radial subdivisions
  ringAngMax: number;  // max angular segments for ring
};

export function qualityParams(q: Quality): QualityParams {
  switch (q) {
    case "draft":
      // unchanged – fast, small STL
      return {
        angMul: 0.8,
        radial: 80,
        ringAngMax: 480,
      };

    case "high":
      // NEW: 2× previous high
      return {
        angMul: 2.8,     // was 1.4 → now 2×
        radial: 360,     // was 180 → now 2×
        ringAngMax: 2800 // was 1400 → now 2×
      };

    case "normal":
    default:
      // NEW: this is the OLD high
      return {
        angMul: 1.4,
        radial: 180,
        ringAngMax: 1400,
      };
  }
}
