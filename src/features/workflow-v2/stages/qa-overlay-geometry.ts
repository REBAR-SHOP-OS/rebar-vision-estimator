export type BBox = [number, number, number, number];
export type Rect = { left: number; top: number; width: number; height: number };
export type BBoxMode = "pixel" | "normalized" | "percent" | "invalid";

export type NormalizedBbox = {
  bbox: BBox | null;
  mode: BBoxMode;
  reason: string;
};

const MIN_BBOX_SIZE_PX = 2;
const MAX_BBOX_AREA_RATIO = 0.3;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function ordered(raw: BBox): BBox {
  const [a, b, c, d] = raw.map(Number) as BBox;
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
}

function finiteBox(raw: BBox | null | undefined): BBox | null {
  if (!raw || raw.length !== 4) return null;
  const box = raw.map(Number);
  return box.every(Number.isFinite) ? ordered(box as BBox) : null;
}

function validatePixelBbox(bbox: BBox, imgW: number, imgH: number, mode: BBoxMode): NormalizedBbox {
  if (!imgW || !imgH) return { bbox: null, mode: "invalid", reason: "image size is unavailable" };

  const [x1, y1, x2, y2] = bbox;
  const w = x2 - x1;
  const h = y2 - y1;
  if (w < MIN_BBOX_SIZE_PX || h < MIN_BBOX_SIZE_PX) {
    return { bbox: null, mode: "invalid", reason: "anchor box is too small" };
  }

  const centerX = (x1 + x2) / 2;
  const centerY = (y1 + y2) / 2;
  if (centerX < 0 || centerX > imgW || centerY < 0 || centerY > imgH) {
    return { bbox: null, mode: "invalid", reason: "anchor box is outside the drawing page" };
  }

  if ((w * h) / (imgW * imgH) > MAX_BBOX_AREA_RATIO) {
    return { bbox: null, mode: "invalid", reason: "anchor box is too large to be a precise object" };
  }

  const clamped: BBox = [
    clamp(x1, 0, imgW),
    clamp(y1, 0, imgH),
    clamp(x2, 0, imgW),
    clamp(y2, 0, imgH),
  ];
  return clamped[2] > clamped[0] && clamped[3] > clamped[1]
    ? { bbox: clamped, mode, reason: "" }
    : { bbox: null, mode: "invalid", reason: "anchor box collapsed after clamping" };
}

export function normalizeBboxToImagePixels(
  raw: BBox | null | undefined,
  imgW: number,
  imgH: number,
): NormalizedBbox {
  const box = finiteBox(raw);
  if (!box) return { bbox: null, mode: "invalid", reason: "anchor box is missing or malformed" };

  const maxCoord = Math.max(...box.map(Math.abs));
  if (maxCoord <= 1) {
    return validatePixelBbox([box[0] * imgW, box[1] * imgH, box[2] * imgW, box[3] * imgH], imgW, imgH, "normalized");
  }

  if (maxCoord <= 100 && (imgW > 200 || imgH > 200)) {
    return validatePixelBbox([box[0] * imgW / 100, box[1] * imgH / 100, box[2] * imgW / 100, box[3] * imgH / 100], imgW, imgH, "percent");
  }

  return validatePixelBbox(box, imgW, imgH, "pixel");
}

export function computeFocusTransformForImage({
  bbox,
  imgW,
  imgH,
  pageBox,
  canvas,
  zoom,
  pan,
  toolbarSafeTop = 88,
}: {
  bbox: BBox | null;
  imgW: number;
  imgH: number;
  pageBox: Rect | null;
  canvas: { width: number; height: number };
  zoom: number;
  pan?: { dx: number; dy: number };
  toolbarSafeTop?: number;
}): { x: number; y: number; scale: number } {
  const scale = Math.max(0.1, zoom || 1);
  const safePan = pan ?? { dx: 0, dy: 0 };
  if (!bbox || !pageBox || !imgW || !imgH || !canvas.width || !canvas.height) {
    return { x: safePan.dx, y: safePan.dy, scale };
  }

  const focusX = pageBox.left + (((bbox[0] + bbox[2]) / 2) / imgW) * pageBox.width;
  const focusY = pageBox.top + (((bbox[1] + bbox[3]) / 2) / imgH) * pageBox.height;
  const targetViewportX = canvas.width / 2;
  const targetViewportY = toolbarSafeTop + Math.max(0, canvas.height - toolbarSafeTop) * 0.52;
  return clampTransformToVisiblePage(
    targetViewportX - focusX * scale + safePan.dx,
    targetViewportY - focusY * scale + safePan.dy,
    pageBox,
    canvas,
    scale,
  );
}

function clampTransformToVisiblePage(
  x: number,
  y: number,
  pageBox: Rect,
  canvas: { width: number; height: number },
  scale: number,
): { x: number; y: number; scale: number } {
  const pageLeft = pageBox.left * scale + x;
  const pageTop = pageBox.top * scale + y;
  const pageWidth = pageBox.width * scale;
  const pageHeight = pageBox.height * scale;
  const minVisible = 80;

  let nextX = x;
  let nextY = y;

  if (pageWidth <= canvas.width) {
    nextX += (canvas.width - pageWidth) / 2 - pageLeft;
  } else {
    const minLeft = canvas.width - minVisible - pageWidth;
    const maxLeft = minVisible;
    nextX += clamp(pageLeft, minLeft, maxLeft) - pageLeft;
  }

  if (pageHeight <= canvas.height) {
    nextY += (canvas.height - pageHeight) / 2 - pageTop;
  } else {
    const minTop = canvas.height - minVisible - pageHeight;
    const maxTop = minVisible;
    nextY += clamp(pageTop, minTop, maxTop) - pageTop;
  }

  return { x: nextX, y: nextY, scale };
}
