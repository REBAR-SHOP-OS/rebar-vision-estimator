import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as encodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { decode as decodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Google Vision helpers ──

function base64url(data: Uint8Array): string {
  return encodeBase64(data).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemContents = pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\n/g, '');
  const binaryDer = decodeBase64(pemContents);
  return await crypto.subtle.importKey('pkcs8', binaryDer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
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

// ── Building signal keywords (veto cage_only) ──
const BUILDING_VETO_SIGNALS = [
  "foundation plan", "footing", "strip footing", "basement wall", "basement",
  "icf wall", "icf", "slab on grade", "sog", "wire mesh", "wwm",
  "framing plan", "beam", "joist", "gridlines", "floor levels", "floor plan",
  "general notes", "column schedule", "wall schedule", "slab", "stair",
  "grade beam", "raft slab", "retaining wall", "cmu wall",
];

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

    // Quick OCR on first 2 images
    let ocrText = "";
    let accessToken: string | null = null;
    try { accessToken = await getGoogleAccessToken(); } catch (e) { console.error("Vision token failed:", e); }

    const filesToScan = fileUrls.slice(0, 2);
    const contentParts: any[] = [];

    for (const url of filesToScan) {
      const urlLower = url.toLowerCase().split('?')[0];
      if (urlLower.endsWith('.pdf')) {
        try {
          const pdfResp = await fetch(url);
          if (!pdfResp.ok) continue;
          const buf = await pdfResp.arrayBuffer();
          if (buf.byteLength > 4 * 1024 * 1024) continue;
          contentParts.push({ type: "image_url", image_url: { url: `data:application/pdf;base64,${encodeBase64(buf)}` } });
        } catch {}
      } else {
        const supportedImageExts = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff', '.tif'];
        const fileExt = urlLower.split('.').pop()?.split('?')[0] || '';
        const isSupportedImage = supportedImageExts.some(ext => ext === `.${fileExt}`);
        if (!isSupportedImage) { console.log(`Skipping unsupported: .${fileExt}`); continue; }
        
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

    // Keyword-based analysis for veto logic
    const ocrLower = ocrText.toLowerCase();
    const cageKeywords = ["cage", "spiral", "tied assembly", "cage mark", "prefab", "column cage", "cage schedule", "cage height", "cage dia", "caisson", "drilled pier", "drilled shaft", "belled"];
    const barListKeywords = ["bar list", "bar schedule", "bar mark", "cut length", "bending schedule"];
    const infraKeywords = ["bridge", "abutment", "culvert", "mto", "opss", "highway", "barrier"];
    const residentialKeywords = ["icf", "basement", "garage", "sog", "slab on grade", "strip footing"];
    const industrialKeywords = ["equipment pad", "tank", "crane beam", "industrial", "process area"];
    const commercialKeywords = ["parking", "multi-storey", "elevator", "drop panel", "flat slab", "post-tension"];
    
    // Coating keywords
    const coatingKeywords: { key: string; label: string }[] = [
      { key: "epoxy", label: "EPOXY" }, { key: "epoxy-coated", label: "EPOXY" }, { key: "epoxy coated", label: "EPOXY" },
      { key: "ecr", label: "EPOXY" },
      { key: "galvanized", label: "GALVANISED" }, { key: "galvanised", label: "GALVANISED" },
      { key: "stainless steel", label: "STAINLESS" }, { key: "stainless", label: "STAINLESS" },
      { key: "mmfx", label: "MMFX" }, { key: "chromium", label: "MMFX" },
    ];
    const foundCoatings = coatingKeywords.filter(c => ocrLower.includes(c.key));
    const detectedCoatingFromOCR = foundCoatings.length > 0 ? foundCoatings[0].label : "none";

    // Count building veto signals found
    const foundBuildingSignals = BUILDING_VETO_SIGNALS.filter(s => ocrLower.includes(s));
    const foundCageSignals = cageKeywords.filter(k => ocrLower.includes(k));
    const foundBarListSignals = barListKeywords.filter(k => ocrLower.includes(k));

    const keywordHints: string[] = [];
    if (foundCageSignals.length > 0) keywordHints.push(`Cage indicators: ${foundCageSignals.join(", ")}`);
    if (foundBarListSignals.length > 0) keywordHints.push(`Bar list indicators: ${foundBarListSignals.join(", ")}`);
    if (infraKeywords.some(k => ocrLower.includes(k))) keywordHints.push("Infrastructure indicators found");
    if (residentialKeywords.some(k => ocrLower.includes(k))) keywordHints.push("Residential indicators found");
    if (industrialKeywords.some(k => ocrLower.includes(k))) keywordHints.push("Industrial indicators found");
    if (commercialKeywords.some(k => ocrLower.includes(k))) keywordHints.push("Commercial indicators found");
    if (foundBuildingSignals.length > 0) keywordHints.push(`Building signals (veto cage_only): ${foundBuildingSignals.join(", ")}`);
    if (foundCoatings.length > 0) keywordHints.push(`Coating indicators: ${foundCoatings.map(c => c.key).join(", ")} → ${detectedCoatingFromOCR}`);

    // Build the detection prompt with Dominance + Veto rules
    const detectionPrompt = `Analyze these blueprint files and determine the project type using the TWO-LAYER detection system.

${ocrText ? `## OCR Text Extracted:\n${ocrText}` : "No OCR text available - analyze the images directly."}

${keywordHints.length > 0 ? `## Keyword Analysis Hints:\n${keywordHints.map(h => `- ${h}`).join("\n")}\n` : ""}

## CRITICAL: Dominance + Veto Classification Rule

You MUST output TWO things:
1. **primaryCategory** — what the overall project IS (residential, commercial, industrial, infrastructure, cage_only, bar_list_only)
2. **features** — what sub-modules are present (hasCageAssembly, hasBarListTable)

### The "Human Rule" for cage_only classification:
Set primaryCategory = "cage_only" ONLY IF:
- Cage/caisson pages dominate (>70% of sheets are cage-related)
- AND zero strong building signals exist (no FOUNDATION PLAN, FOOTING, BASEMENT WALL, SOG, FRAMING PLAN, BEAM, GRIDLINES, FLOOR LEVELS, sheet patterns S0xx/S1xx, GENERAL NOTES, legends, WALL SCHEDULE, etc.)

If ANY building signals exist alongside cage content:
- Set primaryCategory to the appropriate building type (residential/commercial/etc.)
- Set features.hasCageAssembly = true

### Building Signal Veto List (these PREVENT cage_only):
FOUNDATION PLAN, FOOTING, STRIP FOOTING, BASEMENT WALL, ICF WALL, WALL SCHEDULE, SLAB ON GRADE, SOG, WIRE MESH, WWM, FRAMING PLAN, BEAM, JOIST, GRIDLINES, FLOOR LEVELS, GENERAL NOTES, COLUMN SCHEDULE, STAIR, GRADE BEAM, RAFT SLAB, RETAINING WALL, CMU WALL, sheet patterns S0xx/S1xx

### Category Guide:
- **cage_only**: ONLY when cage/caisson pages dominate AND no building signals. Pure cage package.
- **bar_list_only**: No blueprint drawings — just tables with bar marks, sizes, quantities, lengths.
- **residential**: Strip footings, ICF walls, basement walls, SOG, small columns, house plans.
- **commercial**: Multi-storey columns, flat slabs, parking, beams, drop panels.
- **industrial**: Large footings, heavy bars (25M+), equipment pads, tank bases, crane beams.
- **infrastructure**: Bridge decks, abutments, retaining walls >3m, culverts, highway barriers.

### Feature Detection (independent of primaryCategory):
- **hasCageAssembly**: true if ANY cage/caisson/drilled pier/spiral/tied assembly content is found ANYWHERE in the set.
- **hasBarListTable**: true if ANY bar schedule/bending schedule table is found.`;

    const tools = [{
      type: "function" as const,
      function: {
        name: "classify_project",
        description: "Classify the blueprint project type with two-layer detection (primaryCategory + features)",
        parameters: {
          type: "object",
          properties: {
            primaryCategory: {
              type: "string",
              enum: ["cage_only", "bar_list_only", "residential", "commercial", "industrial", "infrastructure"],
              description: "The overall project type. cage_only ONLY if cage dominates >70% AND no building signals."
            },
            features: {
              type: "object",
              properties: {
                hasCageAssembly: { type: "boolean", description: "true if cage/caisson/pier cage content exists anywhere" },
                hasBarListTable: { type: "boolean", description: "true if bar schedule/bending schedule table exists" },
              },
              required: ["hasCageAssembly", "hasBarListTable"],
            },
            evidence: {
              type: "object",
              properties: {
                buildingSignals: { type: "array", items: { type: "string" }, description: "Building-type keywords found" },
                cageSignals: { type: "array", items: { type: "string" }, description: "Cage-related keywords found" },
                barListSignals: { type: "array", items: { type: "string" }, description: "Bar list keywords found" },
              },
              required: ["buildingSignals", "cageSignals", "barListSignals"],
            },
            recommendedScope: {
              type: "array",
              items: { type: "string", enum: ["FOOTING", "GRADE_BEAM", "RAFT_SLAB", "PIER", "BEAM", "COLUMN", "SLAB", "STAIR", "WALL", "RETAINING_WALL", "ICF_WALL", "CMU_WALL", "WIRE_MESH", "CAGE"] },
              description: "Which element types are relevant for this project"
            },
            detectedCoating: {
              type: "string",
              enum: ["none", "EPOXY", "GALVANISED", "STAINLESS", "MMFX"],
              description: "Rebar coating type detected from general notes or specs"
            },
            detectedStandard: {
              type: "string",
              enum: ["canadian_metric", "us_imperial", "unknown"],
              description: "Detected measurement standard"
            },
            confidencePrimary: {
              type: "number",
              description: "Confidence in primaryCategory classification from 0 to 1"
            },
            reasoning: {
              type: "string",
              description: "Brief explanation of classification (1-2 sentences)"
            }
          },
          required: ["primaryCategory", "features", "evidence", "recommendedScope", "detectedCoating", "detectedStandard", "confidencePrimary", "reasoning"],
          additionalProperties: false,
        }
      }
    }];

    const userContent: any[] = [{ type: "text", text: detectionPrompt }, ...contentParts];

    const aiStart = performance.now();
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a structural engineering blueprint classifier implementing the Dominance + Veto detection system. Use the classify_project tool. NEVER set cage_only if building signals are present." },
          { role: "user", content: userContent },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "classify_project" } },
        temperature: 0,
        top_p: 1,
        max_tokens: 2048,
      }),
    });

    const aiLatency = Math.round(performance.now() - aiStart);
    console.log(JSON.stringify({ route: "detect-project-type", provider: "google/gemini", gateway: "lovable-ai", pinned_model: "google/gemini-2.5-flash", latency_ms: aiLatency, success: response.ok, fallback_used: false }));

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      return new Response(JSON.stringify(buildFallbackResult()), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await response.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    
    if (toolCall?.function?.arguments) {
      let result = JSON.parse(toolCall.function.arguments);
      
      // ── Server-side Veto Logic ──
      // If AI returned cage_only but our keyword analysis found building signals, override
      if (result.primaryCategory === "cage_only" && foundBuildingSignals.length > 0) {
        console.log("VETO: Overriding cage_only because building signals found:", foundBuildingSignals);
        // Determine strongest building category from keywords
        const residentialCount = residentialKeywords.filter(k => ocrLower.includes(k)).length;
        const commercialCount = commercialKeywords.filter(k => ocrLower.includes(k)).length;
        const industrialCount = industrialKeywords.filter(k => ocrLower.includes(k)).length;
        const infraCount = infraKeywords.filter(k => ocrLower.includes(k)).length;
        
        const maxCount = Math.max(residentialCount, commercialCount, industrialCount, infraCount);
        if (maxCount === 0 || residentialCount === maxCount) {
          result.primaryCategory = "residential";
        } else if (commercialCount === maxCount) {
          result.primaryCategory = "commercial";
        } else if (industrialCount === maxCount) {
          result.primaryCategory = "industrial";
        } else {
          result.primaryCategory = "infrastructure";
        }
        result.features = { ...result.features, hasCageAssembly: true };
        result.reasoning = `[VETO OVERRIDE] ${result.reasoning}. Building signals found: ${foundBuildingSignals.join(", ")}`;
      }

      // Ensure features object exists
      if (!result.features) {
        result.features = { hasCageAssembly: false, hasBarListTable: false };
      }
      if (!result.evidence) {
        result.evidence = { buildingSignals: foundBuildingSignals, cageSignals: foundCageSignals, barListSignals: foundBarListSignals };
      }

      // ── Coating: use OCR-based detection as override if AI missed it ──
      if (!result.detectedCoating || result.detectedCoating === "none") {
        result.detectedCoating = detectedCoatingFromOCR;
      }

      // ── Backward-compatible fields ──
      // Map primaryCategory to old `category` field for transition
      const categoryMap: Record<string, string> = {
        cage_only: "cage",
        bar_list_only: "bar_list",
        residential: "residential",
        commercial: "commercial",
        industrial: "industrial",
        infrastructure: "infrastructure",
      };
      result.category = categoryMap[result.primaryCategory] || result.primaryCategory;
      result.confidence = result.confidencePrimary;

      console.log("Project type detected (V2):", JSON.stringify({
        primaryCategory: result.primaryCategory,
        features: result.features,
        evidence: result.evidence,
        vetoApplied: foundBuildingSignals.length > 0 && result.reasoning?.includes("[VETO"),
      }));

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(buildFallbackResult()), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("detect-project-type error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function buildFallbackResult() {
  return {
    primaryCategory: "commercial",
    features: { hasCageAssembly: false, hasBarListTable: false },
    evidence: { buildingSignals: [], cageSignals: [], barListSignals: [] },
    recommendedScope: ["FOOTING", "GRADE_BEAM", "RAFT_SLAB", "PIER", "BEAM", "COLUMN", "SLAB", "STAIR", "WALL", "RETAINING_WALL", "ICF_WALL", "CMU_WALL", "WIRE_MESH"],
    detectedStandard: "unknown",
    confidencePrimary: 0,
    confidence: 0,
    reasoning: "Detection failed, defaulting to all elements",
    category: "commercial",
  };
}
