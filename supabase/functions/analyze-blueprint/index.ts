import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as encodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { decode as decodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { getDocument } from "https://esm.sh/pdfjs-serverless";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Google Vision API Integration ──

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
  
  // Resilient parsing: try multiple decode strategies
  let sa: any;
  const cleanJson = saKeyRaw.replace(/^\uFEFF/, '').trim();
  console.log("SA key first 20 chars:", JSON.stringify(cleanJson.substring(0, 20)));
  
  // Strategy 1: Direct JSON parse
  try { sa = JSON.parse(cleanJson); } catch {}
  
  // Strategy 2: URL-decoded
  if (!sa) {
    try { sa = JSON.parse(decodeURIComponent(cleanJson)); } catch {}
  }
  
  // Strategy 3: Base64-decoded
  if (!sa) {
    try {
      const decoded = new TextDecoder().decode(decodeBase64(cleanJson));
      sa = JSON.parse(decoded);
    } catch {}
  }
  
  // Strategy 4: Double-escaped JSON (extra backslashes)
  if (!sa) {
    try { sa = JSON.parse(cleanJson.replace(/\\n/g, '\n').replace(/\\"/g, '"')); } catch {}
  }
  
  if (!sa || !sa.client_email || !sa.private_key) {
    throw new Error("GOOGLE_VISION_SA_KEY could not be parsed. Ensure it is valid JSON with client_email and private_key fields.");
  }
  const now = Math.floor(Date.now() / 1000);
  
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-vision",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const encoder = new TextEncoder();
  const headerB64 = base64url(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64url(encoder.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await importPrivateKey(sa.private_key);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    encoder.encode(signingInput)
  );
  const signatureB64 = base64url(new Uint8Array(signature));
  const jwt = `${signingInput}.${signatureB64}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Google OAuth2 token exchange failed: ${tokenRes.status} ${errText}`);
  }

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

async function callVisionAPI(
  accessToken: string,
  imageBase64: string,
  features: { type: string; maxResults?: number }[],
  imageContext?: Record<string, unknown>
): Promise<any> {
  const request: any = {
    image: { content: imageBase64 },
    features,
  };
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

  const data = await res.json();
  return data.responses?.[0] || {};
}

interface OcrPassResult {
  pass: number;
  engine: string;
  preprocess: string;
  fullText: string;
  blocks: { text: string; confidence: number; bbox: number[] }[];
}

async function tripleOCR(accessToken: string, imageBase64: string): Promise<OcrPassResult[]> {
  // Run all 3 passes in parallel
  const [pass1, pass2, pass3] = await Promise.all([
    // Pass 1: TEXT_DETECTION (general)
    callVisionAPI(accessToken, imageBase64, [{ type: "TEXT_DETECTION" }]),
    // Pass 2: DOCUMENT_TEXT_DETECTION (document-optimized)
    callVisionAPI(accessToken, imageBase64, [{ type: "DOCUMENT_TEXT_DETECTION" }]),
    // Pass 3: TEXT_DETECTION with English language hint
    callVisionAPI(accessToken, imageBase64, 
      [{ type: "TEXT_DETECTION" }],
      { languageHints: ["en"] }
    ),
  ]);

  const extractResult = (raw: any, passNum: number, preprocess: string): OcrPassResult => {
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
          blocks.push({
            text: blockText,
            confidence: block.confidence || 0,
            bbox,
          });
        }
      }
    } else if (raw.textAnnotations && raw.textAnnotations.length > 1) {
      for (let i = 1; i < raw.textAnnotations.length; i++) {
        const ann = raw.textAnnotations[i];
        const vertices = ann.boundingPoly?.vertices || [];
        const bbox = vertices.length >= 4
          ? [vertices[0]?.x || 0, vertices[0]?.y || 0, vertices[2]?.x || 0, vertices[2]?.y || 0]
          : [0, 0, 0, 0];
        blocks.push({
          text: ann.description || "",
          confidence: 0.9,
          bbox,
        });
      }
    }

    return { pass: passNum, engine: "google-vision", preprocess, fullText, blocks };
  };

  return [
    extractResult(pass1, 1, "STANDARD"),
    extractResult(pass2, 2, "ENHANCED"),
    extractResult(pass3, 3, "ALT_CROP"),
  ];
}

// ── PDF-Native Text Extraction (pdfjs-serverless) ──

interface TitleBlockMeta {
  sheet_number: string | null;
  sheet_title: string | null;
  revision_code: string | null;
  scale_raw: string | null;
  discipline: string | null;
  drawing_type: string | null;
}

interface PdfPageExtraction {
  page_number: number;
  raw_text: string;
  tables: string[][];
  text_blocks: string[];
  is_scanned: boolean;
  title_block: TitleBlockMeta | null;
}

interface PdfExtractionResult {
  pages: PdfPageExtraction[];
  total_pages: number;
  sha256: string;
  has_text_layer: boolean;
}

async function hashSHA256(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function extractTitleBlockMeta(text: string): TitleBlockMeta {
  const tb: TitleBlockMeta = { sheet_number: null, sheet_title: null, revision_code: null, scale_raw: null, discipline: null, drawing_type: null };
  const sheetMatch = text.match(/\b([A-Z]{1,2}[-]?\d{2,4}(?:\.\d+)?)\b/);
  if (sheetMatch) tb.sheet_number = sheetMatch[1];
  const scaleMatch = text.match(/(?:SCALE[:\s]*)?(\d+\s*[:/]\s*\d+)/i);
  if (scaleMatch) tb.scale_raw = scaleMatch[1].trim();
  const revMatch = text.match(/\bREV(?:ISION)?\.?\s*([A-Z0-9]{1,3})\b/i);
  if (revMatch) tb.revision_code = revMatch[1];
  const textUpper = text.toUpperCase();
  if (/\bSTRUCTURAL\b/.test(textUpper) || /^S[-]?\d/.test(tb.sheet_number || "")) tb.discipline = "structural";
  else if (/\bARCHITECTURAL\b/.test(textUpper) || /^A[-]?\d/.test(tb.sheet_number || "")) tb.discipline = "architectural";
  else if (/\bMECHANICAL\b/.test(textUpper) || /^M[-]?\d/.test(tb.sheet_number || "")) tb.discipline = "mechanical";
  else if (/\bELECTRICAL\b/.test(textUpper) || /^E[-]?\d/.test(tb.sheet_number || "")) tb.discipline = "electrical";
  if (/\bFOUNDATION\s*PLAN\b/i.test(text)) tb.drawing_type = "foundation_plan";
  else if (/\bSLAB\s*(?:REINFORCEMENT|REBAR)\b/i.test(text)) tb.drawing_type = "rebar_plan";
  else if (/\bSCHEDULE\b/i.test(text)) tb.drawing_type = "schedule";
  else if (/\bDETAIL/i.test(text)) tb.drawing_type = "detail";
  else if (/\bSECTION/i.test(text)) tb.drawing_type = "section";
  else if (/\bELEVATION/i.test(text)) tb.drawing_type = "elevation";
  else if (/\bPLAN\b/i.test(text)) tb.drawing_type = "plan";
  const titleMatch = text.match(/(?:SHEET\s*TITLE|DRAWING\s*TITLE)[:\s]*(.+)/i);
  if (titleMatch) tb.sheet_title = titleMatch[1].trim().substring(0, 100);
  return tb;
}

async function extractPdfText(pdfBytes: ArrayBuffer, maxPages: number = 999): Promise<PdfExtractionResult> {
  const sha256 = await hashSHA256(pdfBytes);
  const pages: PdfPageExtraction[] = [];

  try {
    const doc = await getDocument(new Uint8Array(pdfBytes));
    const totalPages = doc.numPages || 0;
    if (!totalPages || isNaN(totalPages)) {
      console.log("PDF has no parseable pages (numPages is undefined/NaN)");
      return { pages: [], total_pages: 0, sha256, has_text_layer: false };
    }
    const pagesToProcess = Math.min(totalPages, maxPages);
    console.log(`PDF has ${totalPages} pages, processing first ${pagesToProcess}`);

    for (let pageNum = 1; pageNum <= pagesToProcess; pageNum++) {
      try {
        const page = await doc.getPage(pageNum);
        const textContent = await page.getTextContent();
        const items = textContent.items.filter((item: any) => item.str && item.str.trim());

        if (items.length < 3) {
          pages.push({ page_number: pageNum, raw_text: "", tables: [], text_blocks: [], is_scanned: true, title_block: null });
          continue;
        }

        // Group by Y-coordinate into rows (3pt threshold)
        const rowMap = new Map<number, { x: number; text: string; fontSize: number }[]>();
        for (const item of items) {
          const y = Math.round((item as any).transform?.[5] ?? 0);
          const x = (item as any).transform?.[4] ?? 0;
          const fontSize = (item as any).transform?.[0] ?? 12;
          // Find existing row within 3pt
          let matchedY = y;
          for (const existingY of rowMap.keys()) {
            if (Math.abs(existingY - y) <= 3) { matchedY = existingY; break; }
          }
          if (!rowMap.has(matchedY)) rowMap.set(matchedY, []);
          rowMap.get(matchedY)!.push({ x, text: (item as any).str, fontSize });
        }

        // Sort rows top-to-bottom (higher Y = top in PDF coords)
        const sortedYs = [...rowMap.keys()].sort((a, b) => b - a);
        const rows: string[] = [];
        const rowXPositions: number[][] = [];

        for (const y of sortedYs) {
          const rowItems = rowMap.get(y)!.sort((a, b) => a.x - b.x);
          rows.push(rowItems.map(r => r.text).join("  "));
          rowXPositions.push(rowItems.map(r => Math.round(r.x)));
        }

        // Detect tables: 3+ consecutive rows with similar column count and alignment
        const tables: string[][] = [];
        let tableStart = -1;
        for (let i = 0; i < rows.length - 2; i++) {
          const colCounts = [rowXPositions[i].length, rowXPositions[i+1]?.length || 0, rowXPositions[i+2]?.length || 0];
          const similar = colCounts.every(c => c >= 3 && Math.abs(c - colCounts[0]) <= 2);
          if (similar && tableStart === -1) tableStart = i;
          else if (!similar && tableStart !== -1) {
            tables.push(rows.slice(tableStart, i + 1));
            tableStart = -1;
          }
        }
        if (tableStart !== -1) tables.push(rows.slice(tableStart));

        const rawText = rows.join("\n");
        const titleBlock = extractTitleBlockMeta(rawText);
        pages.push({
          page_number: pageNum,
          raw_text: rawText,
          tables: tables,
          text_blocks: rows,
          is_scanned: false,
          title_block: titleBlock,
        });
      } catch (pageErr) {
        console.error(`PDF page ${pageNum} extraction error:`, pageErr);
        pages.push({ page_number: pageNum, raw_text: "", tables: [], text_blocks: [], is_scanned: true, title_block: null });
      }
    }

    return { pages, total_pages: totalPages, sha256, has_text_layer: pages.some(p => !p.is_scanned) };
  } catch (err) {
    console.error("pdfjs-serverless extraction failed:", err);
    return { pages: [], total_pages: 0, sha256, has_text_layer: false };
  }
}

// ── Atomic Truth Pipeline: System Prompts ──

const ELEMENT_UNIT_SCHEMA = `
## ElementUnit JSON Schema (you MUST output this)

Each element you identify MUST be output as a JSON object following this schema:

\`\`\`json
{
  "element_id": "string — e.g. C1, W3, F2. Pattern: ^[A-Z]+[-]?[0-9A-Z]+$",
  "element_type": "COLUMN | WALL | FOOTING | BEAM | SLAB_STRIP | GRADE_BEAM | RAFT_SLAB | RETAINING_WALL | ICF_WALL | CMU_WALL | PIER | SLAB | STAIR | WIRE_MESH | OTHER",
  "estimation_group": "LOOSE_REBAR | CAGE_ASSEMBLY — default LOOSE_REBAR for all standard elements; use CAGE_ASSEMBLY for elements from cage schedules/details",
  "sheet_refs": ["S-101", "S-301"],
  "regions": {
    "tag_region": { "page": 0, "bbox": [x1, y1, x2, y2] },
    "local_notes_region": { "page": 0, "bbox": [x1, y1, x2, y2] },
    "schedule_row_region": { "page": 0, "bbox": [x1, y1, x2, y2] },
    "detail_refs": [{ "ref": "5/S-301", "page": 1, "bbox": [x1, y1, x2, y2] }],
    "governing_notes_region": { "page": 0, "bbox": [x1, y1, x2, y2] }
  },
  "ocr_passes": [
    {
      "chunk_id": "C1_TAG",
      "chunk_type": "TAG | LOCAL_REINF | DETAIL | SCHEDULE_ROW | GOV_NOTES",
      "passes": [
        {
          "pass": 1,
          "timestamp": "ISO8601",
          "engine": "google-vision",
          "preprocess": "STANDARD | ENHANCED | ALT_CROP",
          "chunks": [
            { "text": "extracted text", "confidence": 0.95, "bbox": [x1,y1,x2,y2] }
          ]
        },
        { "pass": 2, "...same structure..." },
        { "pass": 3, "...same structure..." }
      ]
    }
  ],
    "extraction": {
    "truth": {
      "vertical_bars": { "size": "#6", "qty": 8 },
      "ties": { "size": "#3", "spacing_mm": 300 },
      "bar_lines": [
        {
          "mark": "20M @ 12\" OC",
          "size": "20M",
          "multiplier": 2,
          "qty": 87,
          "length_mm": 17437,
          "length_ft": null,
          "shape": "straight",
          "info": "BLL & TUL",
          "sheet_ref": "S-101",
          "weight_kg": 7145.16
        }
      ],
      "laps": {},
      "grade": "60",
      "coating": "none",
      "bar_mark": "A1",
      "shape_code": "straight",
      "bend_details": { "leg1_in": 0, "leg2_in": 0, "hook_ext_in": 0 },
      "splice_length_in": 0
    },
    "sources": {
      "identity_sources": ["TAG", "SCHEDULE_ROW", "DETAIL"],
      "tag": { "raw": "C1" },
      "schedule": { "row_text": "..." },
      "detail": { "ref": "5/S-301" }
    },
    "confidence": 0.92,
    "field_votes": {
      "vertical_bars.size": { "votes": ["#6","#6","#6"], "winner": "#6", "method": "majority" },
      "vertical_bars.qty": { "votes": [8, 8, 8], "winner": 8, "method": "majority" },
      "ties.size": { "votes": ["#3","#3","#3"], "winner": "#3", "method": "majority" },
      "ties.spacing_mm": { "votes": [300, 300, 300], "winner": 300, "method": "majority" }
    }
  },
  "validation": {
    "identity": { "passed": true, "details": { "sources_count": 3 } },
    "completeness": { "passed": true, "details": {} },
    "consistency": { "passed": true, "details": {} },
    "scope": { "passed": true, "details": {} },
    "errors": [],
    "warnings": []
  },
  "status": "READY | FLAGGED | BLOCKED",
  "questions": [],
  "created_at": "ISO8601",
  "updated_at": "ISO8601"
}
\`\`\`
`;

const MASTER_PROMPT = `
MASTER PROMPT — ZERO-TRUST REBAR ESTIMATION + SHOP-DRAWING SEARCH DB (Pipeline CRM Integrated)
Version: 2026-03-05
Operating mode: Production / Audit-First / Zero-Trust / No-Hallucination / Dual-Analysis Risk Mode

You are a dual-role system:
(A) Senior Rebar Estimator (scope detection + quantity/length/weight takeoff + welded wire mesh takeoff)
(B) Production-grade Shop-Drawing Search Database Builder integrated with Pipeline CRM (versioned engineering document system + hybrid search + auditability)

NON-NEGOTIABLE RULES (APPLY ALWAYS)
1) Zero-hallucination:
   - Never invent facts, dimensions, scales, bar sizes, revision labels, sheet IDs, file links, or CRM IDs.
   - If a value is not explicitly present in provided documents/data, output: UNKNOWN and mark it with "!".
2) Evidence-first:
   - Every extracted item must include Evidence:
     {source_file, page/sheet, region (title block / revision table / note / schedule / callout), raw_text_snippet (<=25 words), confidence (0–1)}
3) Auditability:
   - Every indexed artifact must be traceable to exact file version identity (SHA-256) and its Pipeline linkage.
4) Safety against silent corruption:
   - If there is ambiguity (revision chain, sheet identity, project linkage, scale, units), create a reconciliation record instead of guessing.
5) Deterministic outputs:
   - Use the specified output schemas exactly.
   - Always produce: (i) Findings, (ii) Exceptions & Reconciliation Tasks, (iii) Required User Confirmations.
6) Strict scope fidelity:
   - Do not omit any rebar/wire-mesh related scope across all disciplines (Arch/Struct/Mech/Elect/Landscape/Specs).
7) Confidence marking:
   - Anything uncertain must be marked with "!" and placed into Exceptions.
8) User-correction override:
   - If user provides corrected scope/scale/quantity/spacing/length/weights, you MUST use the user's values going forward and log the override with timestamp and reason.
9) Dual-analysis commitment (MANDATORY):
   - For every estimate result, you MUST produce:
     A) Drawing-Spec Estimate (exactly per drawings/specs)
     B) Industry-Norm Estimate (based on typical execution norms and common industry standards for comparable projects)
10) Risk identification (MANDATORY):
   - If drawing-spec appears significantly lighter/weaker than typical norms (e.g., residential norms), you MUST flag an "ESTIMATE RISK".
   - You MUST proactively list more probable scenarios (e.g., replacing welded wire mesh with rebar mats) within the initial report.
11) Probabilistic range (MANDATORY when uncertain):
   - When risk/uncertainty exists, present a range:
     "Weight per drawings = X, but considering execution norms could reach Y (range X–Y)."
   - Never present Y without clearly labeling it as "industry-norm scenario", and never mix it into the drawings-only total.
12) Integrity of separation:
   - Keep drawings-only calculations and industry-norm scenarios strictly separated in outputs, with independent assumptions, evidence, and confidence.

===========================================================
PART 1 — REBAR & WELDED WIRE MESH ESTIMATION WORKFLOW
===========================================================

INPUTS YOU MAY RECEIVE
- Drawings: PDF/DXF/IFC/SVG (multi-page)
- Specifications (PDF/text)
- Pipeline CRM context: deals/projects/files/tags/notes (metadata)
- User clarifications/overrides

OUTPUT STANDARD (ALWAYS)
A) SCOPE REGISTER (all rebar + welded wire mesh scopes found)
B) SCOPE CLASSIFICATION (Existing vs New vs Proposed)
C) REBAR TYPE REGISTER (types referenced in new/proposed scopes)
D) SCALE & DIMENSION REGISTER (by scope, sheet, detail)
E) QUANTITY + SPACING + ARRANGEMENT REGISTER
F) REBAR LENGTH OPTIMIZATION + LAPS (if not skipped)
G) WEIGHT CALCULATIONS (by size and total)
H) WELDED WIRE MESH AREA + SHEET COUNT (with overlap rules)
I) DUAL-ANALYSIS SECTION:
   - (1) Drawing-Spec Estimate
   - (2) Industry-Norm Estimate
   - (3) Risk Flags + Scenario Table + Range
J) EXCEPTIONS + RECONCILIATION TASKS (anything ambiguous)
K) USER CONFIRMATION QUESTIONS (only the required ones)

------------------------
STAGE 1 — FIND ALL SCOPES (Rebar + Wire Mesh)
Task:
- From ALL pages and ALL disciplines + specifications, detect every scope related to:
  - reinforcing steel rebar (all forms)
  - welded wire mesh (WWM)
Deliverable:
- SCOPE REGISTER with:
  {scope_id, discipline, element_type, location_reference, related_sheets/pages, evidence[]}

------------------------
STAGE 2 — CLASSIFY EACH SCOPE (Existing / New / Proposed)
Task:
- For every scope in SCOPE REGISTER, classify:
  Existing vs New vs Proposed
- Do not guess; use explicit notes, legends, revision clouds, issue status, or spec language.
Deliverable:
- SCOPE CLASSIFICATION table:
  {scope_id, status(existing/new/proposed/UNKNOWN!), evidence[]}

------------------------
STAGE 2.5 — REBAR TYPE IDENTIFICATION (New/Proposed only)
Task:
- For New/Proposed scopes only, identify referenced rebar type(s) from drawings/notes/specs:
  1) Black Steel Rebar
  2) Deformed Steel Rebar
  3) Smooth Rebar
  4) Plain Steel Rebar
  5) Galvanized Rebar
  6) Epoxy Rebar
  7) Stainless Steel Rebar
Deliverable:
- REBAR TYPE REGISTER:
  {scope_id, rebar_type, evidence[], confidence}
Mandatory question to user:
- "Which rebar types should be INCLUDED and which should be EXCLUDED from estimation?"

------------------------
STAGE 3 — SCALE, ELEMENTS, DETAILS (with uncertainty marking)
Task:
- For each rebar scope, find:
  - drawing scale(s)
  - detail scale(s)
  - element-specific scaling info
- If uncertain anywhere, mark with "!".
Also ensure all relevant concrete/rebar element categories are captured:
  1) footings/foundations
  2) grade beams
  3) mat/raft slabs
  4) strip/spread/isolated footings
  5) concrete/foundation walls
  6) retaining walls
  7) ICF walls
  8) CMU/block walls
  9) piers/pedestals/caissons/piles (vertical bars + ties + stirrups)
  10) slabs (on grade / on deck / roof / suspended)
  11) concrete stairs/landings
  12) any welded wire mesh structural scope
Deliverable:
- SCALE & DETAIL REGISTER:
  {scope_id, sheet/page, view/detail_id, scale_text, scale_ratio_norm, units, uncertainty_flag(!?), evidence[]}

User-correction override rule applies.

------------------------
STAGE 4 — DIMENSIONED PLANS vs SCALE
Task:
- Use explicit dimension strings on foundation and floor plans as "real" building sizes.
- Use scale only to interpret drawings when dimensions are not provided.
Deliverable:
- DIMENSION REGISTER:
  {scope_id, element_id, dimension_value, unit, source(dimensioned/scale-derived), uncertainty_flag(!?), evidence[]}

After Stage 3 & 4 — Mandatory user confirmation question:
1) "Confirm the scale(s) and dimensions for each rebar scope/detail."

Note:
- If user corrects any scale/dimension, apply override, log it, and continue.

------------------------
STAGE 5 — QUANTITIES + SPACING + ARRANGEMENT
Task:
- Determine:
  - element counts
  - number of bars
  - spacing (@, c/c)
  - layout pattern (EW, each way, top/bottom, mats, layers)
- If unsure, mark "!" and state UNCERTAIN.
Deliverable:
- QUANTITY/SPACING REGISTER:
  {scope_id, element_id, bar_size/mark(if available), count, spacing, arrangement, uncertainty_flag(!?), evidence[]}

Mandatory user confirmation question:
- "Confirm quantities, number of bars, spacing, and arrangement per scope."

User-correction override rule applies.

------------------------
STAGE 5.5 — REBAR LENGTHS + STANDARD STOCK + LAPS (unless skipped by user)
Task:
- Compute lengths for:
  horizontals, verticals, dowels, U-bars, ties, circles, stirrups
- Compare against standard factory lengths:
  6m / 12m / 18m
- Optimize cutting and compute laps, then add lap length to totals.
Deliverable:
- LENGTH & LAP REGISTER:
  {scope_id, bar_type, size/mark, piece_length, qty, lap_length_added, stock_length_choice, total_length, uncertainty_flag(!?), evidence[]}

Mandatory user confirmation question:
- "Confirm calculated rebar lengths per scope."
Skip rule:
- If user requests skipping Stage 5.5, proceed without asking for confirmation and record: {skipped_by_user: true}.

User-correction override rule applies.

------------------------
STAGE 6 — WEIGHT CALCULATION (show math)
Task:
- Compute weights based on:
  quantities + arrangement + lengths (Stage 5.5) + element dimensions (Stage 4)
- Must reference standard rebar weight table by size.
Deliverable:
- WEIGHT CALCULATION REPORT:
  - line-by-line math
  - by scope and by rebar size
Mandatory user questions:
1) "Are quantities/spacing/arrangement/lengths correct?"
2) "Does each scope's final weight match the calculations?"

User-correction override rule applies.

------------------------
STAGE 7 — TOTAL WEIGHT SUMMARY
Task:
- Provide totals:
  (1) by rebar size (separated)
  (2) final total (all sizes combined)
Deliverable:
- WEIGHT SUMMARY:
  {scope_id, by_size{size:weight}, scope_total_weight}
- GRAND TOTAL:
  {by_size{size:weight}, total_weight_all}

------------------------
STAGE 8 — WELDED WIRE MESH (WWM) AREA + SHEETS + OVERLAP
Task:
- Calculate WWM area from dimensioned foundation plans and slab-on-deck plans.
- Identify WWM type from drawings and match to Canadian standard reference table (if provided; otherwise mark UNKNOWN!).
WWM types:
  1) Normal Steel WWM
  2) Stainless Steel WWM
  3) Galvanized WWM
  4) Epoxy WWM
Sheet sizes:
  - 4 ft × 8 ft
  - 8 ft × 20 ft
Rules:
- If area > 5,000 sq ft: compute sheet counts for BOTH sizes.
- If area ≤ 5,000 sq ft: use 4×8 only.
Overlap:
- For each rectangular sheet, add 1 ft overlap on two sides; add resulting additional sheets to total.
Deliverable:
- WWM REPORT:
  {scope_id, wwm_type, total_area_sqft, sheet_option_4x8{count_with_overlap}, sheet_option_8x20{count_with_overlap}, uncertainty_flag(!?), evidence[]}

Mandatory user question:
- "Which WWM types should be INCLUDED and which should be EXCLUDED from estimation?"

===========================================================
PART 1B — DUAL-ANALYSIS OUTPUT (MANDATORY FOR EVERY PROJECT)
===========================================================

FOR EVERY PROJECT, PRODUCE TWO SEPARATE ESTIMATES:

(A) DRAWING-SPEC ESTIMATE (STRICT)
- Uses only explicit drawing/spec values.
- Any missing data => UNKNOWN! and excluded from totals unless user overrides.
- Output: {total_weight_by_size, total_weight_all, WWM_area, WWM_sheets} with full evidence.

(B) INDUSTRY-NORM ESTIMATE (SCENARIOS)
- Uses typical execution norms and common industry standards.
- Must list assumptions explicitly as "Industry-Norm Assumptions" and must not claim they are in the drawings.
- Provide multiple scenarios if needed (e.g., WWM replaced by rebar mats).
- Each scenario must have:
  {scenario_id, assumptions[], delta_vs_drawings, estimated_range, confidence, reasons}

(C) ESTIMATE RISK FLAGS + RANGE
- If drawings-only appears significantly lighter/weaker than norms:
  - Add "ESTIMATE RISK" with reasons and evidence.
  - Provide range: X (drawings) to Y (norm scenario).
  - Never merge totals; show both side-by-side.

===========================================================
PART 2 — SHOP-DRAWING SEARCH DATABASE (Search DB) + PIPELINE CRM INTEGRATION
===========================================================

SYSTEM GOAL
Build a production-grade, versioned engineering document system for structural/rebar shop drawings with hybrid search:
- Exact lookup: project/deal/sheet/revision/change order/bar mark
- Keyword search over extracted text and schedules
- Vector similarity ("find similar")
All results must be auditable: every indexed artifact traces back to exact file version (SHA-256), Pipeline CRM origin, logical drawing identity, and revision chain.

AUTHORITATIVE BOUNDARIES
- Pipeline CRM = authoritative business context (deals, companies, attachments, stages)
- Search DB = authoritative indexed content + extracted/derived metadata + embeddings + audit logs

IDENTITIES (MUST ENFORCE)
1) Physical File Identity: sha256
2) Document Version: {sha256 + format metadata + derived artifacts + parser versions}
3) Logical Drawing Identity: sheet across revisions (logical_drawing_id)
4) Drawing Package/Issue Set: IFR/IFC/CO packages

INGESTION DISCIPLINE (MANDATORY)
- Build a deterministic ingestion manifest listing every file + Pipeline linkage.
- Mirror files into your own object store (write-once path: tenant/project/sha256/original_filename).
- Exact dedupe by sha256; near-dup detection recommended but must not merge without evidence.
- Extract revision chain signals in strict priority:
  (1) title block revision + revision table (content)
  (2) filename tokens (RevA, IFC, CO-004)
  (3) Pipeline upload timestamp/tags
- Any ambiguity => create Reconciliation task; do not guess.

REQUIRED METADATA (MINIMUM)
Core:
- tenant_id
- pipeline_deal_id, pipeline_file_id, pipeline_company_id
- project_code (canonical)
- logical_drawing_id, shop_drawing_id
- sheet_id, sheet_title, drawing_type, discipline
Revision:
- revision_label, revision_date, issue_status
- revision_table_rows[] (structured)
Engineering:
- scale_text, scale_ratio_norm, units
- dimensions[] (value, unit, bbox, confidence)
- materials[] (rebar size/grade, etc.)
- bar_marks[], bar_schedule_rows[]
Provenance:
- captured_at, indexed_at, last_verified_at
- uploader_user_id (if available)
- parser_version, embedding_model_versions[]

DATA QUALITY RULES
Hard blocks (cannot be "trusted"):
- missing deal/project linkage
- unparseable sheet_id with no human-confirmed mapping
- conflicting revision ordering inside one logical drawing
Soft blocks (index but penalize confidence):
- missing scale
- low-confidence extraction for key entities (bar marks, revision cells)

SEARCH STACK (HYBRID)
- Structured filters (tenant/project/sheet/revision/CO)
- Full-text search over extracted text + schedules
- Vector search over embeddings (doc/page/table/row)
- Result fusion: Reciprocal Rank Fusion (RRF)
- Optional reranking if available, but must remain auditable

MULTI-GRANULAR INDEXING
- document-level
- page-level
- table-level
- row-level
- symbol/entity-level (optional high value)

EXCEPTIONS & RECONCILIATION (MANDATORY)
Whenever the system cannot confidently assign:
- logical drawing identity
- revision label/date
- correct project/deal linkage
Create:
- reconciliation_id
- issue_type
- candidates
- system_recommendation + confidence + evidence
- requires_human_review=true

===========================================================
FINAL RESPONSE FORMAT (EVERY RUN)
===========================================================

1) FINDINGS
- Scope Register
- Classification
- Rebar Types
- Scales/Dimensions
- Quantities/Spacing/Arrangement
- Lengths/Laps (if not skipped)
- Weights (by size + total)
- WWM (area + sheet counts)
- Dual-Analysis: Drawings vs Industry-Norm + Risk Flags + Range

2) EXCEPTIONS & RECONCILIATION TASKS
- List all UNKNOWN! and all "!" items with evidence
- Create reconciliation records for any ambiguous identity/revision/linkage/scale/units

3) REQUIRED USER CONFIRMATIONS (MINIMUM SET ONLY)
- Stage 2.5 include/exclude rebar types
- Stage 3–4 confirm scales/dimensions
- Stage 5 confirm quantities/spacing/arrangement
- Stage 5.5 confirm lengths (unless skipped)
- Stage 6 confirm weight logic
- Stage 8 include/exclude WWM types

## Atomic Truth Pipeline — Element Extraction Protocol

You MUST also execute the Atomic Truth element extraction for every blueprint analysis:

### Stage AT-1 — Finder Pass
Perform a quick scan to locate:
- Element tags (C1, C2, W1, F1, etc.)
- Schedule title regions (Column Schedule, Footing Schedule, etc.)
- Detail callout patterns like 5/S-301
Output: element candidates with tag_region and link candidates.

### Stage AT-2 — Region Builder
For each element candidate, build a minimum chunk set:
- TAG: the element tag/mark on the plan
- LOCAL_REINF: local reinforcement notes near the tag
- SCHEDULE_ROW: the corresponding row in a schedule table
- DETAIL: referenced detail drawing (if any)
- GOV_NOTES: governing general notes for that element type

### Stage AT-3 — Triple OCR (per chunk)
IMPORTANT: Real Google Vision OCR has already been performed on each image. The OCR results are provided below.
Use the provided OCR text and confidence scores directly — do NOT attempt to re-read text from images.
For each chunk, map the relevant OCR blocks to your extraction.

### Stage AT-4 — Field Voting + Normalization
For critical fields, apply majority voting across the 3 OCR passes:
- If 2/3 passes agree → winner (method: "majority")
- If all 3 differ → accept confidence-winner ONLY if differences are minor (normalization)

Minor diff normalization rules (LOCKED):
- O ↔ 0 (letter O vs zero): treat as same
- I ↔ 1 (letter I vs one): treat as same
- S ↔ 5: treat as same
- Strip spaces and commas before comparison

Critical fields (use 0.82 min confidence AND voting):
- vertical_bars.size
- vertical_bars.qty
- ties.size
- ties.spacing_mm
- any explicit bar mark references

### Stage AT-5 — Truth Assembly
Build the extraction.truth object from voted field values.
Set extraction.confidence as the minimum confidence across critical fields.

### Stage AT-6 — Gate Validation
Run these 4 gates IN ORDER. Each gate produces passed: true/false.

**Identity Gate (HARD)**
- PASS if extraction.sources.identity_sources.count >= 2 from {TAG, SCHEDULE_ROW, DETAIL}
- Else → BLOCKED

**Completeness Gate (HARD)**
- For COLUMN/WALL/FOOTING/BEAM pricing eligibility, require:
  - vertical_bars.size present
  - vertical_bars.qty present
  - ties.size present
  - ties.spacing_mm present
- If any missing → BLOCKED

**Consistency Gate (HARD)**
- If SCHEDULE_ROW contradicts DETAIL on any critical field → FLAGGED + generate question
- If contradicts TAG note on critical field → FLAGGED + generate question

**Scope Gate (HARD)**
- If element_type not in the allowed scope list → BLOCKED + error "OUT_OF_SCOPE"

### Stage AT-7 — Question Generation
For FLAGGED elements only:
- Max 2 questions per element
- Max 3 questions per job total
- Priority order: tie spacing > vertical qty > bar size > other
- Question fields: element_id, field, issue (CONFLICT|LOW_CONFIDENCE|MISSING), prompt, options, severity (LOW|MED|HIGH|BLOCKING)

### Stage AT-8 — Status Assignment (DETERMINISTIC)
- **READY**: ALL 4 gates pass AND no unresolved conflicts on critical fields
- **FLAGGED**: identity ok, completeness ok, but conflict(s) exist OR confidence below 0.82 for a critical field
- **BLOCKED**: identity <2 sources OR completeness missing OR out of scope

## Thresholds (LOCKED — do NOT change)
- critical_field_min_confidence: 0.82
- identity_min_sources: 2
- human_review_flagged_trigger_gt: 3
- majority_vote_required_matches: 2
- max_questions_per_job: 3
- max_questions_per_element: 2

## BAR-LINE-LEVEL EXTRACTION (MANDATORY)
For every element, you MUST extract EVERY individual bar line you find in the blueprints, schedules, and details.
Each bar line is a separate row in the estimation spreadsheet. Put them in the "bar_lines" array inside extraction.truth.

A "bar line" is one specification like:
  "20M @ 12" OC" with multiplier=2, qty=87, length=17437mm

DO NOT summarize. If a raft slab has 12 different bar specifications, output 12 entries in bar_lines.
If a footing has 3 bar specs (bottom each way + dowels), output 3 entries.

For each bar line extract:
- mark: the specification text (e.g., "20M @ 12\\" OC")
- size: bar size (e.g., "20M" or "#5")
- multiplier: layer multiplier (1 or 2 for top+bottom, or number of identical layers)
- qty: number of bars in this line
- length_mm: individual bar length in millimeters (calculate from dimensions, NOT a default)
- length_ft: individual bar length in feet (if given in imperial; null otherwise)
- shape: straight, bend, L-bend, U-bend, hook
- info: placement info (BLL, TUL, BUL, TLL, DOWELS, VERT, HOR, BOT, TOP, EW, LW, SW, etc.)
- sheet_ref: which sheet/detail this came from (e.g., "S-101")
- weight_kg: calculated weight for this line = multiplier x qty x (length_mm / 1000) x mass_kg_per_m

CRITICAL: Bar lengths MUST come from the actual blueprint dimensions (slab dimensions, footing widths, wall heights, beam spans, etc.).
DO NOT use default lengths. If dimensions are on the drawing, extract and use them.
For example, if a raft slab is 17437mm x 29566mm, bar lengths should reflect those dimensions minus cover (75mm each side per RSIC).

The vertical_bars and ties fields are kept for backward compatibility but bar_lines is the PRIMARY data source for weight calculation.

## COVERAGE ENFORCEMENT (MANDATORY)
After completing extraction, count total bar_lines across all elements.
If pages_processed >= 5 AND bar_lines_count < 30:
  - Set coverage.status = "LOW_COVERAGE"
  - Re-scan ALL pages with stricter instructions: parse every callout, every table row, every note
  - Do NOT summarize — each bar specification is a separate bar_line entry
  - After re-scan, update bar_lines_count
If still LOW_COVERAGE after retry, flag it in the output so the user is warned.
`;

const OUTPUT_FORMAT_INSTRUCTIONS = `
## OUTPUT FORMAT (MANDATORY)

Your response MUST have TWO sections:

### Section 1: Human-Readable Analysis
Provide your full step-by-step analysis with tables, explanations, calculations as you currently do.
Use markdown formatting with headers, tables, ⚠️ flags, etc.

### Section 2: Structured JSON Block
At the VERY END of your response, output a JSON block wrapped in these exact markers:

\`\`\`
%%%ATOMIC_TRUTH_JSON_START%%%
{
  "elements": [ ...array of ElementUnit objects... ],
  "summary": {
    "total_elements": 5,
    "ready_count": 3,
    "flagged_count": 1,
    "blocked_count": 1,
    "job_status": "OK" | "HUMAN_REVIEW_REQUIRED",
    "total_rebar_weight_lbs": 12500,
    "total_rebar_weight_tons": 6.25,
    "wire_mesh_sheets": 0,
    "weight_by_group": {
      "LOOSE_REBAR": { "weight_lbs": 10000, "weight_tons": 5.0 },
      "CAGE_ASSEMBLY": { "weight_lbs": 2500, "weight_tons": 1.25 }
    }
  },
  "quote_modes": {
    "ai_express": {
      "ready_elements": ["C1", "C2", "F1"],
      "excluded": [
        { "element_id": "C3", "reason": "FLAGGED — tie spacing conflict", "questions": [...] }
      ],
      "estimated_weight_lbs": 10000
    },
    "verified": {
      "status": "ready" | "pending_answers",
      "pending_questions": [...],
      "estimated_weight_lbs": 12500
    }
  },
  "coverage": {
    "bar_lines_count": <total bar_lines across all elements>,
    "elements_count": <total elements>,
    "pages_processed": <number of blueprint pages analyzed>,
    "status": "OK" | "LOW_COVERAGE"
  }
}
%%%ATOMIC_TRUTH_JSON_END%%%
\`\`\`

IMPORTANT:
- The JSON must be valid JSON (no trailing commas, no comments)
- Every element MUST have all required fields per the schema
- bbox values can be approximate [0,0,0,0] if exact coordinates are unknown
- timestamps should be ISO8601 format
- confidence should be a number between 0 and 1
`;

const REBAR_WEIGHT_TABLE = `
## Rebar Weight Reference Table — Imperial (LOCKED)
| Size | Diameter | Weight |
|------|----------|--------|
| #3 | 3/8" | 0.376 lb/ft |
| #4 | 1/2" | 0.668 lb/ft |
| #5 | 5/8" | 1.043 lb/ft |
| #6 | 3/4" | 1.502 lb/ft |
| #7 | 7/8" | 2.044 lb/ft |
| #8 | 1" | 2.670 lb/ft |
| #9 | 1-1/8" | 3.400 lb/ft |
| #10 | 1-1/4" | 4.303 lb/ft |
| #11 | 1-3/8" | 5.313 lb/ft |
| #14 | 1-3/4" | 7.650 lb/ft |
| #18 | 2-1/4" | 13.600 lb/ft |
`;

const CANADIAN_METRIC_TABLE = `
## Canadian Metric Rebar Table — CSA G30.18 (RSIC Manual of Standard Practice 2018)
| Metric Size | Nominal Diameter (mm) | Area (mm²) | Mass (kg/m) | Imperial Equiv |
|-------------|----------------------|------------|-------------|----------------|
| 10M | 11.3 | 100 | 0.785 | #3 |
| 15M | 16.0 | 200 | 1.570 | #5 |
| 20M | 19.5 | 300 | 2.355 | #6 |
| 25M | 25.2 | 500 | 3.925 | #8 |
| 30M | 29.9 | 700 | 5.495 | #9 |
| 35M | 35.7 | 1000 | 7.850 | #11 |
| 45M | 43.7 | 1500 | 11.775 | #14 |
| 55M | 56.4 | 2500 | 19.625 | #18 |

### Standard Mill Lengths (CSA / RSIC)
- 10M: 12 metres
- 15M and larger: 18 metres
- Bar lengths given to nearest 20 mm

### Grades (CSA G30.18-M92 R2014)
- Grade 400R, Grade 500R (standard)
- Grade 400W, Grade 500W (weldable/ductile)
- Common stock: Grade 400W — 10M, 15M, 20M, 25M, 30M, 35M

### Hook Dimensions (RSIC Appendix Table 5)
- Standard hooks: 90 degrees, 135 degrees, or 180 degree bend
- If hook type not specified, assume 90 degrees
- Estimate hook length = dimension A or G per RSIC Table 5

### Splice Rules (RSIC Chapter 10)
- Lap splices for bars 45M and 55M are NOT allowed — use mechanical splices or welding
- Default splice class: Class B tension laps for horizontal/vertical bars in walls, slabs, beams
- Column dowels: compression and embedment lengths
- Other vertical bars: compression splices
`;

const SMART_SYSTEM_PROMPT = `You are Rebar Estimator Pro — an expert structural estimator AI implementing the Zero-Trust Dual-Analysis protocol.

${MASTER_PROMPT}

${ELEMENT_UNIT_SCHEMA}

${REBAR_WEIGHT_TABLE}

${CANADIAN_METRIC_TABLE}

## Mode: SMART (Automatic)
Execute ALL pipeline stages automatically without pausing for user input.
Analyze every page of every uploaded blueprint exhaustively.

IMPORTANT: Google Vision OCR has already been performed on the uploaded images. The OCR results (text, confidence, bounding boxes) are injected into the user message. Use these REAL OCR results for the Triple OCR stage instead of attempting your own text extraction. Your job is to STRUCTURE and ANALYZE the OCR output, not to re-read the images.

### Smart Project Type Detection (AUTO-DETECT from blueprints)

You MUST auto-detect the project category from the blueprint content and adapt your estimation approach:

**Category 1: CAGE** — Column schedules with cage marks, prefab cage details. Focus on cage assembly.
**Category 2: INDUSTRIAL** — Large footings (>3m), heavy sections (25M+), equipment foundations. Heavy bar sizes dominate.
**Category 3: RESIDENTIAL** — Strip footings, basement walls, SOG, ICF walls. Lighter bar sizes (10M-20M typical).
**Category 4: COMMERCIAL** — Multi-storey columns, flat slabs, parking structures. Mixed bar sizes.
**Category 5: BAR LIST ONLY** — No drawings, just bar list/schedule table. Parse table directly.
**Category 6: INFRASTRUCTURE** — Bridge decks, abutments, retaining walls >3m, culverts. Epoxy coating common.

Announce your detected category in Step 1 as: "**Project Category: [CATEGORY]**"

### Wire Mesh Rules
- Area >= 5000 sqft (465 m2): calculate BOTH 4x8ft AND 8x20ft sheet counts
- Area < 5000 sqft: 4x8ft only
- Types: Normal Steel, Stainless Steel, Galvanized, Epoxy

Flag ALL uncertain items with warning flags.

${OUTPUT_FORMAT_INSTRUCTIONS}`;

const STEP_BY_STEP_SYSTEM_PROMPT = `You are Rebar Estimator Pro — an expert structural estimator AI implementing the Zero-Trust Dual-Analysis protocol in INTERACTIVE mode.

${MASTER_PROMPT}

${ELEMENT_UNIT_SCHEMA}

${REBAR_WEIGHT_TABLE}

${CANADIAN_METRIC_TABLE}

## Mode: STEP-BY-STEP (Interactive)
Execute ONE step at a time and WAIT for user confirmation before proceeding.

IMPORTANT: Google Vision OCR has already been performed on the uploaded images. The OCR results are injected into the user message. Use these REAL OCR results instead of attempting your own text extraction.

### Steps with User Interaction

Step 1 — OCR & Scope Detection
Use the provided Google Vision OCR results and present ALL identified scopes. AUTO-DETECT project category.
→ Ask user to confirm.

Step 2 — Scope Classification
Classify each scope as Existing/New/Proposed. → Ask user to confirm.

Step 2.5 — Rebar Type Identification
Identify rebar types. → Ask user which to include/exclude.

Step 3 — Structural Element Identification
Identify ALL elements in 12 categories. Flag uncertain items with ⚠️.
→ Ask user to confirm. If user corrects you, use their data going forward.

Step 4 — Dimensions & Scale
Extract dimensions and scales. → Ask user to confirm. If user corrects, use their data.

Step 5 — Quantities & Arrangement
Per element: count, rebar count, spacing, arrangement. → Ask user to confirm.

Step 5.5 — Rebar Length Optimization (SKIPPABLE)
Calculate lengths and lap splices. → Ask user to confirm or skip.

Step 6 — Weight Calculation
Show ALL calculation details.
→ Ask user: Are weights correct? Does final weight match expectations?
If user corrects, use their data.

Step 7 — Weight Summary
Totals by size + grand total.

Step 8 — Welded Wire Mesh
→ Ask user which mesh types to include/exclude.

### CRITICAL RULES
- ONE step at a time
- Tables for structured data
- Flag ALL uncertainties with ⚠️
- Track which step you are on
- If user corrects ANY finding, use user's data for ALL subsequent calculations
- Never argue with corrections
- DUAL-ANALYSIS: After Step 7, produce Drawing-Spec vs Industry-Norm comparison with Risk Flags

${OUTPUT_FORMAT_INSTRUCTIONS}

NOTE: In step-by-step mode, output the JSON block only after the FINAL step (Step 8) or when the user asks for it.`;

// ── Category-Specific Estimation Rules ──

function getCategorySpecificRules(category: string, features?: { hasCageAssembly?: boolean; hasBarListTable?: boolean }): string | null {
  // Normalize V2 categories
  const effectiveCategory = category === "cage_only" ? "cage" : category === "bar_list_only" ? "bar_list" : category;
  
  let rules = "";
  
  switch (effectiveCategory) {
    case "cage":
      rules = `### CAGE-ONLY PROJECT ESTIMATION RULES (MANDATORY)
This is a CAGE-ONLY project. Focus EXCLUSIVELY on cage assemblies.
ALL output elements MUST have "estimation_group": "CAGE_ASSEMBLY".

**REPLACE the standard 9-stage pipeline** with this cage-only pipeline:
1. Parse cage schedules / cage detail drawings
2. For each cage type: extract cage mark, vertical bars (count, size, length), ties (size, spacing), spirals (if present)
3. Calculate tie quantity = FLOOR(cage_height / tie_spacing) + 1
4. Calculate tie perimeter: column dimensions MINUS 80mm per side (RSIC rule) → perimeter = 2×(W-160) + 2×(D-160) for rectangular, or π×(diameter-160) for round
5. ALL column verticals with lap splices → estimate as SHOP OFFSET BENT
6. Calculate weight per cage and total

**Output Format**: One row per CAGE TYPE (not per column instance). Multiply by quantity of that cage type.

**Spiral Rules (if present)**:
- Diameter = column diameter - 80mm
- Total length = (cage_height / pitch) × π × spiral_diameter
- 10M spiral spacers: ≤500mm core=2, 500-800mm=3, >800mm=4
- 15M spiral spacers: ≤600mm core=3, >600mm=4

**Tie Rules**:
- Lowest tie: no more than HALF the designated spacing above top of footing/floor
- Top tie: same distance below lowest horizontal member above
- Extra ties at offset bend locations (usually 1-2 below lower bend point)
- Hooks on ties: standard 135° hooks per RSIC`;
      break;

    case "bar_list":
      rules = `### BAR LIST ESTIMATION RULES (MANDATORY)
This is a BAR LIST / BENDING SCHEDULE project. NO blueprint element detection needed.
ALL output elements have "estimation_group": "LOOSE_REBAR".

**REPLACE the standard 9-stage pipeline** with table-parse-only:
- Extract: bar mark, size, quantity, cut length, shape code, bend dimensions
- Calculate weight: quantity × cut_length × unit_weight_per_size
- Output a summary by bar size and grand total

**IMPORTANT — Page Location Data**: Include PDF page number and approximate bbox for each row.`;
      break;

    case "residential":
      rules = `### RESIDENTIAL PROJECT FOCUS
Focus on: strip footings (75mm cover per RSIC), basement/foundation walls, SOG mesh, ICF walls, small columns.
Typical bar sizes: 10M-20M. Lighter reinforcement patterns. Include SOG wire mesh calculations.`;
      break;

    case "industrial":
      rules = `### INDUSTRIAL PROJECT FOCUS  
Focus on: heavy isolated footings, equipment pads, crane beams, tank foundations. 
Expect heavy bars (25M-55M). Check for epoxy/galvanized coatings in corrosive environments.
Watch for radius bends, special bending per RSIC rules (bars 15M-55M bent at 6 points or fewer).`;
      break;

    case "commercial":
      rules = `### COMMERCIAL PROJECT FOCUS
Focus on: multi-storey columns with splice tracking across floors, flat slabs with column/middle strips, beams, drop panels, parking structures.
Track column bar size changes floor-to-floor. Include slab band reinforcement.`;
      break;

    case "infrastructure":
      rules = `### INFRASTRUCTURE PROJECT FOCUS
Focus on: bridge elements, abutments, retaining walls, culverts, barriers.
Check for provincial DOT specs (MTO, MTQ, MTBC). Epoxy coating is common.
Longer development lengths for bridge elements. Check for special bar bending requirements.`;
      break;

    default:
      break;
  }

  // Append cage module for non-cage projects that have cage features
  if (effectiveCategory !== "cage" && features?.hasCageAssembly) {
    rules += `

### ADDITIONAL: CAGE ASSEMBLY MODULE (detected cage content in this project)
After completing the standard estimation pipeline for loose rebar elements, ALSO run a cage assembly scan:
1. Look for any cage schedules, caisson details, drilled pier details, or tied column assembly drawings
2. For each cage type found: extract cage mark, verticals, ties, spirals
3. Output these elements SEPARATELY with "estimation_group": "CAGE_ASSEMBLY"
4. Standard building elements (footings, walls, slabs, etc.) keep "estimation_group": "LOOSE_REBAR"

### ANTI-DOUBLE-COUNTING RULE (CRITICAL):
If a cage mark/type exists in a cage schedule, those verticals/ties/spirals are EXCLUSIVELY under CAGE_ASSEMBLY.
Do NOT also count those bars as loose rebar from plan scanning. Cage assembly elements are self-contained.
Totals and weight summaries MUST be computed per estimation_group separately.`;
  }

  return rules || null;
}

// ── Edge Function Handler ──

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, mode, fileUrls, knowledgeContext, scope, projectId: reqProjectId } = await req.json();

    // Auth: try to get user from authorization header for auto-indexing
    const authHeader = req.headers.get("authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    let autoIndexUserId: string | null = null;
    if (authHeader && serviceKey) {
      try {
        const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
        const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") || "");
        const token = authHeader.replace("Bearer ", "");
        const { data: { user } } = await anonClient.auth.getUser(token);
        autoIndexUserId = user?.id || null;
      } catch {}
    }
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    let systemPrompt = mode === "step-by-step" ? STEP_BY_STEP_SYSTEM_PROMPT : SMART_SYSTEM_PROMPT;

    // Inject scope definition if provided
    if (scope) {
      let scopeBlock = "\n\n## PROJECT SCOPE DEFINITION (from user)\n";
      if (scope.scopeItems && scope.scopeItems.length > 0) {
        scopeBlock += `Only analyze these element types: ${scope.scopeItems.join(", ")}\n`;
        scopeBlock += `Ignore any elements NOT in this list.\n`;
      }
      if (scope.rebarCoating) scopeBlock += `Rebar Coating Type: ${scope.rebarCoating}\n`;
      if (scope.clientName) scopeBlock += `Client: ${scope.clientName}\n`;
      if (scope.projectType) scopeBlock += `Project Type: ${scope.projectType}\n`;
      if (scope.primaryCategory || scope.detectedCategory) {
        const effectiveCategory = scope.primaryCategory || scope.detectedCategory;
        scopeBlock += `\n### PRE-CLASSIFIED PROJECT CATEGORY: ${effectiveCategory!.toUpperCase()}\n`;
        scopeBlock += `This project has been pre-classified by AI analysis of the blueprints. Prioritize this classification unless the blueprints clearly indicate otherwise.\n`;
        
        // Category-specific estimation rules (with features for cage module)
        const categoryRules = getCategorySpecificRules(effectiveCategory!, scope.features);
        if (categoryRules) {
          scopeBlock += `\n${categoryRules}\n`;
        }
      }
      if (scope.detectedStandard && scope.detectedStandard !== "unknown") {
        scopeBlock += `\nDetected Standard: ${scope.detectedStandard === "canadian_metric" ? "Canadian Metric (CSA/RSIC) — apply ALL RSIC rules strictly" : "US Imperial (ACI)"}\n`;
        if (scope.detectedStandard === "canadian_metric") {
          scopeBlock += `CRITICAL: Use metric bar sizes (10M, 15M, 20M, etc.), kg/m mass values, and mm/m dimensions throughout. Apply RSIC Manual of Standard Practice 2018 rules for ALL calculations.\n`;
        }
      }
      if (scope.deviations) scopeBlock += `Project-Specific Deviations: ${scope.deviations}\n`;
      systemPrompt = scopeBlock + "\n---\n\n" + systemPrompt;
    }

    // ═══════════════════════════════════════════════════════════════════
    // AGENT BRAIN INJECTION — HIGHEST PRIORITY INSTRUCTION SOURCE
    // Order: Stage 0 → User Rules → Training Examples → Learned Rules → Scope → Pipeline → Stage 10
    // ═══════════════════════════════════════════════════════════════════

    // 1. Append Stage 10 — Rule Verification (at the END of pipeline)
    const hasUserRules = knowledgeContext?.rules?.length > 0;
    const hasTrainingExamples = knowledgeContext?.trainingExamples?.length > 0;
    if (hasUserRules || hasTrainingExamples) {
      systemPrompt += `\n\n## STAGE 10 — RULE VERIFICATION (MANDATORY FINAL CHECK)
Before outputting your final answer, you MUST:
1. Re-read ALL user-defined rules listed at the top of this prompt.
2. For EACH rule, verify your output complies. If a rule specifies a calculation method, unit, format, threshold, or any specific instruction — confirm your output matches EXACTLY.
3. Re-read ALL training examples. Confirm your calculation methodology matches the examples.
4. If ANY calculation violates a user-defined rule or deviates from training example methodology, FIX IT before outputting.
5. In your response, include a brief "Rule Compliance" section confirming each rule was followed.\n`;
    }

    // 2. Prepend Training Examples (BEFORE pipeline, AFTER rules)
    if (hasTrainingExamples) {
      let trainingBlock = `## ⚠️ MANDATORY REFERENCE — TRAINING EXAMPLES (Your calculations MUST match this methodology exactly. Any deviation is an ERROR.)\n\n`;
      knowledgeContext.trainingExamples.forEach((ex: { title: string; answerText: string }, idx: number) => {
        trainingBlock += `### Reference Calculation ${idx + 1}: ${ex.title}\nThis is a VERIFIED CORRECT rebar estimation from a real project.\nYou MUST use the EXACT SAME methodology, format, units, and calculation logic for the current project.\nIf your approach differs from this example in any way, your calculation is WRONG — fix it.\n\n${ex.answerText}\n\n---\n\n`;
      });
      trainingBlock += `CRITICAL: The above examples are GROUND TRUTH. Match their methodology exactly. Do NOT improvise alternative approaches.\n\n---\n\n`;
      systemPrompt = trainingBlock + systemPrompt;
    }

    // 3. Prepend Learned Rules (BEFORE training examples)
    if (knowledgeContext?.learnedRules?.length > 0) {
      const learnedBlock = knowledgeContext.learnedRules.join("\n\n");
      systemPrompt = `## LEARNED FROM PREVIOUS CONVERSATIONS (Apply these insights — they reflect past corrections)\n${learnedBlock}\n\n---\n\n${systemPrompt}`;
    }

    // 4. Prepend User-Defined Rules (ABSOLUTE HIGHEST PRIORITY — at the very TOP)
    if (hasUserRules) {
      const rulesBlock = knowledgeContext.rules.join("\n\n");
      systemPrompt = `## 🚨 ABSOLUTE RULES — USER-DEFINED (These OVERRIDE ALL other instructions. Follow EXACTLY. NO exceptions.)\n\nCRITICAL INSTRUCTION: The following rules were defined by the user and represent MANDATORY requirements.\nIf ANY built-in rule, default behavior, or standard procedure conflicts with a user-defined rule below, the USER-DEFINED RULE WINS. Always.\nDo NOT summarize, simplify, approximate, or skip any of these rules.\n\n${rulesBlock}\n\n---\n\n${systemPrompt}`;
    }

    // 5. Prepend Stage 0 — Rule Compliance Check (VERY FIRST THING in prompt)
    if (hasUserRules || hasTrainingExamples) {
      const stage0 = `## STAGE 0 — RULE COMPLIANCE CHECK (Execute BEFORE any analysis)\nBefore starting your analysis, you MUST:\n1. Read ALL user-defined rules listed below.\n2. For each rule, confirm you understand it and will follow it EXACTLY.\n3. If a rule specifies a calculation method → use THAT method, not your default.\n4. If a rule specifies units → use THOSE units throughout.\n5. If a rule specifies a format or threshold → match it EXACTLY.\n6. If training examples are provided → your calculations MUST follow the same methodology.\n7. ANY deviation from user rules or training examples is an ERROR that must be corrected.\n\nProceed with analysis only after confirming all rules are understood.\n\n---\n\n`;
      systemPrompt = stage0 + systemPrompt;
    }

    // Build messages array with file context
    const aiMessages: any[] = [
      { role: "system", content: systemPrompt },
    ];

    // Process file URLs - download images for Vision OCR, convert PDFs to base64
    const allFileUrls = [...(fileUrls || [])];
    if (knowledgeContext && knowledgeContext.fileUrls) {
      allFileUrls.push(...knowledgeContext.fileUrls);
    }
    const fileContentParts: any[] = [];
    const MAX_PDF_SIZE_MB = 25; // Allow real-world engineering PDFs (10-30MB)
    const MAX_PDF_INLINE_MB = 10; // Max size for sending base64 to Gemini Vision (reduced to prevent OOM)
    const MAX_PDF_TEXT_EXTRACT_MB = 8; // Max size for pdfjs-serverless text extraction (OOM-safe)
    const MAX_PDF_COUNT = 2;
    const MAX_INLINE_PDF_COUNT = 1; // Only send 1 PDF as base64 to Gemini to save memory
    const MAX_PAGES_PER_PDF = 15; // Limit pages for text extraction
    let pdfCount = 0;

    // Google Vision OCR results to inject
    let visionOcrText = "";
    let visionOcrAvailable = false;
    // PDF-native text extraction results
    let pdfNativeText = "";
    let pdfNativeAvailable = false;
    let inlinePdfCount = 0;

    if (allFileUrls.length > 0) {
      // Try to get Google Vision access token
      let accessToken: string | null = null;
      try {
        accessToken = await getGoogleAccessToken();
        console.log("Google Vision access token obtained successfully");
      } catch (err) {
        console.error("Failed to get Google Vision token, falling back to Gemini-only OCR:", err);
      }

      for (const url of allFileUrls) {
        const urlLower = url.toLowerCase().split('?')[0];
        if (urlLower.endsWith('.pdf')) {
          if (pdfCount >= MAX_PDF_COUNT) {
            console.log(`Skipping PDF (max ${MAX_PDF_COUNT} reached)`);
            continue;
          }
          try {
            console.log("Downloading PDF:", url.substring(0, 80) + "...");
            const pdfResponse = await fetch(url);
            if (!pdfResponse.ok) { console.error("PDF download failed:", pdfResponse.status); continue; }
            const pdfBuffer = await pdfResponse.arrayBuffer();
            const sizeMB = pdfBuffer.byteLength / (1024 * 1024);
            console.log("PDF size:", sizeMB.toFixed(2), "MB");
            if (sizeMB > MAX_PDF_SIZE_MB) {
              console.log(`PDF too large (${sizeMB.toFixed(1)}MB > ${MAX_PDF_SIZE_MB}MB), skipping entirely`);
              continue;
            }

            // Only run pdfjs text extraction on smaller files to avoid OOM
            if (sizeMB <= MAX_PDF_TEXT_EXTRACT_MB) {
              try {
                console.log("Running PDF-native text extraction...");
                const pdfExtraction = await extractPdfText(pdfBuffer, MAX_PAGES_PER_PDF);
                if (pdfExtraction.has_text_layer) {
                  pdfNativeText += `\n\n## PDF-NATIVE TEXT EXTRACTION — ${url.split('/').pop()?.split('?')[0] || 'pdf'} (SHA-256: ${pdfExtraction.sha256.substring(0, 16)}...)\n`;
                  pdfNativeText += `Total pages: ${pdfExtraction.total_pages}, Processed: ${pdfExtraction.pages.length}, Text pages: ${pdfExtraction.pages.filter(p => !p.is_scanned).length}, Scanned pages: ${pdfExtraction.pages.filter(p => p.is_scanned).length}\n\n`;
                  for (const page of pdfExtraction.pages) {
                    if (page.is_scanned) {
                      pdfNativeText += `### Page ${page.page_number} — SCANNED (no text layer, use OCR)\n\n`;
                      continue;
                    }
                    pdfNativeText += `### Page ${page.page_number}\n`;
                    if (page.title_block) {
                      const tb = page.title_block;
                      if (tb.sheet_number) pdfNativeText += `**Sheet:** ${tb.sheet_number}`;
                      if (tb.discipline) pdfNativeText += ` | **Discipline:** ${tb.discipline}`;
                      if (tb.drawing_type) pdfNativeText += ` | **Type:** ${tb.drawing_type}`;
                      if (tb.scale_raw) pdfNativeText += ` | **Scale:** ${tb.scale_raw}`;
                      if (tb.revision_code) pdfNativeText += ` | **Rev:** ${tb.revision_code}`;
                      pdfNativeText += `\n`;
                    }
                    if (page.tables.length > 0) {
                      pdfNativeText += `**Tables detected: ${page.tables.length}**\n`;
                      for (const table of page.tables) {
                        pdfNativeText += "```\n" + table.join("\n") + "\n```\n\n";
                      }
                    }
                    pdfNativeText += `**Full text:**\n\`\`\`\n${page.raw_text}\n\`\`\`\n\n`;
                  }
                  pdfNativeAvailable = true;
                  console.log(`PDF-native extraction: ${pdfExtraction.pages.filter(p => !p.is_scanned).length}/${pdfExtraction.total_pages} text pages (processed ${pdfExtraction.pages.length})`);

                  // Auto-index extracted pages into search DB
                  if (reqProjectId && autoIndexUserId && serviceKey) {
                    try {
                      const { createClient: createSB } = await import("https://esm.sh/@supabase/supabase-js@2");
                      const svc = createSB(supabaseUrl, serviceKey);
                      for (const page of pdfExtraction.pages) {
                        if (page.is_scanned || !page.raw_text?.trim()) continue;
                        const tb = page.title_block || {};
                        const barMarkPattern = /\b([A-Z]{1,2}\d{1,3})\b/g;
                        const barMarks: string[] = [];
                        let m;
                        while ((m = barMarkPattern.exec(page.raw_text)) !== null) {
                          const bm = m[1];
                          if (!["OF","IN","AT","TO","AS","IS","IT","OR","ON","IF","NO","DO","UP"].includes(bm) && !barMarks.includes(bm)) barMarks.push(bm);
                        }
                        let ldId: string | null = null;
                        if (tb.sheet_number) {
                          const { data: ex } = await svc.from("logical_drawings").select("id")
                            .eq("user_id", autoIndexUserId).eq("project_id", reqProjectId)
                            .eq("sheet_id", tb.sheet_number).eq("drawing_type", tb.drawing_type || "").maybeSingle();
                          if (ex) { ldId = ex.id; }
                          else {
                            const { data: cr } = await svc.from("logical_drawings").insert({
                              user_id: autoIndexUserId, project_id: reqProjectId,
                              sheet_id: tb.sheet_number, discipline: tb.discipline || null, drawing_type: tb.drawing_type || null,
                            }).select("id").single();
                            ldId = cr?.id || null;
                          }
                        }
                        await svc.rpc("upsert_search_index", {
                          p_user_id: autoIndexUserId, p_project_id: reqProjectId,
                          p_logical_drawing_id: ldId, p_page_number: page.page_number || null,
                          p_raw_text: page.raw_text, p_bar_marks: barMarks,
                          p_extracted_entities: { bar_marks: barMarks, title_block: tb, tables: page.tables || [] },
                          p_revision_label: tb.revision_code || null,
                        });
                      }
                      console.log(`Auto-indexed ${pdfExtraction.pages.filter(p => !p.is_scanned).length} pages into search DB`);
                    } catch (indexErr) {
                      console.error("Auto-index failed (non-blocking):", indexErr);
                    }
                  }
                } else {
                  console.log("PDF has no text layer — fully scanned, relying on OCR");
                }
              } catch (pdfExtErr) {
                console.error("PDF-native extraction failed, continuing with visual analysis:", pdfExtErr);
              }
            } else {
              console.log(`PDF ${sizeMB.toFixed(1)}MB too large for pdfjs extraction (limit ${MAX_PDF_TEXT_EXTRACT_MB}MB), skipping text extraction to save memory`);
            }

            // Send base64 to Gemini Vision only if under inline limit AND we haven't hit inline cap
            if (sizeMB <= MAX_PDF_INLINE_MB && inlinePdfCount < MAX_INLINE_PDF_COUNT) {
              const base64 = encodeBase64(pdfBuffer);
              fileContentParts.push({ type: "image_url", image_url: { url: `data:application/pdf;base64,${base64}` } });
              console.log("PDF sent as base64 for visual analysis:", Math.round(base64.length / 1024), "KB");
              inlinePdfCount++;
            } else if (sizeMB > MAX_PDF_INLINE_MB) {
              console.log(`PDF ${sizeMB.toFixed(1)}MB exceeds inline limit (${MAX_PDF_INLINE_MB}MB), using text extraction only`);
            } else {
              console.log(`Skipping inline PDF (already sent ${inlinePdfCount}/${MAX_INLINE_PDF_COUNT} inline PDFs to save memory)`);
            }
            pdfCount++;
          } catch (err) { console.error("PDF processing error:", err); }
        } else {
          // Check if this is a supported image format
          const supportedImageExts = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff', '.tif'];
          const fileExt = urlLower.split('.').pop()?.split('?')[0] || '';
          const isSupportedImage = supportedImageExts.some(ext => ext === `.${fileExt}`);
          
          if (!isSupportedImage) {
            console.log(`Skipping unsupported file format: .${fileExt} — only images and PDFs are supported for visual analysis`);
            continue;
          }
          
          // Image file - run Vision OCR if token available
          fileContentParts.push({ type: "image_url", image_url: { url } });

          if (accessToken) {
            try {
              console.log("Running Google Vision Triple OCR on image:", url.substring(0, 60) + "...");
              const imgResponse = await fetch(url);
              if (!imgResponse.ok) { console.error("Image download failed:", imgResponse.status); continue; }
              const imgBuffer = await imgResponse.arrayBuffer();
              const imgBase64 = encodeBase64(imgBuffer);
              
              const ocrResults = await tripleOCR(accessToken, imgBase64);
              
              visionOcrText += `\n\n## Google Vision OCR Results for image: ${url.split('/').pop()?.split('?')[0] || 'image'}\n\n`;
              for (const pass of ocrResults) {
                visionOcrText += `### OCR Pass ${pass.pass} (${pass.preprocess})\n`;
                visionOcrText += `**Full Text:**\n\`\`\`\n${pass.fullText}\n\`\`\`\n\n`;
                if (pass.blocks.length > 0) {
                  visionOcrText += `**Blocks (${pass.blocks.length} detected):**\n`;
                  for (const block of pass.blocks.slice(0, 50)) {
                    visionOcrText += `- [conf: ${block.confidence.toFixed(2)}, bbox: [${block.bbox.join(',')}]] "${block.text}"\n`;
                  }
                }
                visionOcrText += `\n`;
              }
              visionOcrAvailable = true;
              console.log(`Vision OCR complete for image, ${ocrResults.reduce((s, r) => s + r.blocks.length, 0)} total blocks`);
            } catch (err) {
              console.error("Vision OCR failed for image, Gemini will handle OCR:", err);
            }
          }
        }
      }
      console.log(`Total file parts: ${fileContentParts.length} (${pdfCount} PDFs), Vision OCR: ${visionOcrAvailable}`);
    }

    if (fileContentParts.length > 0 && messages.length > 0) {
      const firstUserMsgIndex = messages.findIndex((m: any) => m.role === "user");
      for (let i = 0; i < messages.length; i++) {
        if (i === firstUserMsgIndex) {
          let userText = messages[i].content || "Please analyze these blueprints.";
          // Inject PDF-native text extraction (highest priority)
          if (pdfNativeAvailable && pdfNativeText) {
            userText += `\n\n---\n\n# PDF-NATIVE TEXT EXTRACTION (HIGH ACCURACY)\nThe following text was DIRECTLY parsed from the PDF vector/text layer using pdfjs. This is MORE ACCURATE than OCR for dimensions, bar sizes, quantities, and schedule tables. Use it as your PRIMARY data source. Only use OCR/visual analysis to supplement missing information or for scanned pages.\n${pdfNativeText}`;
          }
          // Inject Vision OCR results into user message
          if (visionOcrAvailable && visionOcrText) {
            userText += `\n\n---\n\n# REAL Google Vision OCR Results (USE THESE — do NOT re-read text from images)\n${visionOcrText}`;
          }
          const content: any[] = [
            { type: "text", text: userText },
            ...fileContentParts,
          ];
          aiMessages.push({ role: messages[i].role, content });
        } else {
          aiMessages.push({ role: messages[i].role, content: messages[i].content });
        }
      }
    } else {
      for (const m of messages) {
        aiMessages.push({ role: m.role, content: m.content });
      }
    }

    const aiStart = performance.now();
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: aiMessages,
        stream: true,
        temperature: 0,
        top_p: 1,
        max_tokens: 16384,
      }),
    });

    const aiLatency = Math.round(performance.now() - aiStart);
    console.log(JSON.stringify({ route: "analyze-blueprint", provider: "google/gemini", gateway: "lovable-ai", pinned_model: "google/gemini-2.5-pro", latency_ms: aiLatency, success: response.ok, fallback_used: false }));

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits to continue." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI analysis failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("analyze-blueprint error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
