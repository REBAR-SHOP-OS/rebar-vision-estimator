import { supabase } from "@/integrations/supabase/client";

/** Bbox in source-image pixel space: [x1, y1, x2, y2]. */
export type PxBox = [number, number, number, number];

export interface LabelHit {
  /** Raw OCR token text (cleaned). */
  text: string;
  /** Bbox normalised 0..1 against the image natural size. */
  rect: PxBox;
}

/** Default mark patterns used on structural foundation sheets. */
export const DEFAULT_MARK_PATTERNS: RegExp[] = [
  // Accept hyphen, dot, or no separator (e.g. F2, F-2, F.2, WF-1, WF.1)
  /^WF[-.\s]?\d+[A-Z]?$/i, // wall footings
  /^F[-.\s]?\d+[A-Z]?$/i,  // pad footings
  /^P[-.\s]?\d+[A-Z]?$/i,  // piers
  /^C[-.\s]?\d+[A-Z]?$/i,  // columns
  /^B[-.\s]?\d+[A-Z]?$/i,  // beams
  /^S[-.\s]?\d+[A-Z]?$/i,  // slabs / stairs
  /^GB[-.\s]?\d+[A-Z]?$/i, // grade beams
  /^PC[-.\s]?\d+[A-Z]?$/i, // pile caps
];

function normalizeToken(t: string): string {
  return (t || "").trim().replace(/\s+/g, "").toUpperCase();
}

/** Classify a mark token to a segment_type bucket. */
export function markBucket(token: string): string | null {
  const t = normalizeToken(token);
  if (/^WF[-.]?\d/i.test(t)) return "wall"; // WF = Foundation Wall
  if (/^F[-.]?\d/i.test(t)) return "footing";
  if (/^PC[-.]?\d/i.test(t)) return "footing";
  if (/^P[-.]?\d/i.test(t)) return "pier";
  if (/^C[-.]?\d/i.test(t)) return "column";
  if (/^B[-.]?\d/i.test(t)) return "beam";
  if (/^GB[-.]?\d/i.test(t)) return "beam";
  if (/^S[-.]?\d/i.test(t)) return "slab";
  return null;
}

export interface OcrPageResult {
  imageWidth: number;
  imageHeight: number;
  hits: LabelHit[];
}

/**
 * Run OCR (via the `ocr-image` edge function) on a publicly-signed image URL
 * and return only the blocks whose text matches a structural mark pattern.
 * Returns rects in **image pixel** coordinates — caller normalises to 0..1
 * using imageWidth/imageHeight if needed.
 */
export async function detectPageLabels(
  signedImageUrl: string,
  patterns: RegExp[] = DEFAULT_MARK_PATTERNS,
): Promise<OcrPageResult> {
  const { data, error } = await supabase.functions.invoke("ocr-image", {
    body: { image_url: signedImageUrl },
  });
  if (error) throw error;
  const results: Array<{ blocks: Array<{ text: string; bbox: number[] }> }> =
    (data as { ocr_results?: Array<{ blocks: Array<{ text: string; bbox: number[] }> }> })?.ocr_results || [];

  // Pull all blocks from any pass, dedupe by text+approximate position.
  const seen = new Set<string>();
  const hits: LabelHit[] = [];
  let maxX = 0, maxY = 0;
  for (const r of results) {
    for (const b of r.blocks || []) {
      const [x1, y1, x2, y2] = b.bbox || [0, 0, 0, 0];
      if (x2 > maxX) maxX = x2;
      if (y2 > maxY) maxY = y2;
      const txt = (b.text || "").trim();
      if (!txt) continue;
      // Test the whole block AND each whitespace-separated token.
      const tokens = [txt, ...txt.split(/[\s,;()\[\]]+/)].map((t) => t.trim()).filter(Boolean);
      let matched = false;
      for (const tok of tokens) {
        const norm = normalizeToken(tok);
        if (norm.length < 2 || norm.length > 8) continue;
        if (patterns.some((p) => p.test(norm))) { matched = true; break; }
      }
      if (!matched) continue;
      const key = `${normalizeToken(txt)}::${Math.round(x1 / 4)}:${Math.round(y1 / 4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ text: normalizeToken(txt), rect: [x1, y1, x2, y2] });
    }
  }
  return { imageWidth: maxX || 1000, imageHeight: maxY || 1000, hits };
}