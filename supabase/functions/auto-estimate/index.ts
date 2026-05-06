import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ============================================================================
// Deterministic structural graph + geometry resolver
// ----------------------------------------------------------------------------
// Geometry-first rebar: instead of asking the AI to compute lengths, we ask
// the AI to extract callouts, then we resolve them against a graph built from
// the structural OCR (footing schedules, wall elevations, lap defaults, bar
// shapes). Rows that cannot be resolved are persisted with
// assumptions_json.geometry_status = 'unresolved' and confidence 0 so the UI
// can render "—" + a red badge instead of a misleading zero.
// ============================================================================

const REBAR_DIA_MM: Record<string, number> = {
  "10M": 11.3, "15M": 16.0, "20M": 19.5, "25M": 25.2, "30M": 29.9, "35M": 35.7,
  "#3": 9.5,  "#4": 12.7,  "#5": 15.9,  "#6": 19.1,  "#7": 22.2,  "#8": 25.4,
};
const REBAR_MASS_KG_PER_M: Record<string, number> = {
  "10M": 0.785, "15M": 1.570, "20M": 2.355, "25M": 3.925, "30M": 5.495, "35M": 7.850,
  "#3": 0.561, "#4": 0.994, "#5": 1.552, "#6": 2.235, "#7": 3.042, "#8": 3.973,
};
const WWM_MASS_KG_PER_M2: Record<string, number> = {
  "6X6-W1.4/W1.4": 0.93, "6X6-W2.1/W2.1": 1.37, "6X6-W2.9/W2.9": 1.90,
  "6X6-W4.0/W4.0": 2.63, "4X4-W2.1/W2.1": 2.05, "4X4-W4.0/W4.0": 3.94,
};
const sizeKey = (s: string) => {
  const k = String(s || "").toUpperCase().trim();
  const m = k.match(/^(10M|15M|20M|25M|30M|35M|#[3-8])/);
  return m ? m[1] : k;
};
const massFor = (size: string, type: string): number => {
  const k = String(size || "").toUpperCase().trim();
  if (type === "wwm") return WWM_MASS_KG_PER_M2[k] || 0;
  return REBAR_MASS_KG_PER_M[sizeKey(k)] || 0;
};
// NOTE: hardcoded lap fallback (e.g. 40·db) removed by policy.
// Lap lengths must come from Manual-Standard-Practice-2018 (via Brain) or
// from an explicit LAP table in the structural OCR. If neither source
// provides a value, the line is marked UNRESOLVED.

// Build a lightweight structural graph from STRUCTURAL OCR pages only.
// Architectural OCR is intentionally excluded as a geometry source.
interface StructuralGraph {
  // Bar marks the OCR explicitly defines, e.g. "BS80" or "B2035"
  barMarks: Map<string, { size?: string; shape?: string; raw: string }>;
  // Wall callouts: "WALL ... 12500MM ... 3000MM HIGH"
  walls: Array<{ id?: string; lengthMm?: number; heightMm?: number; raw: string }>;
  // Footing schedule rows: "F1 ... 2400 X 600 ... 2-15M T&B"
  footings: Array<{ id?: string; lengthMm?: number; widthMm?: number; raw: string }>;
  // Lap table overrides keyed by size: { "15M": 800 }
  lapTable: Map<string, number>;
  // Detailer's verify notes
  verifyNotes: string[];
}

function buildStructuralGraph(structuralText: string): StructuralGraph {
  const g: StructuralGraph = {
    barMarks: new Map(),
    walls: [],
    footings: [],
    lapTable: new Map(),
    verifyNotes: [],
  };
  if (!structuralText) return g;
  const text = structuralText.toUpperCase();

  // Bar marks: BS\d{2,3} or B\d{4} optionally followed by size token
  const markRx = /\b(B[S]?\d{2,4})\b[^\n]{0,80}?(10M|15M|20M|25M|30M|35M|#[3-8])?/g;
  let mm: RegExpExecArray | null;
  while ((mm = markRx.exec(text))) {
    const id = mm[1];
    if (g.barMarks.has(id)) continue;
    g.barMarks.set(id, { size: mm[2], raw: mm[0].slice(0, 100) });
  }

  // Wall dimensions
  const wallRx = /WALL[^\n]{0,80}?(\d{3,5})\s*MM[^\n]{0,40}?(?:HIGH|HEIGHT|HGT)?[^\n]{0,20}?(\d{3,5})?\s*MM?/g;
  let wm: RegExpExecArray | null;
  while ((wm = wallRx.exec(text))) {
    const a = Number(wm[1]); const b = wm[2] ? Number(wm[2]) : undefined;
    // Heuristic: longer is length, shorter is height
    const lengthMm = b && b > a ? b : a;
    const heightMm = b && b > a ? a : b;
    g.walls.push({ lengthMm, heightMm, raw: wm[0].slice(0, 80) });
    if (g.walls.length >= 8) break;
  }

  // Footing schedule: "F1 2400 X 600" or "F12 1200x1200"
  const ftgRx = /\b(F\d{1,3})\b[^\n]{0,40}?(\d{3,5})\s*[X×]\s*(\d{3,5})/g;
  let fm: RegExpExecArray | null;
  while ((fm = ftgRx.exec(text))) {
    g.footings.push({ id: fm[1], lengthMm: Number(fm[2]), widthMm: Number(fm[3]), raw: fm[0].slice(0, 80) });
    if (g.footings.length >= 16) break;
  }

  // Lap table: "LAP 15M = 800" or "15M LAP 800MM"
  const lapRx = /(10M|15M|20M|25M|30M|35M|#[3-8])[^\n]{0,20}?LAP[^\n]{0,10}?(\d{3,4})/g;
  const lapRx2 = /LAP[^\n]{0,10}?(10M|15M|20M|25M|30M|35M|#[3-8])[^\n]{0,10}?(\d{3,4})/g;
  for (const rx of [lapRx, lapRx2]) {
    let lm: RegExpExecArray | null;
    while ((lm = rx.exec(text))) g.lapTable.set(sizeKey(lm[1]), Number(lm[2]));
  }

  // Detailer verify notes
  const verifyRx = /(?:PLEASE\s+)?(?:ENG\.?\s+)?VERIFY[^\n]{0,80}/g;
  let vm: RegExpExecArray | null;
  while ((vm = verifyRx.exec(text))) {
    g.verifyNotes.push(vm[0].trim());
    if (g.verifyNotes.length >= 12) break;
  }
  return g;
}

// Resolve a single AI line item against the graph. Pure function.
type GeometryStatus = "resolved" | "partial" | "unresolved";
interface ResolveResult {
  qty?: number;
  totalLengthM?: number;
  totalWeightKg?: number;
  status: GeometryStatus;
  missing: string[];
  derivation?: string;
}
function resolveLine(
  it: { description?: string; bar_size?: string; quantity_count?: number; total_length?: number; total_weight?: number; item_type?: string },
  graph: StructuralGraph,
): ResolveResult {
  const desc = String(it.description || "").toUpperCase();
  const size = String(it.bar_size || "").toUpperCase();
  const type = String(it.item_type || "rebar");
  const aiQty = Number(it.quantity_count) || 0;
  const aiLen = Number(it.total_length) || 0;
  const mass = massFor(size, type);

  // CASE A — AI already produced a qty AND length backed by an explicit bar list.
  // Trust the AI value but require provenance: description must reference a mark
  // present in the graph OR contain explicit dimension tokens.
  if (aiQty > 0 && aiLen > 0) {
    const markMatch = desc.match(/\b(B[S]?\d{2,4})\b/);
    const hasDims = /\d{3,5}\s*MM/.test(desc);
    const known = markMatch ? graph.barMarks.has(markMatch[1]) : false;
    if (known || hasDims) {
      return {
        qty: aiQty,
        totalLengthM: aiLen,
        totalWeightKg: Number(it.total_weight) > 0 ? Number(it.total_weight) : +(aiLen * mass).toFixed(2),
        status: "resolved",
        missing: [],
        derivation: known ? `mark ${markMatch![1]} from schedule` : "explicit dimensions in callout",
      };
    }
    // AI guessed without provenance — downgrade to partial
    return {
      qty: aiQty, totalLengthM: aiLen,
      totalWeightKg: Number(it.total_weight) > 0 ? Number(it.total_weight) : +(aiLen * mass).toFixed(2),
      status: "partial",
      missing: ["provenance: no bar mark or explicit dimension found in description"],
    };
  }

  // CASE B — Try deterministic derivation from spacing + a wall
  const spMatch = desc.match(/@\s*(\d{2,4})\s*MM/);
  const spacing = spMatch ? Number(spMatch[1]) : 0;
  const wall = graph.walls.find((w) => (w.lengthMm || 0) > 0);
  if (spacing > 0 && wall?.lengthMm) {
    const lap = graph.lapTable.get(sizeKey(size)) ?? 0;
    const qty = Math.ceil(wall.lengthMm / spacing) + 1;
    const missing: string[] = [];
    let barLenMm = 0;
    if (!lap) missing.push(`lap length for ${sizeKey(size)} (Manual-Standard-Practice-2018)`);
    if (wall.heightMm && lap) barLenMm = wall.heightMm + lap;
    else if (!wall.heightMm) missing.push("wall height (mm)");
    if (barLenMm > 0) {
      const totalLengthM = +(qty * barLenMm / 1000).toFixed(2);
      return {
        qty, totalLengthM,
        totalWeightKg: +(totalLengthM * mass).toFixed(2),
        status: missing.length ? "partial" : "resolved",
        missing,
        derivation: `qty=ceil(${wall.lengthMm}/${spacing})+1=${qty}; bar=${(wall.heightMm || 0)}+${lap}mm`,
      };
    }
    return { qty, status: "partial", missing: ["bar developed length"], derivation: `qty=${qty} from wall`, };
  }

  // CASE C — bar mark referenced but no shape geometry available
  const markMatch = desc.match(/\b(B[S]?\d{2,4})\b/);
  if (markMatch) {
    const known = graph.barMarks.get(markMatch[1]);
    return {
      status: "unresolved",
      missing: known
        ? [`shape geometry for ${markMatch[1]}`, "host element dimensions"]
        : [`${markMatch[1]} not defined in any structural schedule`],
    };
  }

  // CASE D — concrete element placeholder, no rebar callout in OCR
  return {
    status: "unresolved",
    missing: ["rebar callout", "element dimensions"],
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await anonClient.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { segment_id, project_id } = await req.json();
    if (!segment_id || !project_id) {
      return new Response(JSON.stringify({ error: "segment_id and project_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Gather context
    const [segRes, projRes, filesRes, stdRes, existingRes, searchIndexRes, knowledgeRes] = await Promise.all([
      supabase.from("segments").select("*").eq("id", segment_id).single(),
      supabase.from("projects").select("name, project_type, scope_items, description").eq("id", project_id).single(),
      supabase.from("project_files").select("id, file_name, file_type").eq("project_id", project_id).limit(20),
      supabase.from("standards_profiles").select("*").eq("user_id", user.id).eq("is_default", true).limit(1),
      supabase.from("estimate_items").select("id, description, bar_size, quantity_count, total_length, total_weight, confidence").eq("segment_id", segment_id).limit(200),
      supabase.from("drawing_search_index").select("raw_text, page_number, extracted_entities").eq("project_id", project_id).limit(50),
      supabase.from("agent_knowledge").select("title, content, file_name").eq("user_id", user.id).limit(50),
    ]);

    const segment = segRes.data;
    const project = projRes.data;
    const files = filesRes.data || [];
    const standard = stdRes.data?.[0];
    const existing = existingRes.data || [];

    // ============================================================
    // MANUAL-ONLY AUTHORITY GATE
    // Manual-Standard-Practice-2018 (uploaded into Brain) is the
    // ONLY allowed source of assumptions (lap, splice, hook, bend).
    // If the manual is not present and parsed (content > 1000 chars),
    // refuse to estimate — return a blocker the UI can render.
    // ============================================================
    const allKnowledge = (knowledgeRes.data || []) as Array<{ title?: string; content?: string; file_name?: string }>;
    const manualEntry = allKnowledge.find((k) => {
      const hay = `${k.title || ""} ${k.file_name || ""}`.toLowerCase();
      return /manual.*standard.*practice.*2018|standard.?practice.?2018/.test(hay)
        && (k.content || "").length > 1000;
    });
    if (!manualEntry) {
      console.warn("[auto-estimate] BLOCKED: Manual-Standard-Practice-2018 not loaded into Brain (or not parsed).");
      return new Response(JSON.stringify({
        success: false,
        blocked: true,
        reason: "MANUAL_NOT_LOADED",
        message: "Manual-Standard-Practice-2018 must be uploaded to Brain (with extracted text) before takeoff can run. No assumptions are allowed without manual citations.",
        items_created: 0,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const manualText = (manualEntry.content || "").slice(0, 12000);

    // Build drawing text from search index (OCR), with strict source priority for
    // production rebar quantities:
    //   1. SHOP DRAWINGS  — PRIMARY quantity source
    //   2. STRUCTURAL     — SECONDARY verification / gap-fill
    //   3. ARCHITECTURAL  — CONTEXT ONLY, never quantified from
    let drawingTextContext = "";
    const searchPages = searchIndexRes.data || [];
    // Build a per-page → file map so the model can cite source sheet
    const fileByName = new Map<string, { id: string; file_name: string }>();
    for (const f of files as Array<{ id: string; file_name?: string }>) {
      if (f.file_name) fileByName.set(f.file_name.toUpperCase(), { id: f.id, file_name: f.file_name });
    }
    const isShopName = (n: string) => /\bSHOP\b|^SD[\s_-]?\d|\bSD\d/i.test(n || "");
    const isStructName = (n: string) => /\bSTRUCT|^S[\s_-]?\d|\bSTR[-_\s]/i.test(n || "");
    const isArchName = (n: string) => /\bARCH|^A[\s_-]?\d/i.test(n || "");
    if (searchPages.length > 0) {
      const shop: string[] = [];
      const structural: string[] = [];
      const architectural: string[] = [];
      const other: string[] = [];
      for (const page of searchPages) {
        const text = (page.raw_text || "").trim();
        if (text.length <= 20) continue;
        const tb = (page.extracted_entities as any)?.title_block || {};
        const disc = String(tb.discipline || "").toLowerCase();
        const sheetTag = (page.extracted_entities as any)?.title_block?.sheet_id || `p${page.page_number}`;
        const snip = `[SHEET ${sheetTag} · Page ${page.page_number}] ${text.substring(0, 2000)}`;
        if (disc.includes("shop") || /\bSD\b|SHOP DRAWING/i.test(text.slice(0, 200))) shop.push(snip);
        else if (disc.includes("struct")) structural.push(snip);
        else if (disc.includes("arch")) architectural.push(snip);
        else other.push(snip);
      }
      const parts: string[] = [];
      if (shop.length > 0) {
        parts.push("=== SHOP DRAWING OCR (PRIMARY — production quantities come from here) ===\n" + shop.join("\n\n"));
      }
      if (structural.length > 0) {
        parts.push("=== STRUCTURAL OCR (SECONDARY — verify shop quantities, fill gaps) ===\n" + structural.join("\n\n"));
      }
      if (other.length > 0) {
        parts.push("=== UNCLASSIFIED OCR ===\n" + other.join("\n\n"));
      }
      if (architectural.length > 0) {
        // Architectural is CONTEXT ONLY — never feed body text to quantity prompt.
        const archTitles = architectural.slice(0, 6).map((s) => s.split("\n")[0]).join("\n");
        parts.push("=== ARCHITECTURAL OCR (CONTEXT ONLY — DO NOT QUANTIFY FROM) ===\n" + archTitles);
      }
      drawingTextContext = parts.join("\n\n").slice(0, 14000);
    } else {
      try {
        const { data: docVersions } = await supabase
          .from("document_versions")
          .select("pdf_metadata, file_name")
          .eq("project_id", project_id)
          .limit(10);
        if (docVersions && docVersions.length > 0) {
          const textSnippets: string[] = [];
          for (const dv of docVersions) {
            const meta = dv.pdf_metadata as any;
            if (meta?.pages) {
              for (const page of meta.pages.slice(0, 5)) {
                if (page.raw_text) {
                  textSnippets.push(`[${dv.file_name} p${page.page_number}] ${page.raw_text.slice(0, 1500)}`);
                }
              }
            }
          }
          drawingTextContext = textSnippets.join("\n\n").slice(0, 8000);
        }
      } catch (drawErr) {
        console.warn("Could not fetch drawing text:", drawErr);
      }
    }

    // Build RSIC knowledge context
    let knowledgeContext = "";
    const knowledgeEntries = knowledgeRes.data || [];
    if (knowledgeEntries.length > 0) {
      const relevant = knowledgeEntries.filter((k: any) =>
        /RSIC|standard|rebar|mass|weight|bar.*size|estimat/i.test(k.title || "") ||
        /RSIC|standard|rebar|mass|weight|bar.*size|estimat/i.test((k.content || "").substring(0, 200))
      );
      if (relevant.length > 0) {
        knowledgeContext = "\n=== RSIC STANDARDS REFERENCE ===\n";
        for (const k of relevant.slice(0, 3)) {
          knowledgeContext += `[${k.title}]\n${(k.content || "").substring(0, 2000)}\n\n`;
        }
      }
    }

    // Detect scope coverage from file names AND OCR drawing tokens (5 construction buckets).
    // Buckets are universal across project types — never hard-code a single project's scope.
    const fileNames = files.map((f: any) => (f.file_name || "").toUpperCase());
    const ocrUpper = (drawingTextContext || "").toUpperCase();
    const corpus = `${fileNames.join(" ")} ${ocrUpper}`;
    const BUCKET_TOKENS: Record<string, RegExp> = {
      FOUNDATION: /FOOTING|FOUND|FTG|PILE|CAISSON|RAFT|MAT|PILE.?CAP|GRADE.?BEAM|FROST.?WALL/,
      VERTICAL:   /\bWALL\b|\bCOLUMN\b|\bCOL\b|PIER|SHEAR|RETAINING|CMU|ICF/,
      HORIZONTAL: /\bBEAM\b|GIRDER|JOIST|LINTEL|BOND.?BEAM/,
      SLAB:       /\bSLAB\b|\bSOG\b|SLAB.?ON.?GRADE|SUSPENDED|TOPPING|DECK/,
      MISC:       /STAIR|LEDGE|CURB|STOOP|EQUIPMENT.?PAD|ELEVATOR.?PIT|SUMP|TRANSFORMER/,
    };
    const bucketsPresent = Object.entries(BUCKET_TOKENS)
      .filter(([_, rx]) => rx.test(corpus)).map(([k]) => k);
    const bucketsAbsent = Object.keys(BUCKET_TOKENS).filter((k) => !bucketsPresent.includes(k));
    const scopeHint = project?.scope_items?.length
      ? project.scope_items.join(", ")
      : (bucketsPresent.length
          ? `BUCKETS PRESENT: ${bucketsPresent.join(", ")}. BUCKETS ABSENT (do NOT estimate): ${bucketsAbsent.join(", ") || "none"}`
          : "");

    if (!segment) {
      return new Response(JSON.stringify({ error: "Segment not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const existingDesc = existing.map((e: any) => e.description).filter(Boolean).join(", ");
    // Normalized key for de-dup (segment-scoped)
    const normKey = (desc: string, size: string) =>
      `${(desc || "").toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9 #@\.\-]/g, "").trim()}|${(size || "").toUpperCase().trim()}`;
    const existingKeys = new Set(
      (existing as Array<{ description?: string; bar_size?: string }>).map((e) => normKey(e.description || "", e.bar_size || "")),
    );

    const systemPrompt = `You are a rebar EXTRACTION assistant. You DO NOT compute geometry. A deterministic resolver downstream will calculate qty, length and weight. Your job is to faithfully extract rebar callouts from the drawing text and CITE THE MANUAL for any assumption.
Rules:
- Return ONLY a JSON array of objects, no markdown, no explanation.
- Each object: { "description": string, "bar_size": string, "quantity_count": number, "total_length": number, "total_weight": number, "confidence": number, "item_type": "rebar" | "wwm", "source_sheet": string | null, "source_excerpt": string | null, "authority_section": string | null, "authority_page": number | null, "authority_quote": string | null }
- SOURCE PRIORITY (production rebar quantities):
    1. SHOP DRAWING OCR  — PRIMARY. Quantities MUST come from here when present.
    2. STRUCTURAL OCR    — SECONDARY. Use only to verify or fill gaps not in shop drawings.
    3. ARCHITECTURAL OCR — CONTEXT ONLY. NEVER derive a quantity from architectural sheets.
- ASSUMPTION AUTHORITY: The ONLY allowed source for assumption rules (lap, splice, hook, bend, development length) is "Manual-Standard-Practice-2018" provided below. Every row that uses an assumption MUST set authority_section, authority_page (if available) and authority_quote. If the manual does not cover the needed rule, leave the geometry fields 0 — the resolver will mark UNRESOLVED. NEVER invent a value.
- Always include "source_sheet" with the SHEET tag from the OCR header (e.g. "SD-06") and "source_excerpt" with a verbatim quoted phrase from that sheet.
- Extraction policy:
  * If a bar list / footing schedule row is explicitly visible (Mark, Qty, Size, Total Length), copy those EXACT numbers into quantity_count and total_length (m). Set confidence 0.9.
  * If a callout is visible but the geometry is referenced indirectly (e.g. "17 10M BS80 @300 DWL", "1 20M B2035 TOP CONT. IF"), extract ONLY what is literally written: include the bar mark in the description, set quantity_count to the literal count if shown, leave total_length=0, total_weight=0, confidence 0.4. The downstream resolver will compute the rest.
  * NEVER invent dimensions, spacing, wall heights or lap lengths. NEVER guess. If a number is not literally on the drawing, leave it 0.
- Bar sizes: use metric (10M, 15M, 20M, 25M, 30M, 35M) or imperial (#3..#8).
- WIRE MESH (WWM): if mesh designations appear, set item_type="wwm", bar_size=mesh designation. Leave area=0 unless slab dimensions are literally given.
- Always include the bar mark (BSxx, Bxxxx) in the description verbatim when present — the resolver keys off it.
- Quote the source phrase from OCR in the description so provenance can be checked, e.g. "17 10M BS80 @300 DWL.".
- ${scopeHint ? `SCOPE RESTRICTION: ${scopeHint}` : ""}
- Do NOT duplicate items already estimated: ${existingDesc || "none yet"}.`;

    const fewShot = `EXAMPLES of correct EXTRACTION (do not compute):
OCR snippet: "17 10M BS80 @300 DWL." →
  {"description":"17 10M BS80 @300 DWL.","bar_size":"10M","quantity_count":17,"total_length":0,"total_weight":0,"confidence":0.4,"item_type":"rebar"}
OCR snippet bar list row "BS31  12  15M  3650mm  Type 1" →
  {"description":"BS31 Type 1","bar_size":"15M","quantity_count":12,"total_length":43.80,"total_weight":68.77,"confidence":0.9,"item_type":"rebar"}`;

    const userPrompt = `Project: ${project?.name || "Unknown"}
Type: ${project?.project_type || "Unknown"}
Scope: ${(project?.scope_items || []).join(", ") || "Not defined"}
Files: ${files.map((f: any) => f.file_name).join(", ") || "None"}

Segment: ${segment.name}
Type: ${segment.segment_type}
Level: ${segment.level_label || "Not specified"}
Zone: ${segment.zone_label || "Not specified"}
Notes: ${segment.notes || "None"}

Standards: ${standard ? `${standard.name} (${standard.code_family}, ${standard.units})` : "Default metric"}
Cover defaults: ${standard?.cover_defaults ? JSON.stringify(standard.cover_defaults) : "Standard"}
Lap defaults: ${standard?.lap_defaults ? JSON.stringify(standard.lap_defaults) : "Standard"}

${knowledgeContext}

=== ASSUMPTION AUTHORITY (Manual-Standard-Practice-2018) ===
${manualText}
=== END ASSUMPTION AUTHORITY ===

${drawingTextContext ? `=== DRAWING TEXT ===\n${drawingTextContext}\n=== END DRAWING TEXT ===` : "NO DRAWING TEXT AVAILABLE. DO NOT ESTIMATE. Return an empty JSON array []."}

Generate estimate items for this segment. Base quantities on the ACTUAL drawing data if available, not assumptions.

${fewShot}

Output the JSON array now. Extract literally from the OCR; do not guess geometry. Lines without an explicit bar-list row should keep total_length=0 — the deterministic resolver will compute it.`;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "AI not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0,
        max_tokens: 16000,
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResponse.text();
      console.error("AI error:", status, errText);
      return new Response(JSON.stringify({ error: "AI generation failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content || "";
    const finishReason = aiData.choices?.[0]?.finish_reason;
    if (finishReason === "length") {
      console.warn("[auto-estimate] AI response truncated (finish_reason=length)");
    }

    // Parse JSON from response (strip markdown fences if present)
    let items: any[];
    try {
      let jsonStr = rawContent.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
      // Slice from first '[' to last ']' to drop any prose preamble/postamble
      const start = jsonStr.indexOf("[");
      const end = jsonStr.lastIndexOf("]");
      if (start !== -1 && end > start) jsonStr = jsonStr.slice(start, end + 1);
      // Strip trailing commas before ] or }
      jsonStr = jsonStr.replace(/,\s*([\]}])/g, "$1");
      items = JSON.parse(jsonStr);
      if (!Array.isArray(items)) throw new Error("Not an array");
    } catch {
      console.error("Failed to parse AI response:", rawContent);
      return new Response(JSON.stringify({ error: "AI returned invalid format. Please try again." }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ============================================================
    // DETERMINISTIC GEOMETRY RESOLVER
    // The AI extracted callouts; we now compute qty/length/weight
    // from the structural graph and tag each row with a geometry
    // status so the UI can render UNRESOLVED rows honestly.
    // ============================================================
    const structuralOnly = (drawingTextContext || "")
      .split("=== ARCHITECTURAL OCR")[0]; // never feed arch OCR to geometry
    const graph = buildStructuralGraph(structuralOnly);
    console.log(`[auto-estimate] graph: ${graph.barMarks.size} marks, ${graph.walls.length} walls, ${graph.footings.length} footings, ${graph.verifyNotes.length} verify notes`);

    const enriched = items.map((it: any) => {
      const r = resolveLine(it, graph);
      const baseDesc = String(it.description || "").trim();
      const isUnresolved = r.status === "unresolved";
      const cleanDesc = baseDesc.replace(/^UNRESOLVED:\s*/i, "");
      return {
        ...it,
        description: cleanDesc,
        quantity_count: r.qty ?? 0,
        total_length: r.totalLengthM ?? 0,
        total_weight: r.totalWeightKg ?? 0,
        // Confidence: resolved keeps AI confidence (capped 0.95), partial halved, unresolved 0
        confidence: isUnresolved ? 0
          : r.status === "partial" ? Math.min(Number(it.confidence) || 0.4, 0.5)
          : Math.min(Number(it.confidence) || 0.7, 0.95),
        _geometry_status: r.status,
        _missing_refs: r.missing,
        _derivation: r.derivation || null,
      };
    });
    items = enriched;

    // Best-effort page locator: for each item, scan OCR pages for the bar mark
    // / bar-size / strongest description token and attach the first matching
    // page_number. No bbox available yet — UI degrades to a centered pin on
    // that page (much better than rendering the wrong sheet).
    {
      const pages = (searchPages || [])
        .filter((p: any) => p && (p.raw_text || "").length > 20)
        .map((p: any) => ({ page_number: Number(p.page_number) || 1, text: String(p.raw_text || "").toUpperCase() }));
      const pickPage = (it: any): number | null => {
        if (pages.length === 0) return null;
        const tokens: string[] = [];
        const desc = String(it.description || "").toUpperCase();
        const sz = String(it.bar_size || "").toUpperCase().trim();
        const markMatch = desc.match(/\b(BS\d+|BS-\d+|F\d+|FW\d+|W\d+|P\d+|C\d+|GB\d+|B\d+|S\d+|PC\d+)\b/);
        if (markMatch) tokens.push(markMatch[1]);
        if (sz) tokens.push(sz);
        const words = desc.split(/[^A-Z0-9#@.\-]+/).filter((w) => w.length >= 4).slice(0, 4);
        tokens.push(...words);
        for (const tok of tokens) {
          const hit = pages.find((p) => p.text.includes(tok));
          if (hit) return hit.page_number;
        }
        return null;
      };
      for (const it of items) {
        const p = pickPage(it);
        if (p) it._page_number = p;
      }
    }

    // Weight validation gate — flag outliers
    const totalAiWeight = items.reduce((s: number, i: any) => s + (Number(i.total_weight) || 0), 0);
    const segType = segment.segment_type;
    const weightLimits: Record<string, number> = {
      footing: 5000, pier: 3000, slab: 15000, wall: 8000, beam: 5000, column: 3000,
      stair: 2000, pit: 2000, curb: 1000, retaining_wall: 10000, miscellaneous: 10000,
    };
    const maxWeight = weightLimits[segType] || 15000;
    if (totalAiWeight > maxWeight) {
      console.warn(`[weight-gate] AI estimated ${totalAiWeight.toFixed(0)}kg for ${segType} segment "${segment.name}" — exceeds ${maxWeight}kg limit. Flagging low confidence.`);
      // Scale down confidence for all items to flag as suspicious
      items.forEach((item: any) => { item.confidence = Math.min(item.confidence || 0.5, 0.4); });
    }

    // Per-row provenance: prefer the file the model cited via source_sheet,
    // falling back to filename-role priority (shop > structural). NEVER pick
    // an architectural file as the source for a quantity row.
    const upperNames = (files as Array<{ id: string; file_name?: string }>).map(
      (f) => ({ id: f.id, name: (f.file_name || "").toUpperCase() })
    );
    const shopFile = upperNames.find((f) => isShopName(f.name));
    const structFile = upperNames.find((f) => isStructName(f.name));
    const defaultSourceId =
      shopFile?.id || structFile?.id ||
      upperNames.find((f) => !isArchName(f.name))?.id || null;

    const resolveRowSource = (it: { source_sheet?: string | null }): string | null => {
      const tag = String(it.source_sheet || "").toUpperCase().trim();
      if (tag) {
        const hit = upperNames.find((f) => f.name.includes(tag));
        if (hit && !isArchName(hit.name)) return hit.id;
      }
      return defaultSourceId;
    };

    // Insert items into estimate_items
    const rows = items.map((item: any) => {
      const hasAssumption = !!(item._derivation || item._missing_refs?.length);
      const citationMissing = hasAssumption && !item.authority_section && !item.authority_quote;
      return {
      segment_id,
      project_id,
      user_id: user.id,
      description: String(item.description || "").slice(0, 500),
      bar_size: String(item.bar_size || "").slice(0, 20),
      quantity_count: Math.max(0, Math.round(Number(item.quantity_count) || 0)),
      total_length: Math.max(0, Number(item.total_length) || 0),
      total_weight: Math.max(0, Number(item.total_weight) || 0),
      confidence: Math.min(1, Math.max(0, Number(item.confidence) || 0)),
      item_type: String(item.item_type || "rebar"),
      status: (item._geometry_status === "unresolved" || citationMissing) ? "unresolved" : "draft",
      source_file_id: resolveRowSource(item),
      assumptions_json: {
        geometry_status: item._geometry_status || "unresolved",
        missing_refs: item._missing_refs || [],
        derivation: item._derivation || null,
        page_number: item._page_number || null,
        source_sheet: item.source_sheet || null,
        source_excerpt: item.source_excerpt || null,
        authority_document: "Manual-Standard-Practice-2018",
        authority_section: item.authority_section || null,
        authority_page: item.authority_page || null,
        authority_quote: item.authority_quote || null,
        assumption_rule_id: item.assumption_rule_id || null,
        citation_missing: citationMissing,
      },
    };
    });

    // De-dup gate: collapse rows on (normalized description, bar_size) keeping highest-confidence,
    // and skip rows that already exist for this segment.
    const dedupMap = new Map<string, typeof rows[number]>();
    for (const r of rows) {
      const k = normKey(r.description, r.bar_size);
      if (existingKeys.has(k)) continue;
      const prev = dedupMap.get(k);
      if (!prev || (r.confidence as number) > (prev.confidence as number)) dedupMap.set(k, r);
    }
    const dedupedRows = Array.from(dedupMap.values());

    const { data: inserted, error: insertErr } = await supabase
      .from("estimate_items")
      .insert(dedupedRows)
      .select("id");

    if (insertErr) {
      console.error("Insert error:", insertErr);
      return new Response(JSON.stringify({ error: "Failed to save items" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Open a validation_issue for every unresolved row so the QA queue surfaces them.
    const unresolvedIssues = dedupedRows
      .map((r, idx) => ({ r, id: inserted?.[idx]?.id }))
      .filter((x) => (x.r as any).assumptions_json?.geometry_status === "unresolved")
      .map((x) => ({
        user_id: user.id,
        project_id,
        segment_id,
        source_file_id: sourceFileId || null,
        issue_type: "unresolved_geometry",
        severity: "error",
        title: `Unresolved geometry: ${x.r.description.slice(0, 80)}`,
        description: `Missing: ${((x.r as any).assumptions_json?.missing_refs || []).join("; ")}${graph.verifyNotes.length ? `\nDetailer notes: ${graph.verifyNotes.slice(0, 3).join(" | ")}` : ""}`,
        status: "open",
        source_refs: [{
          estimate_item_id: x.id,
          missing: (x.r as any).assumptions_json?.missing_refs || [],
          page_number: (x.r as any).assumptions_json?.page_number || null,
          bar_size: (x.r as any).bar_size || null,
          description: (x.r as any).description || null,
        }],
      }));
    if (unresolvedIssues.length > 0) {
      const { error: viErr } = await supabase.from("validation_issues").insert(unresolvedIssues);
      if (viErr) console.warn("validation_issues insert failed:", viErr.message);
    }

    // Update segment confidence to avg of its estimate items (deduped set)
    const avgConf = dedupedRows.reduce((s, r) => s + (r.confidence as number), 0) / (dedupedRows.length || 1);
    await supabase.from("segments").update({ confidence: Math.round(avgConf * 100) / 100 }).eq("id", segment_id);

    // Audit log
    await supabase.from("audit_events").insert({
      user_id: user.id,
      project_id,
      segment_id,
      action: "auto_estimated",
      entity_type: "segment",
      entity_id: segment_id,
      metadata: { items_created: inserted?.length || 0 },
    });

    return new Response(JSON.stringify({
      success: true,
      items_created: inserted?.length || 0,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("auto-estimate error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
