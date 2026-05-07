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
    /\b([A-Z]{1,2}\d{1,3})\b/g,
    /\bBM[- ]?(\d{1,5})\b/gi,
    /\b(\d{1,5}[A-Z])\b/g,
    /\b(#\d{1,3})\b/g,
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

function computeQualityFlags(page: {
  raw_text?: string;
  title_block?: Record<string, string>;
  bar_marks: string[];
  sheet_id: string | null;
  is_ocr?: boolean;
  ocr_metadata?: {
    render_scale?: number | null;
    crop_passes?: Array<{ kind?: string; text_length?: number | null }>;
  } | null;
}): string[] {
  const flags: string[] = [];
  if (page.is_ocr) flags.push("ocr_used");
  if (!page.sheet_id) flags.push("missing_sheet_id");
  if (!page.title_block?.scale) flags.push("missing_scale");
  if (page.bar_marks.length === 0) flags.push("no_bar_marks");
  if (!page.raw_text || page.raw_text.length < 50) flags.push("sparse_text");
  if (page.is_ocr && Number(page.ocr_metadata?.render_scale || 0) > 0 && Number(page.ocr_metadata?.render_scale || 0) < 2.25) {
    flags.push("low_dpi_ocr");
  }
  if (page.is_ocr && page.ocr_metadata && (!Array.isArray(page.ocr_metadata.crop_passes) || page.ocr_metadata.crop_passes.length === 0)) {
    flags.push("targeted_ocr_missing");
  }
  return flags;
}

function computeConfidence(flags: string[]): number {
  let score = 1.0;
  const penalties: Record<string, number> = {
    missing_sheet_id: 0.2,
    missing_scale: 0.1,
    no_bar_marks: 0.1,
    sparse_text: 0.2,
    ocr_used: 0.05,
    low_dpi_ocr: 0.2,
    targeted_ocr_missing: 0.1,
  };
  for (const f of flags) {
    score -= penalties[f] || 0;
  }
  return Math.max(0, Math.round(score * 100) / 100);
}

function parseScaleRatio(scaleRaw: string | null | undefined): number | null {
  const raw = String(scaleRaw || "").trim();
  const ratio = raw.match(/1\s*[:=]\s*(\d+(?:\.\d+)?)/i);
  if (ratio) return Number(ratio[1]);
  const metric = raw.match(/(\d+(?:\.\d+)?)\s*mm\s*=\s*(\d+(?:\.\d+)?)\s*m/i);
  if (metric) return (Number(metric[2]) * 1000) / Number(metric[1]);
  return null;
}

function mapSheetCategory(drawingType: string | null, rawText: string): string {
  const haystack = `${drawingType || ""} ${rawText.slice(0, 400)}`.toLowerCase();
  if (haystack.includes("foundation")) return "foundation_plan";
  if (haystack.includes("slab")) return "slab_plan";
  if (haystack.includes("wall section") || haystack.includes("wall sec")) return "wall_section";
  if (haystack.includes("grade beam")) return "grade_beam_detail";
  if (haystack.includes("schedule")) return "schedule";
  if (haystack.includes("notes") || haystack.includes("general note")) return "notes";
  if (haystack.trim().length > 0) return "general";
  return "unknown";
}

async function syncRebarDrawingPage(params: {
  supabase: any;
  rebarProjectFileId: string | null;
  pageNumber: number;
  rawText: string;
  titleBlock: Record<string, string>;
  discipline: string | null;
  drawingType: string | null;
  barMarks: string[];
  confidence: number;
  isOcr: boolean;
  ocrMetadata?: Record<string, unknown> | null;
}) {
  const {
    supabase,
    rebarProjectFileId,
    pageNumber,
    rawText,
    titleBlock,
    discipline,
    drawingType,
    barMarks,
    confidence,
    isOcr,
    ocrMetadata,
  } = params;

  if (!rebarProjectFileId) return;

  const sheetNumber = titleBlock.sheet_number || null;
  const sheetName = titleBlock.sheet_title || titleBlock.sheet_name || drawingType || null;
  const revisionLabel = titleBlock.revision_code || null;
  const scaleText = titleBlock.scale || null;
  const detectedCategory = mapSheetCategory(drawingType, rawText);

  const { data: drawingSheets, error: sheetError } = await supabase
    .schema("rebar")
    .from("drawing_sheets")
    .upsert(
      {
        project_file_id: rebarProjectFileId,
        page_number: pageNumber,
        sheet_number: sheetNumber,
        sheet_name: sheetName,
        detected_category: detectedCategory,
        discipline,
        revision_label: revisionLabel,
        scale_text: scaleText,
        scale_confidence: scaleText ? confidence : null,
        notes_found: /\bnote(s)?\b/i.test(rawText),
        ocr_text: rawText,
      },
      { onConflict: "project_file_id,page_number" },
    )
    .select("id")
    .limit(1);

  const drawingSheetId = drawingSheets?.[0]?.id;
  if (sheetError || !drawingSheetId) {
    console.error("Failed to sync rebar drawing sheet:", sheetError);
    return;
  }

  await supabase.schema("rebar").from("drawing_detections").delete().eq("drawing_sheet_id", drawingSheetId);

  const detections: Array<Record<string, unknown>> = [];
  const pushDetection = (detectionType: string, label: string, valueText: string | null, metadata: Record<string, unknown> = {}) => {
    if (!valueText) return;
    detections.push({
      drawing_sheet_id: drawingSheetId,
      detection_type: detectionType,
      label,
      value_text: valueText,
      confidence,
      metadata,
    });
  };

  pushDetection("title_block", "sheet_number", sheetNumber, { source: "title_block" });
  pushDetection("title_block", "sheet_name", sheetName, { source: "title_block" });
  pushDetection("title_block", "discipline", discipline, { source: "title_block" });
  pushDetection("title_block", "revision", revisionLabel, { source: "title_block" });
  pushDetection("title_block", "scale", scaleText, { source: "title_block" });
  pushDetection("drawing_type", "drawing_type", drawingType, { source: "title_block" });
  if (barMarks.length > 0) {
    detections.push({
      drawing_sheet_id: drawingSheetId,
      detection_type: "bar_marks",
      label: "bar_marks",
      value_text: barMarks.join(", "),
      confidence,
      metadata: { count: barMarks.length },
    });
  }
  detections.push({
    drawing_sheet_id: drawingSheetId,
    detection_type: "ocr",
    label: isOcr ? "ocr_page" : "text_page",
    value_text: rawText.slice(0, 1000),
    confidence,
    metadata: { extraction_version: EXTRACTION_VERSION, ocr_metadata: ocrMetadata || null },
  });

  if (detections.length > 0) {
    const { error: detectionError } = await supabase.schema("rebar").from("drawing_detections").insert(detections);
    if (detectionError) {
      console.error("Failed to sync rebar drawing detections:", detectionError);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

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
      legacy_file_id,
    } = body;

    if (!project_id || !pages || !Array.isArray(pages)) {
      return new Response(JSON.stringify({ error: "project_id and pages[] required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const bridgeLookupFileId = legacy_file_id || pipeline_file_id || null;

    let rebarProjectFileId: string | null = null;
    if (bridgeLookupFileId) {
      const { data: linkRow } = await supabase
        .from("rebar_project_file_links")
        .select("rebar_project_file_id")
        .eq("legacy_file_id", bridgeLookupFileId)
        .maybeSingle();
      rebarProjectFileId = linkRow?.rebar_project_file_id || null;
    }

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

      const barMarks = extractBarMarks(rawText);
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

          const newRevCode = tb.revision_code || null;
          if (newRevCode) {
            await supabase
              .from("logical_drawings")
              .update({ latest_revision_code: newRevCode })
              .eq("id", existing.id);
          }

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

      const qualityFlags = computeQualityFlags({
        raw_text: rawText,
        title_block: tb,
        bar_marks: barMarks,
        sheet_id: sheetId,
        is_ocr: is_ocr || page.is_ocr,
        ocr_metadata: page.ocr_metadata || null,
      });
      const confidence = computeConfidence(qualityFlags);
      const needsReview = qualityFlags.length > 0 && confidence < 0.7;

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
          ocr_metadata: page.ocr_metadata || null,
        },
        p_bar_marks: barMarks,
        p_crm_deal_id: crm_deal_id || null,
        p_revision_label: tb.revision_code || null,
        p_issue_status: null,
      });

      if (error) {
        console.error(`Index page ${page.page_number} error:`, error);
      } else {
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

        if (document_version_id) {
          const { data: sheetRows, error: sheetErr } = await supabase
            .from("document_sheets")
            .upsert(
              {
                project_id,
                user_id: userId,
                document_version_id,
                page_number: page.page_number || 1,
                sheet_number: sheetId,
                sheet_title: (tb as Record<string, string>).sheet_title || null,
                discipline,
                title_block_json: tb as Record<string, unknown>,
                scale_raw: (tb as Record<string, string>).scale || (tb as Record<string, string>).scale_raw || null,
                scale_ratio: parseScaleRatio((tb as Record<string, string>).scale || (tb as Record<string, string>).scale_raw || null),
                scale_confidence: ((tb as Record<string, string>).scale || (tb as Record<string, string>).scale_raw) ? confidence : null,
              },
              { onConflict: "document_version_id,page_number" },
            )
            .select("id")
            .limit(1);
          const sheetIdRow = sheetRows?.[0];
          if (!sheetErr && sheetIdRow?.id) {
            await supabase.from("extracted_entities").insert({
              project_id,
              user_id: userId,
              document_version_id,
              document_sheet_id: sheetIdRow.id,
              page_number: page.page_number || null,
              entity_type: "page_bar_mark_index",
              payload: {
                bar_marks: barMarks,
                quality_flags: qualityFlags,
                page_number: page.page_number,
                ocr_metadata: page.ocr_metadata || null,
              },
              extraction_method: is_ocr || page.is_ocr ? "ocr" : "vector_pdf",
              confidence,
              validation_status: needsReview ? "pending" : "ok",
              review_required: needsReview,
            });
          }
        }

        await syncRebarDrawingPage({
          supabase,
          rebarProjectFileId,
          pageNumber: page.page_number || 1,
          rawText,
          titleBlock: tb,
          discipline,
          drawingType,
          barMarks,
          confidence,
          isOcr: Boolean(is_ocr || page.is_ocr),
          ocrMetadata: page.ocr_metadata || null,
        });

        indexed++;
      }
    }

    if (rebarProjectFileId && doc_sha256) {
      await supabase
        .schema("rebar")
        .from("project_files")
        .update({ checksum_sha256: doc_sha256 })
        .eq("id", rebarProjectFileId);
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
