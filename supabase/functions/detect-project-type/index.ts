import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as encodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { decode as decodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Google Vision helpers (reused from analyze-blueprint) ──

function base64url(data: Uint8Array): string {
  return encodeBase64(data).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemContents = pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\n/g, '');
  const binaryDer = decodeBase64(pemContents);
  return await crypto.subtle.importKey('pkcs8', binaryDer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

async function getGoogleAccessToken(): Promise<string> {
  const saKeyRaw = Deno.env.get("GOOGLE_VISION_SA_KEY");
  if (!saKeyRaw) throw new Error("GOOGLE_VISION_SA_KEY not configured");
  
  let sa: any;
  const cleanJson = saKeyRaw.replace(/^\uFEFF/, '').trim();
  try { sa = JSON.parse(cleanJson); } catch {}
  if (!sa) { try { sa = JSON.parse(decodeURIComponent(cleanJson)); } catch {} }
  if (!sa) { try { sa = JSON.parse(new TextDecoder().decode(decodeBase64(cleanJson))); } catch {} }
  if (!sa) { try { sa = JSON.parse(cleanJson.replace(/\\n/g, '\n').replace(/\\"/g, '"')); } catch {} }
  if (!sa || !sa.client_email || !sa.private_key) throw new Error("GOOGLE_VISION_SA_KEY parse failed");

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = { iss: sa.client_email, scope: "https://www.googleapis.com/auth/cloud-vision", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 };
  const encoder = new TextEncoder();
  const headerB64 = base64url(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64url(encoder.encode(JSON.stringify(payload)));
  const key = await importPrivateKey(sa.private_key);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(`${headerB64}.${payloadB64}`));
  const jwt = `${headerB64}.${payloadB64}.${base64url(new Uint8Array(signature))}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  if (!tokenRes.ok) throw new Error(`Google OAuth2 failed: ${tokenRes.status}`);
  return (await tokenRes.json()).access_token;
}

async function quickOCR(accessToken: string, imageBase64: string): Promise<string> {
  const res = await fetch("https://vision.googleapis.com/v1/images:annotate", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [{ image: { content: imageBase64 }, features: [{ type: "DOCUMENT_TEXT_DETECTION" }] }],
    }),
  });
  if (!res.ok) throw new Error(`Vision API error: ${res.status}`);
  const data = await res.json();
  return data.responses?.[0]?.fullTextAnnotation?.text || data.responses?.[0]?.textAnnotations?.[0]?.description || "";
}

// ── Main Handler ──

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { fileUrls } = await req.json();
    if (!fileUrls || fileUrls.length === 0) {
      return new Response(JSON.stringify({ error: "No file URLs provided" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // Quick OCR on first image (or first 2 for better detection)
    let ocrText = "";
    let accessToken: string | null = null;
    try { accessToken = await getGoogleAccessToken(); } catch (e) { console.error("Vision token failed:", e); }

    const filesToScan = fileUrls.slice(0, 2);
    const contentParts: any[] = [];

    for (const url of filesToScan) {
      const urlLower = url.toLowerCase().split('?')[0];
      if (urlLower.endsWith('.pdf')) {
        // For PDFs, send as inline data to Gemini
        try {
          const pdfResp = await fetch(url);
          if (!pdfResp.ok) continue;
          const buf = await pdfResp.arrayBuffer();
          if (buf.byteLength > 4 * 1024 * 1024) continue;
          contentParts.push({ type: "image_url", image_url: { url: `data:application/pdf;base64,${encodeBase64(buf)}` } });
        } catch {}
      } else {
        // Image - run quick OCR + send to Gemini
        contentParts.push({ type: "image_url", image_url: { url } });
        if (accessToken) {
          try {
            const imgResp = await fetch(url);
            if (!imgResp.ok) continue;
            const imgBuf = await imgResp.arrayBuffer();
            const text = await quickOCR(accessToken, encodeBase64(imgBuf));
            if (text) ocrText += `\n--- OCR from ${url.split('/').pop()?.split('?')[0]} ---\n${text}\n`;
          } catch {}
        }
      }
    }

    // Keyword-based confidence boosting
    const ocrLower = ocrText.toLowerCase();
    const cageKeywords = ["cage", "spiral", "tied assembly", "cage mark", "prefab", "column cage", "cage schedule", "cage height", "cage dia"];
    const barListKeywords = ["bar list", "bar schedule", "bar mark", "cut length", "qty", "bending schedule"];
    const infraKeywords = ["bridge", "abutment", "culvert", "mto", "opss", "highway", "barrier"];
    const residentialKeywords = ["icf", "basement", "garage", "sog", "slab on grade", "strip footing"];
    const industrialKeywords = ["equipment pad", "tank", "crane beam", "industrial", "process area"];
    
    const keywordHints: string[] = [];
    if (cageKeywords.some(k => ocrLower.includes(k))) keywordHints.push("STRONG cage indicators found in OCR text (keywords: cage, spiral, tied assembly)");
    if (barListKeywords.some(k => ocrLower.includes(k))) keywordHints.push("Bar list/schedule indicators found in OCR text");
    if (infraKeywords.some(k => ocrLower.includes(k))) keywordHints.push("Infrastructure indicators found (bridge, MTO, highway)");
    if (residentialKeywords.some(k => ocrLower.includes(k))) keywordHints.push("Residential indicators found (ICF, basement, SOG)");
    if (industrialKeywords.some(k => ocrLower.includes(k))) keywordHints.push("Industrial indicators found (equipment pad, tank, crane)");

    // Build the detection prompt
    const detectionPrompt = `Analyze these blueprint files and determine the project type.

${ocrText ? `## OCR Text Extracted:\n${ocrText}` : "No OCR text available - analyze the images directly."}

${keywordHints.length > 0 ? `## Keyword Analysis Hints:\n${keywordHints.map(h => `- ${h}`).join("\n")}\n` : ""}

## Category Detection Guide

### CAGE (Prefab Rebar Cages / Column Cages)
**Strong indicators**: Column cage schedules, "cage" labels anywhere, prefab marks (e.g., C1-CAGE, CAGE-A), tied column assemblies, cage height/diameter callouts, spiral pitch details, shop drawing format showing cage assembly views, cage weight tables.
**Typical content**: Individual cage detail drawings showing verticals + ties/spirals, cage mark numbers, assembly instructions.

### BAR LIST (Schedule Only — No Drawings)
**Strong indicators**: No blueprint drawings — just tables with bar marks, sizes (10M, #4), quantities, cut lengths, total weights. May have "Bending Schedule", "Bar List", "Bar Schedule" as title.
**Typical content**: Tabular data only, no plan/section views.

### RESIDENTIAL
**Strong indicators**: Strip footings, ICF wall details, basement walls, SOG (slab-on-grade), small residential columns, garage foundations, house plans, light bar sizes (10M-20M predominant).
**Typical content**: Simple foundation plans, wall sections, small scale.

### COMMERCIAL
**Strong indicators**: Multi-storey column schedules, flat slab/plate details, drop panels, parking structures, elevator shafts, slab bands, post-tensioning.
**Typical content**: Floor plans with column grids, beam schedules, multiple levels.

### INDUSTRIAL
**Strong indicators**: Large footings (>3m), heavy bar sizes (25M-55M, #8+), equipment foundations, tank bases/rings, crane beams, process equipment pads, turbine/generator foundations.
**Typical content**: Heavy isolated footings, massive pile caps, equipment anchor bolt patterns.

### INFRASTRUCTURE
**Strong indicators**: Bridge decks, abutments, retaining walls >3m, culverts, highway barriers, MTO/OPSS/DOT references, wingwalls, pier caps (bridge piers).
**Typical content**: Bridge cross-sections, retaining wall elevations, DOT standard details.

Classify this project into one of these categories based on what you see in the blueprints.`;

    const tools = [{
      type: "function" as const,
      function: {
        name: "classify_project",
        description: "Classify the blueprint project type and recommend scope items",
        parameters: {
          type: "object",
          properties: {
            category: {
              type: "string",
              enum: ["cage", "industrial", "residential", "commercial", "bar_list", "infrastructure"],
              description: "Detected project category. cage=prefab rebar cages/column cages, industrial=heavy industrial/equipment foundations, residential=houses/small buildings, commercial=office/retail/multi-storey, bar_list=just a bar schedule/list, infrastructure=bridges/retaining walls/highways"
            },
            recommendedScope: {
              type: "array",
              items: { type: "string", enum: ["FOOTING", "GRADE_BEAM", "RAFT_SLAB", "PIER", "BEAM", "COLUMN", "SLAB", "STAIR", "WALL", "RETAINING_WALL", "ICF_WALL", "CMU_WALL", "WIRE_MESH"] },
              description: "Which element types are relevant for this project"
            },
            detectedStandard: {
              type: "string",
              enum: ["canadian_metric", "us_imperial", "unknown"],
              description: "Detected measurement standard. canadian_metric if you see M-sizes (10M, 15M, 20M), metric units, CSA references. us_imperial if you see # sizes (#3, #4), imperial units, ACI references."
            },
            confidence: {
              type: "number",
              description: "Confidence in classification from 0 to 1"
            },
            reasoning: {
              type: "string",
              description: "Brief explanation of why this category was chosen (1-2 sentences)"
            }
          },
          required: ["category", "recommendedScope", "detectedStandard", "confidence", "reasoning"],
          additionalProperties: false,
        }
      }
    }];

    const userContent: any[] = [{ type: "text", text: detectionPrompt }, ...contentParts];

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a structural engineering blueprint classifier. Analyze blueprints quickly and classify the project type. Use the classify_project tool to return your classification." },
          { role: "user", content: userContent },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "classify_project" } },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      // Return a fallback instead of erroring
      return new Response(JSON.stringify({
        category: "commercial",
        recommendedScope: ["FOOTING", "GRADE_BEAM", "RAFT_SLAB", "PIER", "BEAM", "COLUMN", "SLAB", "STAIR", "WALL", "RETAINING_WALL", "ICF_WALL", "CMU_WALL", "WIRE_MESH"],
        detectedStandard: "unknown",
        confidence: 0,
        reasoning: "Detection failed, defaulting to all elements",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiData = await response.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    
    if (toolCall?.function?.arguments) {
      const result = JSON.parse(toolCall.function.arguments);
      console.log("Project type detected:", result);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fallback if tool call didn't work
    return new Response(JSON.stringify({
      category: "commercial",
      recommendedScope: ["FOOTING", "GRADE_BEAM", "RAFT_SLAB", "PIER", "BEAM", "COLUMN", "SLAB", "STAIR", "WALL", "RETAINING_WALL", "ICF_WALL", "CMU_WALL", "WIRE_MESH"],
      detectedStandard: "unknown",
      confidence: 0,
      reasoning: "Could not parse detection result, defaulting to all elements",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("detect-project-type error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
