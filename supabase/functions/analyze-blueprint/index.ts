import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as encodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { decode as decodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";

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
  const saKeyRaw = Deno.env.get("GOOGLE_VISION_SA_KEY");
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
  "element_type": "COLUMN | WALL | FOOTING | BEAM | SLAB_STRIP | GRADE_BEAM | RAFT_SLAB | RETAINING_WALL | ICF_WALL | CMU_WALL | PIER | SLAB | STAIR | WIRE_MESH | OTHER",
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

const PIPELINE_INSTRUCTIONS = `
## Atomic Truth Pipeline — 9-Stage Protocol

You MUST execute these stages IN ORDER for every blueprint analysis:

### Stage 1 — Scope Load
Determine the job scope from the blueprints. Identify which element_types are present.
Allowed element types: COLUMN, WALL, FOOTING, BEAM, SLAB_STRIP, GRADE_BEAM, RAFT_SLAB, RETAINING_WALL, ICF_WALL, CMU_WALL, PIER, SLAB, STAIR, WIRE_MESH, OTHER.

### Stage 2 — Finder Pass
Perform a quick scan to locate:
- Element tags (C1, C2, W1, F1, etc.)
- Schedule title regions (Column Schedule, Footing Schedule, etc.)
- Detail callout patterns like 5/S-301
Output: element candidates with tag_region and link candidates.

### Stage 3 — Region Builder
For each element candidate, build a minimum chunk set:
- TAG: the element tag/mark on the plan
- LOCAL_REINF: local reinforcement notes near the tag
- SCHEDULE_ROW: the corresponding row in a schedule table
- DETAIL: referenced detail drawing (if any)
- GOV_NOTES: governing general notes for that element type

### Stage 4 — Triple OCR (per chunk)
IMPORTANT: Real Google Vision OCR has already been performed on each image. The OCR results are provided below.
Use the provided OCR text and confidence scores directly — do NOT attempt to re-read text from images.
For each chunk, map the relevant OCR blocks to your extraction.

### Stage 5 — Field Voting + Normalization
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

### Stage 6 — Truth Assembly
Build the extraction.truth object from voted field values.
Set extraction.confidence as the minimum confidence across critical fields.

### Stage 7 — Gate Validation
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

### Stage 8 — Question Generation
For FLAGGED elements only:
- Max 2 questions per element
- Max 3 questions per job total
- Priority order: tie spacing > vertical qty > bar size > other
- Question fields: element_id, field, issue (CONFLICT|LOW_CONFIDENCE|MISSING), prompt, options, severity (LOW|MED|HIGH|BLOCKING)

### Stage 9 — Status Assignment (DETERMINISTIC)
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
    "wire_mesh_sheets": 0
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

const SMART_PROJECT_DETECTION = `
## Smart Project Type Detection (AUTO-DETECT from blueprints)

You MUST auto-detect the project category from the blueprint content and adapt your estimation approach:

### Category 1: CAGE (Prefab Rebar Cages)
**Indicators**: Column schedules with cage marks, prefab cage details, "cage" labels, tied column assemblies
**Approach**: Focus on cage assembly — count verticals, ties, tie spacing, cage height. Output bar marks for each cage type. Include spiral data if present.

### Category 2: INDUSTRIAL
**Indicators**: Large footings (>3m), heavy sections (25M+), equipment foundations, tank bases, industrial equipment pads, crane beams
**Approach**: Heavy bar sizes dominate. Watch for special bending, radius bends, heavy bending per RSIC rules (bars 15M-55M bent at 6 points or fewer). Check for epoxy/galvanized coatings in corrosive environments.

### Category 3: RESIDENTIAL
**Indicators**: Strip footings, basement walls, SOG (slab-on-grade), ICF walls, small columns, residential garage
**Approach**: Lighter bar sizes (10M-20M typical). Focus on footing bars (75mm from face per RSIC), wall verticals, SOG mesh. Simpler bending.

### Category 4: COMMERCIAL
**Indicators**: Multi-storey columns, flat slabs/plates, drop panels, parking structures, beams, slab bands
**Approach**: Mixed bar sizes. Column splice tracking across floors. Flat slab reinforcement with column/middle strips. Post-tensioning support bars if applicable.

### Category 5: BAR LIST ONLY
**Indicators**: No blueprint drawings — just a bar list/schedule table (bar marks, sizes, quantities, lengths)
**Approach**: Skip OCR/element detection. Parse the table directly. Calculate weights from quantities x lengths x unit weights. Output size summary and totals.

### Category 6: INFRASTRUCTURE
**Indicators**: Bridge decks, abutments, retaining walls >3m, culverts, highway barriers, MTO/OPSS references
**Approach**: Heavy bars with epoxy coating common. Check for provincial DOT specs (MTO, MTQ, MTBC, etc.). Longer development lengths for bridge elements.

Announce your detected category in Step 1 as: "**Project Category: [CATEGORY]**"
Adapt ALL subsequent estimation steps to the detected category.
`;

const RSIC_ESTIMATING_RULES = `
## RSIC Standard Practice — Estimating (Chapter 4, 2018 Edition)

These rules are MANDATORY for Canadian projects. Apply them when metric bar sizes (10M, 15M, etc.) are detected OR when the project is located in Canada.

### Footing Bars
- Estimated as straight bars extending to within **75 mm** of each face of the footing.

### Column Verticals
- Bars extended the required length from column below to lap with bars above.
- If bar arrangement changes between floors: bars may extend to lap OR cut off 75 mm below top of horizontal member.
- ALL column verticals that are to be lap spliced shall be estimated as **shop offset bent**.

### Column Ties
- Out-to-out dimensions = **80 mm less** than column outside dimensions (unless specified otherwise).
- Lowest tie: no more than half the designated spacing above top of footing/floor.
- Top tie: same distance below lowest horizontal member above.
- Extra ties where column verticals are offset bent (usually 1-2 below lower bend point).

### Spirals
- Diameter = **80 mm less** than outside diameter of column (unless noted).
- Height: from top of footing/floor to level of lowest horizontal reinforcement in slab/drop panel/beam above.
- 10M spiral spacers: 500mm core or less=2, 500-800mm=3, over 800mm=4
- 15M spiral spacers: 600mm core or less=3, over 600mm=4

### Construction Joints
- No construction joints or dowels included unless specifically shown on structural drawings.
- If no dowel length specified: use RSIC Appendix Tables 12-15 for splice/embedment.

### Temperature / Shrinkage Reinforcement
- Must be specified on design drawings in bar sizes and spacings.
- May serve as top support bars.

### Specialty Items (estimate separately)
- Plain bars, threaded bars, caissons/piles, galvanized, stainless steel, epoxy-coated, FRP, mechanical devices, welded wire reinforcement.

### Slab Bar Spacing
- First bar at half the specified spacing from the support edge.
- Remaining bars at specified spacing across slab.

### Coating Designation (on drawings)
- Epoxy Coated: "C" prefix (e.g., C15M@300)
- Stainless Steel: "S" prefix (e.g., S20M@250)
- Galvanized: "G" prefix (e.g., G15M@250)
- FRP: "F" prefix (e.g., F20M@200)

### Abbreviations (recognize in OCR)
BOT=Bottom, BEW=Bottom Each Way, BLW=Bottom Long Way, BSW=Bottom Short Way, T and B=Top and Bottom, TEW=Top Each Way, NF=Near Face, FF=Far Face, O/C=On Centre, C/C=Centre to Centre, SOG=Slab On Grade, CJ=Construction Joint, FTG=Footing, COL=Column, BM=Beam, GB=Grade Beam, RW=Retaining Wall, SL=Slab, CMU=Concrete Masonry Unit
`;

const SMART_SYSTEM_PROMPT = `You are Rebar Estimator Pro — an expert structural estimator AI implementing the "Atomic Truth" pipeline.

${PIPELINE_INSTRUCTIONS}

${ELEMENT_UNIT_SCHEMA}

${REBAR_WEIGHT_TABLE}

${CANADIAN_METRIC_TABLE}

${SMART_PROJECT_DETECTION}

${RSIC_ESTIMATING_RULES}

## Mode: SMART (Automatic)
Execute ALL 9 pipeline stages automatically without pausing for user input.
Analyze every page of every uploaded blueprint exhaustively.

IMPORTANT: Google Vision OCR has already been performed on the uploaded images. The OCR results (text, confidence, bounding boxes) are injected into the user message. Use these REAL OCR results for Stage 4 instead of attempting your own text extraction. Your job is to STRUCTURE and ANALYZE the OCR output, not to re-read the images.

### Estimation Steps (Human-Readable Section)

Step 1 — OCR & Scope Detection: Use the provided Google Vision OCR results to identify ALL rebar and wire mesh scopes from ALL pages. **AUTO-DETECT project category** (Cage/Industrial/Residential/Commercial/Bar List/Infrastructure).
Step 2 — Scope Classification: Classify as Existing/New/Proposed. Only New/Proposed proceed.
Step 2.5 — Rebar Type Identification: Identify all rebar types. Detect if metric (10M, 15M) or imperial (#3, #4). If metric, apply RSIC Canadian standards automatically.
Step 3 — Structural Element Identification: ALL elements in 12 categories (Footings, Grade Beams, Raft Slabs, Beams, Walls, Retaining Walls, ICF Walls, CMU Walls, Piers/Pedestals, Columns, Slabs, Stairs, Wire Mesh).
Step 4 — Dimensions & Scale: Extract ALL dimensions and scales (metric mm/m or imperial in/ft).
Step 5 — Quantities & Arrangement: Count, rebar count, spacing, pattern per element.
Step 5.5 — Rebar Length Optimization: Calculate lengths. For Canadian metric: compare to 12m (10M) and 18m (15M+) mill lengths. For imperial: 20ft/40ft/60ft. Add lap splices per RSIC tables or standard practice.
Step 6 — Weight Calculation: Use imperial weight table for # sizes, Canadian metric mass table for M sizes.
Step 7 — Weight Summary: By size + grand total in lbs/tons AND kg/tonnes (dual units for Canadian projects).
Step 8 — Welded Wire Mesh: Calculate area, sheet counts with overlap (1ft/300mm on TWO sides).

### Wire Mesh Rules
- Area >= 5000 sqft (465 m2): calculate BOTH 4x8ft AND 8x20ft sheet counts
- Area < 5000 sqft: 4x8ft only
- Types: Normal Steel, Stainless Steel, Galvanized, Epoxy

Flag ALL uncertain items with warning flags.

${OUTPUT_FORMAT_INSTRUCTIONS}`;

const STEP_BY_STEP_SYSTEM_PROMPT = `You are Rebar Estimator Pro — an expert structural estimator AI implementing the "Atomic Truth" pipeline in INTERACTIVE mode.

${PIPELINE_INSTRUCTIONS}

${ELEMENT_UNIT_SCHEMA}

${REBAR_WEIGHT_TABLE}

${CANADIAN_METRIC_TABLE}

${SMART_PROJECT_DETECTION}

${RSIC_ESTIMATING_RULES}

## Mode: STEP-BY-STEP (Interactive)
Execute ONE step at a time and WAIT for user confirmation before proceeding.

IMPORTANT: Google Vision OCR has already been performed on the uploaded images. The OCR results are injected into the user message. Use these REAL OCR results instead of attempting your own text extraction.

### Steps with User Interaction

Step 1 — OCR & Scope Detection
Use the provided Google Vision OCR results and present ALL identified scopes. → Ask user to confirm.

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

### Wire Mesh Rules
- Area ≥ 5000 sqft: BOTH 4×8ft AND 8×20ft
- Area < 5000 sqft: 4×8ft only

### CRITICAL RULES
- ONE step at a time
- Tables for structured data
- Flag ALL uncertainties with ⚠️
- Track which step you are on
- If user corrects ANY finding, use user's data for ALL subsequent calculations
- Never argue with corrections

${OUTPUT_FORMAT_INSTRUCTIONS}

NOTE: In step-by-step mode, output the JSON block only after the FINAL step (Step 8) or when the user asks for it.`;

// ── Edge Function Handler ──

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, mode, fileUrls, knowledgeContext, scope } = await req.json();
    
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
      if (scope.detectedCategory) {
        scopeBlock += `\n### PRE-CLASSIFIED PROJECT CATEGORY: ${scope.detectedCategory.toUpperCase()}\n`;
        scopeBlock += `This project has been pre-classified by AI analysis of the blueprints. Prioritize this classification unless the blueprints clearly indicate otherwise.\n`;
      }
      if (scope.detectedStandard && scope.detectedStandard !== "unknown") {
        scopeBlock += `Detected Standard: ${scope.detectedStandard === "canadian_metric" ? "Canadian Metric (CSA/RSIC) — apply RSIC rules" : "US Imperial (ACI)"}\n`;
      }
      if (scope.deviations) scopeBlock += `Project-Specific Deviations: ${scope.deviations}\n`;
      systemPrompt = scopeBlock + "\n---\n\n" + systemPrompt;
    }

    // Prepend user knowledge context if available
    if (knowledgeContext && knowledgeContext.rules && knowledgeContext.rules.length > 0) {
      const rulesBlock = knowledgeContext.rules.join("\n\n");
      systemPrompt = `## USER-DEFINED RULES & KNOWLEDGE (MUST follow these)\n${rulesBlock}\n\n---\n\n${systemPrompt}`;
    }

    // Prepend learned knowledge if available
    if (knowledgeContext && knowledgeContext.learnedRules && knowledgeContext.learnedRules.length > 0) {
      const learnedBlock = knowledgeContext.learnedRules.join("\n\n");
      systemPrompt = `## LEARNED FROM PREVIOUS CONVERSATIONS (Apply these insights)\n${learnedBlock}\n\n---\n\n${systemPrompt}`;
    }

    // Inject training examples into system prompt
    if (knowledgeContext && knowledgeContext.trainingExamples && knowledgeContext.trainingExamples.length > 0) {
      let trainingBlock = `\n\n## TRAINING EXAMPLES — REFERENCE CALCULATIONS (MUST study and follow this methodology)\n\n`;
      knowledgeContext.trainingExamples.forEach((ex: { title: string; answerText: string }, idx: number) => {
        trainingBlock += `### Example ${idx + 1}: ${ex.title}\nThe following is the CORRECT rebar estimation for a real project.\nStudy this carefully and use the SAME methodology, format, and calculation logic for the current project:\n\n${ex.answerText}\n\n---\n\n`;
      });
      trainingBlock += `Use the above examples as your PRIMARY reference for calculation methodology.\n`;
      systemPrompt = systemPrompt + trainingBlock;
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
    const MAX_PDF_SIZE_MB = 4;
    const MAX_PDF_COUNT = 2;
    let pdfCount = 0;

    // Google Vision OCR results to inject
    let visionOcrText = "";
    let visionOcrAvailable = false;

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
            console.log("Downloading PDF for base64:", url.substring(0, 80) + "...");
            const pdfResponse = await fetch(url);
            if (!pdfResponse.ok) { console.error("PDF download failed:", pdfResponse.status); continue; }
            const pdfBuffer = await pdfResponse.arrayBuffer();
            const sizeMB = pdfBuffer.byteLength / (1024 * 1024);
            console.log("PDF size:", sizeMB.toFixed(2), "MB");
            if (sizeMB > MAX_PDF_SIZE_MB) {
              console.log(`PDF too large (${sizeMB.toFixed(1)}MB > ${MAX_PDF_SIZE_MB}MB), skipping`);
              continue;
            }
            const base64 = encodeBase64(pdfBuffer);
            fileContentParts.push({ type: "image_url", image_url: { url: `data:application/pdf;base64,${base64}` } });
            pdfCount++;
            console.log("PDF converted, base64:", Math.round(base64.length / 1024), "KB");
          } catch (err) { console.error("PDF convert error:", err); }
        } else {
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
      }),
    });

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
