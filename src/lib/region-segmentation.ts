/**
 * Client-side color-region segmentation for rendered drawing pages.
 *
 * Detects Togal-style colored fills on a rasterized sheet: ignores
 * near-white background and near-black linework/text, quantizes the
 * remaining pixels by hue, then connected-component-labels each hue
 * bucket and traces a simplified outer contour per blob.
 *
 * Pure helper — no React, no Supabase. Returns polygons in normalized
 * 0..1 coords matching the SVG viewBox already used by TakeoffCanvas.
 */

export interface Region {
  id: string;
  /** Approximate hsl() fill of the blob. */
  color: string;
  /** Hue in degrees (0..360), -1 if achromatic. */
  hueDeg: number;
  /** Outline polygon, normalized 0..1 ([x, y][]). */
  polygon: Array<[number, number]>;
  /** Fraction of total page area covered. */
  areaPct: number;
  /** Normalized bbox. */
  bbox: { x: number; y: number; w: number; h: number };
  /** Normalized centroid. */
  centroid: [number, number];
}

export interface DetectOpts {
  /** Longest side downsample target. */
  maxDim?: number;
  /** Drop blobs smaller than this fraction of total pixels. */
  minAreaPct?: number;
  /** Number of hue buckets. */
  hueBuckets?: number;
  /** Min saturation to count as "colored". 0..1. */
  minSat?: number;
  /** Luminance window (V in HSV). */
  minVal?: number;
  maxVal?: number;
}

const DEFAULTS: Required<DetectOpts> = {
  maxDim: 1024,
  minAreaPct: 0.002,
  hueBuckets: 12,
  minSat: 0.18,
  minVal: 0.30,
  maxVal: 0.97,
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return [h, s, max];
}

/** Moore-neighborhood outer contour trace of a binary mask starting at (sx,sy). */
function traceContour(
  mask: Uint8Array,
  w: number,
  h: number,
  sx: number,
  sy: number,
): Array<[number, number]> {
  const dirs: Array<[number, number]> = [
    [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
  ];
  const pts: Array<[number, number]> = [];
  let cx = sx, cy = sy, dir = 0;
  const maxIter = 4 * (w + h);
  let iter = 0;
  do {
    pts.push([cx, cy]);
    let found = false;
    for (let k = 0; k < 8; k++) {
      const nd = (dir + 6 + k) % 8;
      const [dx, dy] = dirs[nd];
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (mask[ny * w + nx]) {
        cx = nx; cy = ny; dir = nd; found = true; break;
      }
    }
    if (!found) break;
    iter++;
    if (iter > maxIter) break;
  } while (!(cx === sx && cy === sy) || pts.length < 2);
  return pts;
}

/** Iterative Douglas–Peucker. */
function simplify(points: Array<[number, number]>, epsilon: number): Array<[number, number]> {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = 0, idx = -1;
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const t = ((px - ax) * dx + (py - ay) * dy) / len2;
      const tx = ax + t * dx, ty = ay + t * dy;
      const d = Math.hypot(px - tx, py - ty);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > epsilon && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out: Array<[number, number]> = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

export async function detectRegions(imageUrl: string, opts: DetectOpts = {}): Promise<Region[]> {
  const o = { ...DEFAULTS, ...opts };
  if (typeof document === "undefined") return [];
  const img = await loadImage(imageUrl);
  const longest = Math.max(img.naturalWidth, img.naturalHeight) || o.maxDim;
  const scale = Math.min(1, o.maxDim / longest);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0, w, h);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return []; // CORS-tainted
  }

  const N = w * h;
  // Assign bucket per pixel: 0 = ignore, 1..hueBuckets = color bucket index.
  const bucket = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const [hh, ss, vv] = rgbToHsv(r, g, b);
    if (ss < o.minSat || vv < o.minVal || vv > o.maxVal) continue;
    const bi = Math.floor((hh / 360) * o.hueBuckets) % o.hueBuckets;
    bucket[i] = bi + 1;
  }

  const visited = new Uint8Array(N);
  const regions: Region[] = [];
  const minPixels = Math.max(32, Math.floor(N * o.minAreaPct));
  const stackX = new Int32Array(N);
  const stackY = new Int32Array(N);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (visited[idx] || !bucket[idx]) continue;
      const target = bucket[idx];
      // BFS / iterative flood fill (4-connected).
      let sp = 0;
      stackX[sp] = x; stackY[sp] = y; sp++;
      visited[idx] = 1;
      let count = 0;
      let sumR = 0, sumG = 0, sumB = 0;
      let minX = x, maxX = x, minY = y, maxY = y;
      let sumCx = 0, sumCy = 0;
      const mask = new Uint8Array(N); // local mask for contour trace
      mask[idx] = 1;
      while (sp > 0) {
        sp--;
        const cx = stackX[sp], cy = stackY[sp];
        count++;
        const pi = (cy * w + cx) * 4;
        sumR += data[pi]; sumG += data[pi + 1]; sumB += data[pi + 2];
        sumCx += cx; sumCy += cy;
        if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
        const neigh = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
        for (const [nx, ny] of neigh) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (visited[ni] || bucket[ni] !== target) continue;
          visited[ni] = 1;
          mask[ni] = 1;
          stackX[sp] = nx; stackY[sp] = ny; sp++;
        }
      }
      if (count < minPixels) continue;
      // Find a contour start: leftmost pixel in topmost row of mask.
      let sx = -1, sy = -1;
      outer:
      for (let yy = minY; yy <= maxY; yy++) {
        for (let xx = minX; xx <= maxX; xx++) {
          if (mask[yy * w + xx]) { sx = xx; sy = yy; break outer; }
        }
      }
      if (sx < 0) continue;
      const contourPx = traceContour(mask, w, h, sx, sy);
      // Simplify in pixel space with eps ~ 0.4% of longest side.
      const eps = Math.max(1, 0.004 * Math.max(w, h));
      const simplified = simplify(contourPx, eps).slice(0, 64);
      if (simplified.length < 3) continue;

      const avgR = Math.round(sumR / count);
      const avgG = Math.round(sumG / count);
      const avgB = Math.round(sumB / count);
      const [hueDeg] = rgbToHsv(avgR, avgG, avgB);

      regions.push({
        id: `r${regions.length}`,
        color: `rgb(${avgR}, ${avgG}, ${avgB})`,
        hueDeg,
        polygon: simplified.map(([px, py]) => [px / w, py / h] as [number, number]),
        areaPct: count / N,
        bbox: {
          x: minX / w,
          y: minY / h,
          w: (maxX - minX + 1) / w,
          h: (maxY - minY + 1) / h,
        },
        centroid: [sumCx / count / w, sumCy / count / h],
      });
    }
  }

  // Sort largest-first so big rooms render under small ones.
  regions.sort((a, b) => b.areaPct - a.areaPct);
  return regions;
}

/** Smallest circular distance between two hues in degrees (0..180). */
export function hueDistance(a: number, b: number): number {
  if (a < 0 || b < 0) return 360;
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Parse an `hsl(H S% L%)` or `hsl(H, S%, L%)` string into hue degrees. Returns -1 if unparseable. */
export function parseHslHue(input: string | null | undefined): number {
  if (!input) return -1;
  const m = input.match(/hsla?\(\s*([-\d.]+)/i);
  if (!m) return -1;
  let h = parseFloat(m[1]);
  if (!Number.isFinite(h)) return -1;
  h = ((h % 360) + 360) % 360;
  return h;
}