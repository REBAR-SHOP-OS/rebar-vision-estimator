import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as encodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { decode as decodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Google Vision helpers (copied from analyze-blueprint) ──

function base64url(data: Uint8Array): string {
  return encodeBase64(data).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemContents = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\n/g, '');
  const binaryDer = decodeBase64(pemContents);
  return await crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

async function getGoogleAccessToken(): Promise<string> {
  const saKeyRaw = Deno.env.get("GOOGLE_VISION_SA_KEY_V2") || Deno.env.get("GOOGLE_VISION_SA_KEY");
  if (!saKeyRaw) throw new Error("GOOGLE_VISION_SA_KEY not configured");

  let sa: any;
  const cleanJson = saKeyRaw.replace(/^\uFEFF/, '').trim();
  try { sa = JSON.parse(cleanJson); } catch {}
  if (!sa) { try { sa = JSON.parse(decodeURIComponent(cleanJson)); } catch {} }
  if (!sa) { try { sa = JSON.parse(new TextDecoder().decode(decodeBase64(cleanJson))); } catch {} }
  if (!sa) { try { sa = JSON.parse(cleanJson.replace(/\\n/g, '\n').replace(/\\"/g, '"')); } catch {} }
  if (!sa || !sa.client_email || !sa.private_key) {
    throw new Error("GOOGLE_VISION_SA_KEY could not be parsed.");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-vision",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  };

  const encoder = new TextEncoder();
  const headerB64 = base64url(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64url(encoder.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await importPrivateKey(sa.private_key);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(signingInput));
  const jwt = `${signingInput}.${base64url(new Uint8Array(signature))}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Google OAuth2 token exchange failed: ${tokenRes.status} ${errText}`);
  }
  return (await tokenRes.json()).access_token;
}

async function callVisionAPI(
  accessToken: string,
  imageBase64: string,
  features: { type: string; maxResults?: number }[],
  imageContext?: Record<string, unknown>
): Promise<any> {
  const request: any = { image: { content: imageBase64 }, features };
  if (imageContext) request.imageContext = imageContext;

  const res = await fetch("https://vision.googleapis.com/v1/images:annotate", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ requests: [request] }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Vision API error: ${res.status} ${errText}`);
  }
  return (await res.json()).responses?.[0] || {};
}

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
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { image_url } = await req.json();
    if (!image_url) {
      return new Response(JSON.stringify({ error: "image_url is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await getGoogleAccessToken();

    // Download image
    const imgResponse = await fetch(image_url);
    if (!imgResponse.ok) {
      return new Response(JSON.stringify({ error: `Image download failed: ${imgResponse.status}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const imgBuffer = await imgResponse.arrayBuffer();
    const imgBase64 = encodeBase64(imgBuffer);

    // Run 3 OCR passes in parallel
    const [pass1, pass2, pass3] = await Promise.all([
      callVisionAPI(accessToken, imgBase64, [{ type: "TEXT_DETECTION" }]),
      callVisionAPI(accessToken, imgBase64, [{ type: "DOCUMENT_TEXT_DETECTION" }]),
      callVisionAPI(accessToken, imgBase64, [{ type: "TEXT_DETECTION" }], { languageHints: ["en"] }),
    ]);

    const ocrResults: OcrPassResult[] = [
      extractResult(pass1, 1, "STANDARD"),
      extractResult(pass2, 2, "ENHANCED"),
      extractResult(pass3, 3, "ALT_CROP"),
    ];

    const totalBlocks = ocrResults.reduce((s, r) => s + r.blocks.length, 0);
    console.log(`OCR complete: ${totalBlocks} blocks from ${image_url.substring(0, 60)}...`);

    return new Response(JSON.stringify({ ocr_results: ocrResults }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ocr-image error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
