import type { ShapePlugin } from "../core/types";
import { TriangleShape } from "./triangle";
import { CircleShape } from "./circle";
import { HexagonShape } from "./hexagon";
import { PentagonShape } from "./pentagon";

export const SHAPES: ShapePlugin[] = [
  TriangleShape,
  CircleShape,
  HexagonShape,
  PentagonShape, 
];

export function getShape(id: string) {
  const s = SHAPES.find(s => s.id === id);
  if (!s) throw new Error(`Unknown shape: ${id}`);
  return s;
}
