import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EXTRACTION_VERSION = "2026.03.05";

const COMMON_WORDS = new Set([
  "OF","IN","AT","TO","AS","IS","IT","OR","ON","IF","NO","DO","UP","BY","AN","BE","SO","WE","HE","ME",
  "MY","US","AM","GO","HA","OK","OH","AH","RE","MM","CM","DIA","THE","AND","FOR","ARE","BUT","NOT",
]);

/** Expanded bar mark patterns */
function extractBarMarks(text: string): string[] {
  const patterns = [
    /\b([A-Z]{1,2}\d{1,3})\b/g,       // A1, AB12, B200
    /\bBM[- ]?(\d{1,5})\b/gi,          // BM-001, BM 12, BM001
    /\b(\d{1,5}[A-Z])\b/g,             // 12A, 200B
    /\b(#\d{1,3})\b/g,                 // #4, #10
  ];
  const marks = new Set<string>();
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const bm = (match[1] || match[0]).toUpperCase().replace(/^BM[- ]?/, "BM");
      if (!COMMON_WORDS.has(bm) && bm.length <= 8) {
        marks.add(bm);
      }
    }
  }
  return Array.from(marks);
}

/** Compute data quality flags */
function computeQualityFlags(page: {
  raw_text?: string;
  title_block?: Record<string, string>;
  bar_marks: string[];
  sheet_id: string | null;
  is_ocr?: boolean;
}): string[] {
  const flags: string[] = [];
  if (page.is_ocr) flags.push("ocr_used");
  if (!page.sheet_id) flags.push("missing_sheet_id");
  if (!page.title_block?.scale) flags.push("missing_scale");
  if (page.bar_marks.length === 0) flags.push("no_bar_marks");
  if (!page.raw_text || page.raw_text.length < 50) flags.push("sparse_text");
  return flags;
}

/** Compute confidence score (0.0 – 1.0) */
function computeConfidence(flags: string[]): number {
  let score = 1.0;
  const penalties: Record<string, number> = {
    missing_sheet_id: 0.2,
    missing_scale: 0.1,
    no_bar_marks: 0.1,
    sparse_text: 0.2,
    ocr_used: 0.05,
  };
  for (const f of flags) {
    score -= penalties[f] || 0;
  }
  return Math.max(0, Math.round(score * 100) / 100);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Auth
    const authHeader = req.headers.get("authorization");
    let userId: string | null = null;
    if (authHeader) {
      const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
      const token = authHeader.replace("Bearer ", "");
      const { data: { user } } = await anonClient.auth.getUser(token);
      userId = user?.id || null;
    }
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const {
      project_id,
      pages,
      document_version_id,
      crm_deal_id,
      drawing_set_id,
      sha256: doc_sha256,
      pipeline_file_id,
      source_system,
      is_ocr,
    } = body;

    if (!project_id || !pages || !Array.isArray(pages)) {
      return new Response(JSON.stringify({ error: "project_id and pages[] required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // SHA-256 dedup check
    if (doc_sha256) {
      const { data: existing } = await supabase
        .from("drawing_search_index")
        .select("id, project_id")
        .eq("sha256", doc_sha256)
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();

      if (existing) {
        return new Response(
          JSON.stringify({
            indexed: 0,
            skipped: pages.length,
            total: pages.length,
            conflicts: [],
            duplicate_of: existing.id,
            message: `Exact duplicate detected (SHA-256 match). Existing entry: ${existing.id}`,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    let indexed = 0;
    let skipped = 0;
    const conflicts: string[] = [];
    const qualityIssues: string[] = [];

    for (const page of pages) {
      const tb = page.title_block || {};
      const rawText = page.raw_text || "";

      if (!rawText.trim()) {
        skipped++;
        continue;
      }

      // Extract bar marks with expanded patterns
      const barMarks = extractBarMarks(rawText);

      // Upsert logical drawing
      const sheetId = tb.sheet_number || null;
      const discipline = tb.discipline || null;
      const drawingType = tb.drawing_type || null;

      let logicalDrawingId: string | null = null;
      if (sheetId) {
        const { data: existing } = await supabase
          .from("logical_drawings")
          .select("id, revision_chain_id")
          .eq("user_id", userId)
          .eq("project_id", project_id)
          .eq("sheet_id", sheetId)
          .eq("drawing_type", drawingType || "")
          .maybeSingle();

        if (existing) {
          logicalDrawingId = existing.id;

          // Revision chain: update latest_revision_code
          const newRevCode = tb.revision_code || null;
          if (newRevCode) {
            await supabase
              .from("logical_drawings")
              .update({ latest_revision_code: newRevCode })
              .eq("id", existing.id);
          }

          // If no revision_chain_id yet, assign one
          if (!existing.revision_chain_id) {
            const chainId = crypto.randomUUID();
            await supabase
              .from("logical_drawings")
              .update({ revision_chain_id: chainId })
              .eq("id", existing.id);
          }
        } else {
          const chainId = crypto.randomUUID();
          const { data: created } = await supabase
            .from("logical_drawings")
            .insert({
              user_id: userId,
              project_id,
              sheet_id: sheetId,
              discipline,
              drawing_type: drawingType,
              revision_chain_id: chainId,
              latest_revision_code: tb.revision_code || null,
            })
            .select("id")
            .single();
          logicalDrawingId = created?.id || null;
        }

        // Revision conflict detection
        const newRevisionLabel = tb.revision_code || null;
        if (logicalDrawingId && newRevisionLabel) {
          const { data: existingEntries } = await supabase
            .from("drawing_search_index")
            .select("id, revision_label")
            .eq("logical_drawing_id", logicalDrawingId)
            .eq("user_id", userId)
            .not("revision_label", "is", null)
            .neq("revision_label", newRevisionLabel)
            .limit(1);

          if (existingEntries && existingEntries.length > 0) {
            const conflictNote = `Sheet ${sheetId}: existing rev "${existingEntries[0].revision_label}" vs new rev "${newRevisionLabel}"`;
            conflicts.push(conflictNote);
            await supabase.from("reconciliation_records").insert({
              user_id: userId,
              project_id,
              issue_type: "REVISION_CHAIN_AMBIGUOUS",
              notes: conflictNote,
              candidates: {
                logical_drawing_id: logicalDrawingId,
                sheet_id: sheetId,
                existing_revision: existingEntries[0].revision_label,
                new_revision: newRevisionLabel,
              },
              automated_reasoning: {
                source: "populate-search-index",
                action: "indexed_with_conflict",
                extraction_version: EXTRACTION_VERSION,
              },
            });
          }
        }
      } else {
        // Missing sheet ID — create reconciliation record
        qualityIssues.push(`Page ${page.page_number}: missing sheet_id`);
        await supabase.from("reconciliation_records").insert({
          user_id: userId,
          project_id,
          issue_type: "MISSING_SHEET_ID",
          notes: `Page ${page.page_number}: no sheet ID detected in title block`,
          candidates: { page_number: page.page_number, raw_text_snippet: rawText.slice(0, 200) },
          automated_reasoning: {
            source: "populate-search-index",
            action: "flagged_missing_sheet_id",
            extraction_version: EXTRACTION_VERSION,
          },
        });
      }

      // Compute quality flags and confidence
      const qualityFlags = computeQualityFlags({
        raw_text: rawText,
        title_block: tb,
        bar_marks: barMarks,
        sheet_id: sheetId,
        is_ocr: is_ocr || page.is_ocr,
      });
      const confidence = computeConfidence(qualityFlags);
      const needsReview = qualityFlags.length > 0 && confidence < 0.7;

      // Insert via RPC
      const { error } = await supabase.rpc("upsert_search_index", {
        p_user_id: userId,
        p_project_id: project_id,
        p_logical_drawing_id: logicalDrawingId,
        p_document_version_id: document_version_id || null,
        p_page_number: page.page_number || null,
        p_raw_text: rawText,
        p_extracted_entities: {
          bar_marks: barMarks,
          tables: page.tables || [],
          title_block: tb,
        },
        p_bar_marks: barMarks,
        p_crm_deal_id: crm_deal_id || null,
        p_revision_label: tb.revision_code || null,
        p_issue_status: null,
      });

      if (error) {
        console.error(`Index page ${page.page_number} error:`, error);
      } else {
        // Update the new columns on the inserted row
        const { data: latest } = await supabase
          .from("drawing_search_index")
          .select("id")
          .eq("user_id", userId)
          .eq("project_id", project_id)
          .eq("page_number", page.page_number || 0)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (latest) {
          const updateFields: Record<string, unknown> = {
            confidence,
            quality_flags: qualityFlags,
            needs_review: needsReview,
            extraction_version: EXTRACTION_VERSION,
            source_system: source_system || "upload",
          };
          if (drawing_set_id) updateFields.drawing_set_id = drawing_set_id;
          if (doc_sha256) updateFields.sha256 = doc_sha256;
          if (pipeline_file_id) updateFields.pipeline_file_id = pipeline_file_id;

          await supabase
            .from("drawing_search_index")
            .update(updateFields)
            .eq("id", latest.id);
        }
        indexed++;
      }
    }

    return new Response(
      JSON.stringify({ indexed, skipped, total: pages.length, conflicts, quality_issues: qualityIssues }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("populate-search-index error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
