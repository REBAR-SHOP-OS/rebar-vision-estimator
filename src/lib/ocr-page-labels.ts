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
  // Accept hyphen, dot, or no separator, plus optional decimal size suffix
  // (e.g. F2, F-2, F.2, F2.0, F-2.0A, WF-1, WF1.5).
  /^WF[-.\s]?\d+(\.\d+)?[A-Z]?$/i, // wall footings
  /^F[-.\s]?\d+(\.\d+)?[A-Z]?$/i,  // pad footings
  /^FTG[-.\s]?\d+(\.\d+)?[A-Z]?$/i, // footing alias
  /^PAD[-.\s]?\d+(\.\d+)?[A-Z]?$/i, // pad footing alias
  /^P[-.\s]?\d+(\.\d+)?[A-Z]?$/i,  // piers
  /^C[-.\s]?\d+(\.\d+)?[A-Z]?$/i,  // columns
  /^B[-.\s]?\d+(\.\d+)?[A-Z]?$/i,  // beams
  /^S[-.\s]?\d+(\.\d+)?[A-Z]?$/i,  // slabs / stairs
  /^GB[-.\s]?\d+(\.\d+)?[A-Z]?$/i, // grade beams
  /^PC[-.\s]?\d+(\.\d+)?[A-Z]?$/i, // pile caps
];

export function normalizeMarkToken(t: string): string {
  return (t || "")
    .trim()
    .replace(/[‐‑‒–—﹘﹣－]/g, "-")
    .replace(/\s+/g, "")
    .toUpperCase()
    .replace(/^[^A-Z0-9]+/, "")
    .replace(/[^A-Z0-9]+$/, "");
}

export function extractMarkCandidates(text: string): string[] {
  const raw = (text || "").trim();
  if (!raw) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const parts = [raw, ...raw.split(/[\s,;:()\[\]{}\\/|]+/)];
  for (const part of parts) {
    const norm = normalizeMarkToken(part);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

/** Classify a mark token to a segment_type bucket. */
export function markBucket(token: string): string | null {
  const t = normalizeMarkToken(token);
  if (/^WF[-.]?\d/i.test(t)) return "wall"; // WF = Foundation Wall
  if (/^FTG[-.]?\d/i.test(t)) return "footing";
  if (/^PAD[-.]?\d/i.test(t)) return "footing";
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
  /** Diagnostic: tokens read by OCR that did not match any pattern. */
  unmatchedTokens?: string[];
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
  const unmatched = new Set<string>();
  let maxX = 0, maxY = 0;
  for (const r of results) {
    for (const b of r.blocks || []) {
      const [x1, y1, x2, y2] = b.bbox || [0, 0, 0, 0];
      if (x2 > maxX) maxX = x2;
      if (y2 > maxY) maxY = y2;
      const txt = (b.text || "").trim();
      if (!txt) continue;
      // Test the whole block AND each whitespace-separated token.
      const tokens = extractMarkCandidates(txt);
      let matched = false;
      for (const tok of tokens) {
        if (tok.length < 2 || tok.length > 10) continue;
        if (patterns.some((p) => p.test(tok))) { matched = true; break; }
      }
      if (!matched) {
        // Capture short alpha+digit tokens for diagnostics
        for (const tok of tokens) {
          if (tok.length >= 2 && tok.length <= 10 && /[A-Z]/.test(tok) && /\d/.test(tok)) {
            unmatched.add(tok);
          }
        }
        continue;
      }
      const key = `${normalizeMarkToken(txt)}::${Math.round(x1 / 4)}:${Math.round(y1 / 4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ text: normalizeMarkToken(txt), rect: [x1, y1, x2, y2] });
    }
  }
  return {
    imageWidth: maxX || 1000,
    imageHeight: maxY || 1000,
    hits,
    unmatchedTokens: unmatched.size ? Array.from(unmatched).slice(0, 50) : undefined,
  };
}
