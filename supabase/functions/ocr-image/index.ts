import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getGoogleAccessToken, callVisionAPIByUrl } from "../_shared/google-vision.ts";

interface OcrPassResult {
  pass: number;
  engine: string;
  preprocess: string;
  fullText: string;
  blocks: { text: string; confidence: number; bbox: number[] }[];
}

function extractResult(raw: any, passNum: number, preprocess: string): OcrPassResult {
  const fullText = raw.fullTextAnnotation?.text || raw.textAnnotations?.[0]?.description || "";
  const blocks: { text: string; confidence: number; bbox: number[] }[] = [];

  if (raw.fullTextAnnotation?.pages) {
    for (const page of raw.fullTextAnnotation.pages) {
      for (const block of page.blocks || []) {
        const blockText = (block.paragraphs || [])
          .flatMap((p: any) => (p.words || []).map((w: any) =>
            (w.symbols || []).map((s: any) => s.text).join("")
          ))
          .join(" ");
        const vertices = block.boundingBox?.vertices || [];
        const bbox = vertices.length >= 4
          ? [vertices[0]?.x || 0, vertices[0]?.y || 0, vertices[2]?.x || 0, vertices[2]?.y || 0]
          : [0, 0, 0, 0];
        blocks.push({ text: blockText, confidence: block.confidence || 0, bbox });
      }
    }
  } else if (raw.textAnnotations && raw.textAnnotations.length > 1) {
    for (let i = 1; i < raw.textAnnotations.length; i++) {
      const ann = raw.textAnnotations[i];
      const vertices = ann.boundingPoly?.vertices || [];
      const bbox = vertices.length >= 4
        ? [vertices[0]?.x || 0, vertices[0]?.y || 0, vertices[2]?.x || 0, vertices[2]?.y || 0]
        : [0, 0, 0, 0];
      blocks.push({ text: ann.description || "", confidence: 0.9, bbox });
    }
  }
  return { pass: passNum, engine: "google-vision", preprocess, fullText, blocks };
}

// ── Handler: OCR a single image URL ──

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
  }

  try {
    const { image_url } = await req.json();
    if (!image_url) {
      return new Response(JSON.stringify({ error: "image_url is required" }), {
        status: 400,
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const accessToken = await getGoogleAccessToken();

    // Use imageUri — Vision API fetches the image directly, no download needed in edge function
    // Run 2 OCR passes (TEXT_DETECTION + DOCUMENT_TEXT_DETECTION) to save CPU
    const [pass1, pass2] = await Promise.all([
      callVisionAPIByUrl(accessToken, image_url, [{ type: "TEXT_DETECTION" }]),
      callVisionAPIByUrl(accessToken, image_url, [{ type: "DOCUMENT_TEXT_DETECTION" }]),
    ]);

    const ocrResults: OcrPassResult[] = [
      extractResult(pass1, 1, "STANDARD"),
      extractResult(pass2, 2, "ENHANCED"),
    ];

    const totalBlocks = ocrResults.reduce((s, r) => s + r.blocks.length, 0);
    console.log(`OCR complete: ${totalBlocks} blocks from ${image_url.substring(0, 60)}...`);

    return new Response(JSON.stringify({ ocr_results: ocrResults }), {
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ocr-image error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
