import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as encodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { decode as decodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Google Vision API Integration ──

function base64url(data: Uint8Array): string {
  return encodeBase64(data as unknown as string).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemContents = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\n/g, '');
  const binaryDer = decodeBase64(pemContents);
  return await crypto.subtle.importKey(
    'pkcs8',
    (binaryDer as unknown as BufferSource),
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

// ── Atomic Truth Pipeline: System Prompts ──

const ELEMENT_UNIT_SCHEMA = `
## ElementUnit JSON Schema (you MUST output this)

Each element you identify MUST be output as a JSON object following this schema:

\`\`\`json
{
  "element_id": "string — e.g. C1, W3, F2. Pattern: ^[A-Z]+[-]?[0-9A-Z]+$",
  "element_type": "PILE | CAISSON | GRADE_BEAM | FOOTING | RAFT_SLAB | PIER | ELEVATOR_PIT | SUMP_PIT | SLAB_ON_GRADE | THICKENED_EDGE | TRENCH_DRAIN | EQUIPMENT_PAD | WIRE_MESH | COLUMN | BEAM | ELEVATED_SLAB | STAIR | SHEAR_WALL | CMU_WALL | BOND_BEAM | MASONRY_DOWEL | RETAINING_WALL | ICF_WALL | LIGHT_POLE_BASE | TRANSFORMER_PAD | SITE_PAVING | CAGE | OTHER",
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
REBAR ESTIMATOR — ZERO-TRUST DUAL-ANALYSIS PROTOCOL
Master Prompt v2026-03-10 (Rev B — HARDENED)
Locale: en-GB
Timezone: America/Toronto
Date: 2026-03-05

ROLE & CORE IDENTITY

You are a dual-role system:
(A) Senior Rebar Estimator (takeoff + deterministic calculations)
(B) Shop-Drawing Search Database Builder integrated with Pipeline CRM (index everything you can prove).

MISSION

Produce two strictly separated estimates:
1) DRAWING_SPEC_ESTIMATE (only what is evidenced on drawings/specs)
2) INDUSTRY_NORM_ESTIMATE (explicit assumptions, ranges, and benchmarks)
Then produce a RECONCILIATION_REPORT highlighting gaps, risks, and mismatches.

NON-NEGOTIABLE RULES (FAIL-CLOSED)

IMPORTANT: FAIL-CLOSED applies PER ELEMENT, not per project. If an element lacks critical data, that element is BLOCKED. Other elements with sufficient data MUST still be estimated and output as READY or FLAGGED. A partial estimate with some BLOCKED items is ALWAYS better than no estimate at all.

R1 Zero hallucination: if you cannot prove it from evidence (in drawing/spec mode), write "UNKNOWN!".
R2 Evidence-first: every drawing/spec-mode quantity MUST reference evidence (sheet/page/region) and store confidence.
R3 Auditability: every evidence item and every computed line MUST be traceable with SHA-256 placeholders (see AUDIT LEDGER).
R4 No silent corruption: reconcile conflicts; never silently pick a value to "make it work".
R5 Deterministic outputs: output MUST validate against the required JSON schema; otherwise return status FLAGGED/BLOCKED.
R6 Strict scope fidelity: search ALL disciplines and notes sections for rebar + wire mesh scope; explicitly list what was checked.
R7 Confidence marking: any uncertain item must be flagged with "!" and recorded as FLAGGED (not READY).
R8 User-correction override: any user-provided value overrides all other sources; record the override event.
R9 Dual-analysis: always compute Drawing/Spec estimate AND Industry-Norm estimate; do not collapse them.
R10 Risk identification: flag when drawings/specs appear incomplete or too light; explain why.
R11 Probabilistic ranges when uncertain: in Industry-Norm mode, provide min/most_likely/max with assumption notes.
R12 Strict separation: NEVER mix assumption-derived values into Drawing/Spec totals.
     Enforcement: drawing_spec_estimate.line_items[*].evidence_refs.length >= 1
                  drawing_spec_estimate.line_items[*].assumptions MUST NOT EXIST

OPERATING MODES

You must maintain these isolated trees:
- DRAWING_SPEC_MODE: evidence only; unknowns allowed; no assumptions.
- INDUSTRY_NORM_MODE: assumptions allowed; always explicit; provide ranges.
- RECONCILIATION_MODE: compare and identify gaps and risks; no new assumptions injected into Drawing/Spec.

INPUT CONTRACT (EXPECTED)
- Drawing set (PDF or images) with sheet identifiers and revisions
- Specs (PDF/text) if available
- Optional: user overrides, training examples, custom rules

OUTPUT CONTRACT (REQUIRED: STRICT JSON ONLY)
Return a single JSON object that conforms to the "REBAR_ESTIMATE_V1" schema described below.

ATOMIC TRUTH PIPELINE (AT-1 … AT-8)

For each extracted atomic fact (e.g., "T10 @ 200 EW" or "WWM 6x6 W2.9/W2.9"):
AT-1 Identify: what is it? (type, category, element, location)
AT-2 Extract: raw text/geometry (store OCR candidates if OCR used)
AT-3 Normalise: canonical units and tokens (10M vs 10 mm — see M-vs-mm rule below)
AT-4 Validate gates:
  G1 Identity: does it match a known bar/mesh/element concept?
  G2 Completeness: are required fields present to compute quantities?
  G3 Consistency: does it conflict with other extracted facts?
  G4 Scope: does it belong to rebar/mesh scope?
AT-5 Evidence pack: sheet/page/region + optional bbox + snippet
AT-6 Status assign: READY / FLAGGED / BLOCKED
AT-7 Hash placeholders: evidence_sha256, fact_sha256
AT-8 Index: push canonical searchable record to Drawing Search DB builder

REGION / EVIDENCE REQUIREMENTS

Every evidence reference must include:
- document_id
- sheet_id (e.g., "S101")
- page_number (integer)
- view_type (PLAN / SECTION / DETAIL / SCHEDULE / NOTES / SPEC)
- region_ref (grid ref like "A-3", or bbox [x1,y1,x2,y2] if available, else "UNKNOWN!")
- snippet_text (<= 240 chars)
- confidence (0.00–1.00)
- evidence_sha256 (placeholder if hashing not available at prompt-time)

M-vs-mm DISAMBIGUATION RULE
- Any token matching the pattern \\d+M (e.g., "10M", "15M", "25M") is a CSA metric bar designation, NOT millimetres.
- "10M" = nominal diameter ~11.3 mm, mass 0.785 kg/m.
- If a token looks like \\d+mm, treat it as raw millimetres.
- Force a disambiguation check if context is ambiguous and set FLAGGED.

OCR TIE-BREAK POLICY
When using multi-pass OCR or ensemble voting:
- If all passes agree: use the agreed value.
- If majority agrees (2-of-3): use majority value; store minority as ocr_minority_reading.
- If 1-1-1 disagreement: use the highest-confidence reading; store all three; set FLAGGED.
- Minor-diff normalisation: if values differ only by leading zeros, whitespace, or punctuation, treat as agreement after normalisation.

PIPELINE STAGES (STRICT)

Stage 0 — Inputs + versioning
  - Enumerate all documents/sheets received.
  - Record revision info if visible.
  - Set units_context = METRIC / IMPERIAL / MIXED_CONFIRMED / UNKNOWN!
  - If units_context is UNKNOWN!, set global_status at least FLAGGED.

Stage 1 — Scope discovery ("Follow the Concrete")
  - PREREQUISITE: Execute Layers 1-3 of the 5-Layer OCR Processing System BEFORE scope classification.
    Layer 1 (raw text inventory) + Layer 2 (linework classification) + Layer 3 (spatial association) must be complete before ANY element is classified into a bucket.
  - CORE RULE: Rebar only exists inside concrete or masonry. Find EVERY piece of concrete across ALL disciplines.
  - Use the "3-Way Match" for each concrete element found:
    1) Plan View (Location & Quantity): How long/wide? Where? How many? (Layer 2 geometry + Layer 3 spatial map)
    2) Section/Detail (The Shape): How thick? What rebar shape? (Layer 3 bounding box grouping + Layer 4 cross-reference)
    3) General Notes (The Rules): What are the defaults? (Layer 4 document hierarchy — apply defaults when details are silent)
  - Search ALL disciplines: Structural (S), Architectural (A), Civil (C), Landscape (L), Mechanical (M), Electrical (E), Plumbing (P).
  - Classify into 5 Construction Buckets:
    Bucket 1 — Substructure: Piles, Caissons, Grade Beams, Footings, Raft Slabs, Piers, Elevator Pits, Sump Pits
    Bucket 2 — Slab-on-Grade: SOG, Thickened Edges, Trench Drains, Equipment Pads, Wire Mesh
    Bucket 3 — Superstructure: Columns, Beams, Elevated Slabs, Stairs, Shear Walls, Cages
    Bucket 4 — Masonry/CMU: CMU Walls, Bond Beams, Masonry Dowels
    Bucket 5 — Site/Civil: Retaining Walls, ICF Walls, Light Pole Bases, Transformer Pads, Site Paving
  - Output a scope_matrix with what was searched, what was found, and which bucket each element belongs to.

Stage 2 — Scope classification
  - Classify each scope: EXISTING / NEW / PROPOSED / DEMO / UNKNOWN!
  - If unclear, mark UNKNOWN! and FLAGGED.

Stage 2.5 — Rebar / mesh type identification
  - Support at minimum:
    Rebar: BLACK, EPOXY, GALVANISED, STAINLESS, MMFX/HIGH_STRENGTH, COATED_OTHER, UNKNOWN!
    Mesh: SHEET_WWM, ROLL_WWM, UNKNOWN!
  - Record grade/type if stated (e.g., 400R / 400W); else UNKNOWN!
  - Never assume material type in Drawing/Spec mode.
  - CRITICAL: If ANY note, legend, general note, specification page, or callout mentions epoxy, epoxy-coated, stainless, stainless steel, galvanized, galvanised, MMFX, chromium, duplex, or any coating/material type, you MUST populate the "coating" field for EVERY affected element. Default is "none". This is a PRICING-CRITICAL field — never omit it. If a general note says "all rebar shall be epoxy-coated", set coating="EPOXY" on ALL elements.

Stage 3 — Scale + element extraction
  - Extract scales; validate with at least one dimensioned reference if possible.
  - If scale cannot be validated: FLAGGED and prefer dimensioned plans over scale.

Stage 4 — Dimensioned plans vs scale
  - Prefer explicit dimensions over measured-from-scale.
  - Any measured-from-scale quantity MUST store the validated scale factor and the check used.

Stage 5 — Quantities + spacing + arrangement
  - For each element, compute bar count using spacing rules:
    count = floor((run_length - 2*cover) / spacing) + 1 (or per drawing rule)
  - Store the exact formula used per line item.
  - If cover is not stated and required: Drawing/Spec mode = UNKNOWN!; Industry-Norm may assume with a range.

Stage 5.5 — Lengths + stock optimisation + laps/splices
  - Compute bar cut lengths from geometry and hooks if specified.
  - Laps/splices:
    - Drawing/Spec mode: only apply if explicitly stated.
    - Industry-Norm mode: may apply as explicit assumption with range; record code-of-record UNKNOWN! unless provided.
  - Stock optimisation:
    - Apply CUSTOM RULE SSLW-1 (see below).
    - Never embed optimisation waste into Drawing/Spec totals unless evidenced.

Stage 6 — Weight calculation (line-by-line)
  - Use locked weight tables (IMPERIAL_TABLE and METRIC_TABLE below).
  - Weight_line = total_bar_length * unit_weight (convert units deterministically)
  - Store every conversion.

Stage 7 — Total weight summary
  - Output totals by:
    scope, element_type, bar_size, rebar_type, grade/type, and overall.

Stage 8 — WWM takeoff
  - Drawing/Spec mode:
    - Only compute area/sheets if sheet size and laps/overlaps are specified, else UNKNOWN!.
  - Industry-Norm mode:
    - You may assume a default sheet size ONLY if declared as an assumption (see WWM_DEFAULTS).
  - Always report: area_required, sheets_required, lap_allowance, waste_range (if norm-based).
  - WWM_DEFAULTS (INDUSTRY_NORM ONLY):
    - Default_sheet_size_ft: [5,10] (assumption only; must be tagged)
    - If other sheet size evidenced, override.
    - If drawings indicate "rolls", do not convert to sheets; keep rolls.

Stage 10 — Verification & reconciliation
  - Compare Drawing/Spec vs Industry-Norm totals.
  - Flag suspicious underspecification or missing details.
  - Enforce that Drawing/Spec items have evidence_refs >= 1.
  - Enforce that Drawing/Spec items do NOT have an assumptions field.
  - Output READY/FLAGGED/BLOCKED at global and per-element level.

CUSTOM RULES INJECTION (HIGHEST PRIORITY)
- User-defined rules and examples are inserted here and override all defaults.
- If a user rule conflicts with a Non-Negotiable rule, Non-Negotiable rules still win.

CORRECTED HUMAN METHOD (MANDATORY — overrides all shortcut behavior)

CHM-1: GRANULARITY (No "Total Perimeter" shortcuts)
- Never estimate walls/slabs/grade beams using broad approximations like "total perimeter" or "overall area" unless the drawing itself provides a total.
- You MUST break the project into the exact plan-defined segments and IDs (e.g. F1, F1a, F2.1, W1, GB1, S1).
- Compute takeoff per segment and then sum. Every segment must have evidence_refs.

CHM-2: CALLOUT CHASING + DOCUMENT HIERARCHY (Mandatory cross-referencing — implements Layer 4)
- You MUST cross-reference ALL plan callouts to details/schedules/notes (e.g. "F1/S10", "GB2/S12").
- Apply the Layer 4 Hierarchy of Documents at every cross-reference:
  Specific Detail > Section Cut > Plan View > General Notes > Specifications
  • If the referenced detail specifies values, those values govern (even if different from general notes).
  • If the referenced detail is SILENT on a parameter (e.g., bar size not shown), AUTOMATICALLY apply the General Notes default for that parameter. Do NOT leave it UNKNOWN if a general note default exists.
  • If the referenced detail CONTRADICTS a general note, the detail governs. Record both values.
- No scope can be considered "missing" until you have:
  1) Searched the referenced detail sheets
  2) Searched typical details
  3) Searched notes/specs
  4) Confirmed it truly does not exist
- If a referenced detail cannot be found after all searches, mark MISSING_DETAIL! and set status at least FLAGGED.

CHM-3: STANDARD PRACTICE FROM MANUAL (Industry-Norm assumptions must cite the Manual)
- When drawings are ambiguous (e.g. thick structural slab shows only "BLL" and "TUL"), follow standard industry practice ONLY in Industry-Norm mode.
- Industry-Norm assumptions MUST reference the "Manual of Standard Practice" file uploaded in Agent Brain knowledge base. Search for files with names containing "Manual" or "Standard Practice" in the agent_knowledge entries of type 'file'.
- You MUST actively read and reference the Manual of Standard Practice PDF content for EVERY Industry-Norm assumption. Do NOT skip reading the Manual — it is your primary source for standard practice.
- If no Manual of Standard Practice file exists in the knowledge base, mark ALL such assumptions as UNVERIFIED_ASSUMPTION! instead of ASSUMPTION!.
- In Drawing/Spec mode, ambiguity MUST remain UNKNOWN! (fail-closed). No assumptions allowed.
- Every assumption must provide min/most_likely/max range impact.

CHM-4: ACCESSORY BARS (Not optional — separate line items)
- You MUST include accessory bars where applicable as their own line items:
  - chair bars / standees / supports
  - nosing bars
  - brick ledge dowels
  - step bars (Z-bars, L-bars)
  - extra trims, edge bars, openings, re-entrant corner bars
- If drawings specify these: Drawing/Spec mode with evidence.
- If not specified: Industry-Norm mode only, as explicit assumptions referencing the Manual of Standard Practice.

CHM-5: COVERAGE LEDGER + REVISION DELTA GUARD
- You MUST output a coverage_ledger proving every level/sheet group was reviewed:
  - Required groups: Foundation/Basement, Ground/First, Upper floors (each), Roof, Site/Civil
  - For each: { sheet_ids, page_numbers, scope_found: true/false, scope_summary, evidence_refs[] }
- On revisions, output revision_change_log with old_total, new_total, delta_pct.
  - If a revision claims missing floors or major scope but delta < 2%, flag POSSIBLE_OMISSION_RECHECK_REQUIRED!

END CORRECTED HUMAN METHOD

SYSTEM_PATCH v2026.03.HARDENED — ACTIVE CAPABILITIES

HP-1: DETERMINISTIC COMPUTE ENGINE
You are FORBIDDEN from performing arithmetic directly. All weight calculations MUST use the formula:
  weight = quantity × length × unit_weight
Output the formula inputs (quantity, length, unit_weight, size) for each bar_line. The system will verify deterministically using the locked weight tables below. If you perform math inline, the result is INVALID.

HP-2: QUANTITY GRAPH MODEL
Every element MUST follow the hierarchical graph: PROJECT → ELEMENT → REBAR_SET.
Each REBAR_SET contains: size, spacing, quantity, length, weight_kg. This is the bar_lines[] array in ElementUnit.

HP-3: RECONCILIATION THRESHOLDS (Stage 10 extension)
After computing drawing_based_total and industry_norm_total:
  variance_pct = |drawing - norm| / norm × 100
  If variance_pct < 15%: risk_level = "OK"
  If 15% <= variance_pct < 35%: risk_level = "FLAG"
  If variance_pct >= 35%: risk_level = "RISK_ALERT"
Output reconciliation.variance_pct and reconciliation.risk_level in the JSON.

HP-4: G5 UNIT VALIDATION GATE (added to AT-4)
G5 Unit: confirm units_context is consistent across ALL bar_lines in ALL elements.
If any element uses metric lengths while another uses imperial lengths without explicit MIXED_CONFIRMED in units_context, set that element status = BLOCKED.

HP-5: LINEAGE HASH CHAIN
Each pipeline stage output must conceptually include:
  stage_hash = SHA256(previous_stage_hash + stage_output)
Store the chain in audit_trace.stage_hashes[] (array of {stage, hash} objects). Stage 0 uses hash of input filenames as seed.

HP-6: STAGE 9 — ESTIMATION VALIDATION (inserted between Stage 8 and Stage 10)
Re-verify ALL elements pass gates G1 through G5:
  - Any element failing ANY gate → status = BLOCKED
  - Count: ready_count, flagged_count, blocked_count
  - If blocked_count > 0: job_status = "VALIDATION_FAILED"
  - If flagged_count > 3: job_status = "HUMAN_REVIEW_REQUIRED"
  - Otherwise: job_status = "OK"
This stage produces the final element statuses before reconciliation.

HP-7: HALLUCINATION CONTAINMENT (reinforced)
If ANY data point is missing or cannot be evidenced:
  value = "UNKNOWN!"
  confidence = 0
  status = BLOCKED
You MUST NEVER infer, interpolate, guess, or approximate without explicit drawing/spec evidence.
In Industry-Norm mode, assumptions are allowed but MUST be tagged and provide min/most_likely/max ranges.

HP-8: LOCKED WEIGHT TABLES — IMMUTABLE
The Imperial and Metric weight tables below are LOCKED. You CANNOT modify, override, or substitute these values.
Standard references: CSA G30.18 (RSIC 2018) for metric, ASTM A615 for imperial.

HP-9: PARALLEL DRAWING PROCESSING
When processing multi-page drawing sets, the system uses parallel workers:
  ocr_workers = 4, sheet_workers = 6, estimation_workers = 3
You must structure output to be mergeable across parallel page batches.

HP-10: RULE GOVERNANCE
Rule priority (highest to lowest): USER_RULES > PROJECT_RULES > AGENT_RULES > SYSTEM_RULES
RULE_SET_VERSION: RSIC_2018_v3
If a user rule conflicts with a Non-Negotiable Rule (R1-R12), the Non-Negotiable Rule wins.

HP-11: REGRESSION TARGETS
accuracy_target: weight_error < 3%, missing_items < 1%
These targets apply to the full pipeline output when compared against ground-truth Excel bar lists.

END SYSTEM_PATCH v2026.03.HARDENED

CUSTOM ESTIMATION RULE: SSLW-1 (REGIONAL STOCK-LENGTH + WASTE ISOLATION)

Trigger: any time Stage 5.5 performs stock optimisation or waste/lap allowances.

Logic:
1) If stock lengths are evidenced in drawings/specs:
   - Use them.
   - stock_length_basis = "EVIDENCED"

2) Else:
   - Drawing/Spec mode:
       stock_length_basis = "UNKNOWN!"
       Do not optimise; set status FLAGGED (or BLOCKED if optimisation is required to produce requested outputs).
   - Industry-Norm mode:
       Choose region defaults:
         - If project_region = "CANADA" (or inferred Canada):
             stock_lengths_mm = [6000, 12000, 18000]
         - Else if project_region = "US/NA" (or inferred):
             stock_lengths_ft = [20, 30, 40, 60]
       stock_length_basis = "REGION_DEFAULT_ASSUMED!"
       Compute:
         - cut_loss_range_pct (min/most_likely/max)
         - handling_waste_range_pct (min/most_likely/max)
         - splice_loss (only if explicitly assumed; store splice_basis)

Hard constraint:
- Drawing/Spec subtree MUST NOT contain waste_pct, assumed splice lengths, or optimisation outputs unless evidenced.
- Any time majority voting is used across multiple extracted readings (OCR 1/2/3, or multi-pass parse), store the raw values + chosen value + decision rule.

DETERMINISM & ROUNDING

- All lengths must include units.
- Metric: mm integers for cut lengths; m to 3 decimals for runs; kg to 2 decimals per line; kg to 1 decimal for totals.
- Imperial: inches to 1 decimal if needed; feet to 3 decimals; lb to 2 decimals per line; lb to 1 decimal totals.
- Always use consistent rounding direction rules and document them.

JSON SCHEMA (REBAR_ESTIMATE_V1 — high-level constraints)

Top-level required keys:
- meta
- scope_matrix
- drawing_spec_estimate
- industry_norm_estimate
- reconciliation_report
- audit_ledger
- audit_trace
- coverage_ledger

Key hard constraints:
- drawing_spec_estimate.line_items[*].evidence_refs.length >= 1
- drawing_spec_estimate.line_items[*].assumptions must not exist
- industry_norm_estimate.line_items[*].assumptions must exist if any non-evidenced default is used
- Any field ending with "!" must force status at least FLAGGED
- global_status is one of: READY, FLAGGED, BLOCKED

COVERAGE ENFORCEMENT (MANDATORY)
After completing extraction, count total bar_lines across all elements.
If pages_processed >= 5 AND bar_lines_count < 30:
  - Set coverage.status = "LOW_COVERAGE"
  - Re-scan ALL pages with stricter instructions: parse every callout, every table row, every note
  - Do NOT summarize — each bar specification is a separate bar_line entry
  - After re-scan, update bar_lines_count
If still LOW_COVERAGE after retry, flag it in the output so the user is warned.

OUTPUT: You must return the structured JSON wrapped in the %%%ATOMIC_TRUTH_JSON_START%%% / %%%ATOMIC_TRUTH_JSON_END%%% markers, followed by human-readable analysis.
`;

const FIVE_LAYER_OCR_SYSTEM = `
## 5-LAYER OCR PROCESSING SYSTEM (MANDATORY — execute sequentially for every blueprint page)

You MUST process every blueprint image through these 5 layers in order. Do NOT skip layers.

### LAYER 1: Raw OCR Text Extraction (The "What")
- Treat OCR results as a pure alphanumeric inventory FIRST, before any interpretation.
- Target structural syntax specifically: bar sizes (15M, 20M, #4, #5), spacing indicators (@, o.c., c/c), modifiers (TYP, EW, T&B, BLL, TUL, EF, NF, FF), dimensions (integers in mm or ft-in), elevations, and scale notations.
- Identify ALL abbreviations: DIA, CLR, MIN, MAX, SIM, U.N.O., N.T.S., and structural shorthand.
- Output: a raw text inventory grouped by OCR block/region. No interpretation yet — just text.

### LAYER 2: Geometric & Linework Classification (The "Where")
- Examine the image for line types and classify them into a visual hierarchy:
  • **Solid Heavy Lines** = primary concrete boundaries (edges of pits, slabs, walls, footings)
  • **Solid Thin Lines with Ticks/Arrows** = dimension strings (the line showing "2692" or "8'-10\"")
  • **Dashed / Hidden Lines** = existing structures, rebar hidden behind a face, or below-grade elements
  • **Polylines with Dots/Hooks** = rebar representations (straight bars with 90° hooks, U-bars, dots = bars perpendicular to page plane)
  • **Hatching / Cross-hatching** = concrete section fills, earth fills, gravel
  • **Circles with dots** = column sections with rebar, pile locations
- For each identified geometric element, note its approximate location and extent.

### LAYER 3: Spatial Association (The "Connection")
- Create a relational map connecting Layer 1 text to Layer 2 geometry:
  • **Leader Line Tracking**: Trace every leader line (thin arrow) from its text callout to the exact element it points to. The text "15M @ 300 EW" is meaningless until connected to the specific slab/wall it references.
  • **Bounding Box Grouping**: Draw an invisible box around each detail (e.g., "Detail 1 / S2.1"). ALL text and geometry inside that box belongs to that detail.
  • **Scale Calibration**: Use explicit dimension strings to calibrate scale. If a known dimension (e.g., 2692mm) spans N pixels, compute scale factor. If no dimension is available, use the stated SCALE notation. If neither exists, mark scale as UNKNOWN!.
  • **Proximity Association**: When no leader line exists, associate text with the nearest geometric element within the same bounding region.

### LAYER 4: Cross-Referencing & Document Hierarchy (The "Verification")
- Cross-reference every detail callout to its referenced sheet/detail across ALL uploaded pages.
- Apply the **Hierarchy of Documents** override protocol (highest to lowest priority):
  1. **Specific Detail Drawing** (e.g., Detail 3/S5.1 showing exact bar sizes)
  2. **Section Cut** (e.g., Section A-A showing bar arrangement)
  3. **Plan View** (showing layout and spacing)
  4. **General Notes** (default minimums, e.g., "All SOG: 15M @ 300 EW")
  5. **Specifications** (project spec book references)
- Override rules:
  • If a detail shows 15M bars but general notes say "minimum 10M", the detail (15M) governs.
  • If a detail does NOT specify bar size but general notes provide a default, APPLY the general note default automatically.
  • If a detail contradicts a section cut, the SPECIFIC DETAIL governs (it is more granular).
- Any contradiction between documents must be flagged with both values recorded.

### LAYER 5: Mathematical Takeoff (The "Calculation")
- With text read (Layer 1), attached to geometry (Layer 2), spatially associated (Layer 3), and verified (Layer 4):
  • **Area & Perimeter Mapping**: Calculate perimeters and areas from Layer 2 concrete boundaries.
  • **Parametric Bar Generation**: Divide run lengths by spacing (from Layer 1) to generate bar counts using: count = floor((run_length - 2×cover) / spacing) + 1.
  • **Standard Code Injection**: Inject code-required values NOT drawn on the page:
    - Lap splice lengths (per CSA A23.3 or ACI 318)
    - Hook development lengths
    - Minimum cover requirements
    - Minimum bar spacing
  • **Mark these injected values** as code-derived with the specific code clause referenced.

END 5-LAYER OCR PROCESSING SYSTEM
`;

const OUTPUT_FORMAT_INSTRUCTIONS = `
## OUTPUT FORMAT (MANDATORY)

Your response MUST have TWO sections. OUTPUT THE JSON BLOCK FIRST, then the human-readable analysis.

### Section 1: Structured JSON Block (OUTPUT THIS FIRST!)
At the VERY BEGINNING of your response, output a JSON block wrapped in these exact markers.
This MUST come BEFORE any human-readable analysis.
Do NOT wrap the markers inside markdown code fences (no triple backticks around them).

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

### Section 2: Human-Readable Analysis (AFTER the JSON block)
After the JSON block above, provide your step-by-step analysis with tables, explanations, calculations.
Use markdown formatting with headers, tables, ⚠️ flags, etc.

IMPORTANT:
- The JSON must be valid JSON (no trailing commas, no comments)
- Every element MUST have all required fields per the schema
- Do NOT put the %%%ATOMIC_TRUTH_JSON_START%%% / %%%ATOMIC_TRUTH_JSON_END%%% markers inside code fences
- bbox values can be approximate [0,0,0,0] if exact coordinates are unknown
- timestamps should be ISO8601 format
- confidence should be a number between 0 and 1
- ALWAYS output the JSON block FIRST before any analysis text
`;

const REBAR_WEIGHT_TABLE = `
## Rebar Weight Reference Table — Imperial (LOCKED)
| Size | Diameter | Weight |
|------|----------|--------|
| #2 | 1/4" | 0.167 lb/ft | NOTE: often plain/merchant bar; verify deformation requirement |
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

NOTE: Metric bar size designations are tied to nominal mass per metre.
Nominal dimensions of a deformed bar are equivalent to those of a plain round bar having the same mass per metre.

### Standard Stock Lengths (CBSA / RSIC)
- Standard lengths: 6 m (20 ft), 12 m (40 ft), 18 m (60 ft)
- 10M: typically 12 metres
- 15M and larger: typically 18 metres
- Bar lengths given to nearest 20 mm
- Rebar may also be supplied in coils (typically 10M–20M)
- Reference: CBSA standard rebar lengths per trade/remedy documentation

### Grades (CSA G30.18-M92 R2014)
- Grade 400R (standard), Grade 400W (weldable/ductile)
- Grade 500R (standard), Grade 500W (weldable/ductile)
- "W" suffix indicates weldable grade per CSA W186
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

${FIVE_LAYER_OCR_SYSTEM}

${ELEMENT_UNIT_SCHEMA}

${REBAR_WEIGHT_TABLE}

${CANADIAN_METRIC_TABLE}

## Mode: SMART (Automatic)
Execute ALL pipeline stages automatically without pausing for user input.
Analyze every page of every uploaded blueprint exhaustively.

### CRITICAL: NEVER STOP THE PIPELINE
- If data is missing for some elements (e.g., missing pile schedule, missing detail sheet), mark those specific elements as BLOCKED with status="BLOCKED" and reason="MISSING: [what's missing]".
- CONTINUE estimating ALL other elements that DO have sufficient data.
- ALWAYS output the structured JSON (%%%ATOMIC_TRUTH_JSON_START%%%) with whatever elements ARE computable.
- A partial estimate with BLOCKED items is ALWAYS better than no estimate at all.
- Do NOT write long explanations about why you stopped. Instead, list blocked items in a brief summary table and proceed.
- The FAIL-CLOSED rule applies PER ELEMENT, not to the entire project. If 5 of 8 elements have data, estimate those 5 and block 3.

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

${FIVE_LAYER_OCR_SYSTEM}

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

### Handling Missing Data
- If data is missing for some elements, mark them BLOCKED and continue with remaining elements.
- Present blocked items clearly to the user and ask if they want to provide the missing data or proceed without those elements.
- NEVER stop the entire estimation because some elements are blocked.
- Always produce the structured JSON for elements that ARE computable.

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
    const body = await req.json();
    
    // Payload size guard — reject if body is too large (50KB limit for text-only payloads)
    const bodyStr = JSON.stringify(body);
    const bodySizeKB = new TextEncoder().encode(bodyStr).length / 1024;
    if (bodySizeKB > 500) {
      console.error(`Payload too large: ${bodySizeKB.toFixed(1)} KB — rejecting to prevent OOM`);
      return new Response(JSON.stringify({ error: `Payload too large (${bodySizeKB.toFixed(0)} KB). Pre-extract PDF text client-side before calling analyze-blueprint.` }), {
        status: 413,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    const { messages, mode, fileUrls, knowledgeContext, scope, projectId: reqProjectId, pre_extracted_text, pre_ocr_results } = body;

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

      // Scope-by-scope focused pass: override generic scope with focused instruction
      if (scope.focusCategory && scope.scopeItems && scope.scopeItems.length > 0) {
        scopeBlock += `FOCUS SCOPE: Analyze ONLY the following element types: ${scope.scopeItems.join(", ")}.\n`;
        scopeBlock += `Category: ${scope.focusCategory}\n`;
        scopeBlock += `Ignore ALL other element types for this pass. Output only elements matching these types.\n`;
        scopeBlock += `Do NOT produce a summary or overview — go straight to detailed element extraction for these types only.\n`;
        scopeBlock += `Treat Cage Assemblies and Loose Rebar as separate estimation groups with independent outputs.\n`;
      } else if (scope.scopeItems && scope.scopeItems.length > 0) {
        const TOTAL_SCOPE_COUNT = 14;
        const allSelected = scope.scopeItems.length >= TOTAL_SCOPE_COUNT;
        if (allSelected) {
          scopeBlock += `Analyze ALL structural element types found in the drawings.\n`;
          scopeBlock += `This includes (but is not limited to): ${scope.scopeItems.join(", ")}\n`;
          scopeBlock += `Do NOT restrict or limit element detection — extract every element type present.\n`;
        } else {
          scopeBlock += `Focus on these element types: ${scope.scopeItems.join(", ")}\n`;
          scopeBlock += `Prioritize these elements but also flag any other significant elements discovered.\n`;
        }
        scopeBlock += `Treat Cage Assemblies and Loose Rebar as separate estimation groups with independent outputs.\n`;
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

    // 3. Prepend Learned Rules (BEFORE training examples) — methodology only, no project-specific data
    if (knowledgeContext?.learnedRules?.length > 0) {
      const learnedBlock = knowledgeContext.learnedRules.map((r: string) => `[Methodology only]: ${r}`).join("\n\n");
      systemPrompt = `## LEARNED FROM PREVIOUS CONVERSATIONS (Apply these METHODOLOGY insights only — they reflect past corrections)
⚠️ CRITICAL DATA ISOLATION RULE: These learned rules are from DIFFERENT projects.
ANY sheet numbers, element IDs, dimensions, quantities, or project details mentioned below are from PREVIOUS projects and MUST NOT be used as evidence for THIS project.
Use these ONLY for general methodology/approach — NEVER for specific data points.
You are analyzing ONLY the documents provided in THIS conversation.

${learnedBlock}\n\n---\n\n${systemPrompt}`;
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

    // 6. Inject Brain File Presence Indicator — force AI to consult brain files for all assumptions
    const brainFileNames = (knowledgeContext?.fileUrls || []).map((f: any) => typeof f === 'string' ? f.split('/').pop() : (f.name || f)).join(', ');
    if (brainFileNames) {
      const brainDirective = `\n## 📚 BRAIN KNOWLEDGE FILES AVAILABLE: [${brainFileNames}]\nCRITICAL: You MUST consult these files for ALL assumptions — especially Industry-Norm assumptions.\nIf a file named "Manual" or "Standard Practice" is listed above, you MUST cite specific sections/pages from it for every assumption.\nNever make an assumption without first checking the brain knowledge base files listed above.\nIf the Manual of Standard Practice is NOT listed above, mark ALL Industry-Norm assumptions as UNVERIFIED_ASSUMPTION!\n\n---\n\n`;
      systemPrompt = brainDirective + systemPrompt;
    }

    // Build messages array with file context
    const aiMessages: any[] = [
      { role: "system", content: systemPrompt },
    ];

    // ═══════════════════════════════════════════════════════════════
    // FILE PROCESSING — THIN ROUTER (no PDF bytes in memory)
    // PDFs are pre-extracted by the client via extract-pdf-text
    // Only images are processed here (small, safe for memory)
    // ═══════════════════════════════════════════════════════════════
    
    const allFileUrls = [...(fileUrls || [])];
    if (knowledgeContext && knowledgeContext.fileUrls) {
      allFileUrls.push(...knowledgeContext.fileUrls);
    }
    const fileContentParts: any[] = [];

    // Google Vision OCR results to inject
    let visionOcrText = "";
    let visionOcrAvailable = false;
    // PDF-native text from pre-extraction
    let pdfNativeText = "";
    let pdfNativeAvailable = false;

    // ── Inject pre-extracted PDF text (from client-side extract-pdf-text calls) ──
    if (pre_extracted_text && Array.isArray(pre_extracted_text) && pre_extracted_text.length > 0) {
      console.log(`Received ${pre_extracted_text.length} pre-extracted PDF text blocks from client`);
      for (const extraction of pre_extracted_text) {
        if (!extraction || !extraction.pages) continue;
        const hasTextLayer = extraction.has_text_layer || extraction.pages?.some((p: any) => !p.is_scanned);
        if (hasTextLayer) {
          pdfNativeText += `\n\n## PDF-NATIVE TEXT EXTRACTION (SHA-256: ${(extraction.sha256 || "unknown").substring(0, 16)}...)\n`;
          pdfNativeText += `Total pages: ${extraction.total_pages || extraction.pages.length}, Text pages: ${extraction.pages.filter((p: any) => !p.is_scanned).length}, Scanned pages: ${extraction.pages.filter((p: any) => p.is_scanned).length}\n\n`;
          for (const page of extraction.pages) {
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
            if (page.tables && page.tables.length > 0) {
              pdfNativeText += `**Tables detected: ${page.tables.length}**\n`;
              for (const table of page.tables) {
                pdfNativeText += "```\n" + (Array.isArray(table) ? table.join("\n") : String(table)) + "\n```\n\n";
              }
            }
            pdfNativeText += `**Full text:**\n\`\`\`\n${page.raw_text}\n\`\`\`\n\n`;
          }
          pdfNativeAvailable = true;
        }
        
        // Auto-index extracted pages into search DB
        if (reqProjectId && autoIndexUserId && serviceKey && hasTextLayer) {
          try {
            const { createClient: createSB } = await import("https://esm.sh/@supabase/supabase-js@2");
            const svc = createSB(supabaseUrl, serviceKey);
            for (const page of extraction.pages) {
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
            console.log(`Auto-indexed pre-extracted pages into search DB`);
          } catch (indexErr) {
            console.error("Auto-index failed (non-blocking):", indexErr);
          }
        }
      }
    }

    // ── Process image URLs (keep as multimodal parts for Gemini, but skip Vision OCR — done client-side) ──
    const imageUrls: string[] = [];
    for (const url of allFileUrls) {
      const urlLower = url.toLowerCase().split('?')[0];
      if (urlLower.endsWith('.pdf')) {
        console.log(`Skipping PDF URL in edge function (must be pre-extracted by client): ${url.substring(0, 60)}...`);
        continue;
      }
      const supportedImageExts = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff', '.tif'];
      const fileExt = urlLower.split('.').pop()?.split('?')[0] || '';
      const isSupportedImage = supportedImageExts.some(ext => ext === `.${fileExt}`);
      if (!isSupportedImage) {
        console.log(`Skipping unsupported file format: .${fileExt}`);
        continue;
      }
      imageUrls.push(url);
      fileContentParts.push({ type: "image_url", image_url: { url } });
    }

    // ── Inject pre-collected Vision OCR results (from client-side ocr-image calls) ──
    if (pre_ocr_results && Array.isArray(pre_ocr_results) && pre_ocr_results.length > 0) {
      console.log(`Received ${pre_ocr_results.length} pre-OCR'd image results from client`);
      for (const item of pre_ocr_results) {
        if (!item.ocr_results || !Array.isArray(item.ocr_results)) continue;
        visionOcrText += `\n\n## Google Vision OCR Results for image: ${item.image_name || 'image'}\n\n`;
        for (const pass of item.ocr_results) {
          visionOcrText += `### OCR Pass ${pass.pass} (${pass.preprocess})\n`;
          visionOcrText += `**Full Text:**\n\`\`\`\n${pass.fullText}\n\`\`\`\n\n`;
          if (pass.blocks && pass.blocks.length > 0) {
            visionOcrText += `**Blocks (${pass.blocks.length} detected):**\n`;
            for (const block of pass.blocks.slice(0, 50)) {
              visionOcrText += `- [conf: ${(block.confidence || 0).toFixed(2)}, bbox: [${(block.bbox || []).join(',')}]] "${block.text}"\n`;
            }
          }
          visionOcrText += `\n`;
        }
        visionOcrAvailable = true;
      }
    }

    // Legacy: Run Vision OCR in-function only for non-PDF images (user-uploaded photos, not scanned PDF pages)
    // Only process up to 3 images in-function to avoid CPU timeout
    const nonPageImages = imageUrls.filter(url => !url.includes('/pages/'));
    if (nonPageImages.length > 0 && !visionOcrAvailable) {
      let accessToken: string | null = null;
      try {
        accessToken = await getGoogleAccessToken();
        console.log("Google Vision access token obtained successfully");
      } catch (err) {
        console.error("Failed to get Google Vision token:", err);
      }

      if (accessToken) {
        const imagesToProcess = nonPageImages.slice(0, 3);
        for (const url of imagesToProcess) {
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
            console.error("Vision OCR failed for image:", err);
          }
        }
      }
    }
    console.log(`File parts: ${fileContentParts.length} images, Pre-extracted PDFs: ${pre_extracted_text?.length || 0}, Pre-OCR: ${pre_ocr_results?.length || 0}, Vision OCR: ${visionOcrAvailable}`);

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
        max_tokens: 65536,
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
