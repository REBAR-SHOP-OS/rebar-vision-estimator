export type ManualShape = "square" | "circle";

const DEFAULT_RADIUS = 0.022;
const DEFAULT_CIRCLE_SIDES = 20;

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

export function createSquarePolygon(centerX: number, centerY: number, radius = DEFAULT_RADIUS): Array<[number, number]> {
  const x1 = clamp01(centerX - radius);
  const y1 = clamp01(centerY - radius);
  const x2 = clamp01(centerX + radius);
  const y2 = clamp01(centerY + radius);
  return [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2],
  ];
}

export function createCirclePolygon(
  centerX: number,
  centerY: number,
  radius = DEFAULT_RADIUS,
  sides = DEFAULT_CIRCLE_SIDES,
): Array<[number, number]> {
  const n = Math.max(8, Math.floor(sides || DEFAULT_CIRCLE_SIDES));
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    out.push([
      clamp01(centerX + Math.cos(t) * radius),
      clamp01(centerY + Math.sin(t) * radius),
    ]);
  }
  return out;
}

export function createManualShapePolygon(shape: ManualShape, centerX: number, centerY: number): Array<[number, number]> {
  return shape === "square"
    ? createSquarePolygon(centerX, centerY)
    : createCirclePolygon(centerX, centerY);
}
