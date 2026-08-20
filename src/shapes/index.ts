import type { ShapePlugin } from "../core/types";
import { TriangleShape } from "./triangle";
import { CircleShape } from "./circle";
import { HexagonShape } from "./hexagon";
import { PentagonShape } from "./pentagon";
import { RectangleShape } from "./rectangle";

export const SHAPES: ShapePlugin[] = [
  TriangleShape,
  CircleShape,
  HexagonShape,
  PentagonShape,
  RectangleShape,
];

export function getShape(id: string) {
  const s = SHAPES.find(s => s.id === id);
  if (!s) throw new Error(`Unknown shape: ${id}`);
  return s;
}
