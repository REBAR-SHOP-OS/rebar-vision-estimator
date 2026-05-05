import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claims?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const userId = claims.claims.sub as string;

    const { project_id } = await req.json();
    if (!project_id) {
      return new Response(JSON.stringify({ error: "project_id required" }), { status: 400, headers: corsHeaders });
    }

    const log = async (action: string, details: Record<string, unknown> = {}) => {
      await supabase.from("audit_log").insert({ user_id: userId, project_id, action, details });
    };

    const { data: job } = await supabase.from("processing_jobs").insert({
      project_id,
      user_id: userId,
      job_type: "full_pipeline",
      status: "processing",
      started_at: new Date().toISOString(),
    }).select("id").single();

    const jobId = job?.id;

    const updateJob = async (status: string, progress: number, result?: Record<string, unknown>, error_message?: string) => {
      const update: Record<string, unknown> = { status, progress };
      if (result) update.result = result;
      if (error_message) update.error_message = error_message;
      if (status === "completed" || status === "failed") update.completed_at = new Date().toISOString();
      if (jobId) await supabase.from("processing_jobs").update(update).eq("id", jobId);
    };

    try {
      const { data: files } = await supabase
        .from("project_files")
        .select("id, file_name, file_path, file_type")
        .eq("project_id", project_id);

      const allFiles = files || [];

      const { data: registryRows } = await (supabase as any)
        .from("document_registry")
        .select("file_id, is_active")
        .eq("project_id", project_id);

      const explicitActiveFileIds = ((registryRows || []) as Array<{ file_id: string | null; is_active: boolean | null }>)
        .filter((row) => row.file_id && row.is_active !== false)
        .map((row) => row.file_id as string);

      const activeFileIds = explicitActiveFileIds.length > 0
        ? explicitActiveFileIds
        : allFiles.map((file) => file.id);

      const activeFileIdSet = new Set(activeFileIds);
      const activeFiles = allFiles.filter((file) => activeFileIdSet.has(file.id));

      if (activeFiles.length === 0) {
        await supabase.from("projects").update({ linkage_score: "L0", workflow_status: "intake" }).eq("id", project_id);
        await updateJob("completed", 100, { linkage_score: "L0", reason: "no_active_files", total_file_count: allFiles.length });
        await log("pipeline_complete", { linkage_score: "L0", reason: "no_active_files", total_file_count: allFiles.length });
        return new Response(JSON.stringify({
          linkage_score: "L0",
          workflow_status: "intake",
          message: "No active files found. Upload drawings to start processing.",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      await supabase.from("projects").update({ linkage_score: "L1", workflow_status: "files_uploaded" }).eq("id", project_id);
      await updateJob("processing", 20);
      await log("pipeline_files_found", {
        active_file_count: activeFiles.length,
        total_file_count: allFiles.length,
      });

      const { data: documentVersions } = await supabase
        .from("document_versions")
        .select("id, file_id, page_count")
        .eq("project_id", project_id);

      const activeDocumentVersions = (documentVersions || []).filter((version) => version.file_id && activeFileIdSet.has(version.file_id));
      const parsedCount = activeDocumentVersions.filter((version) => version.page_count !== null).length;
      const activeDocumentVersionIds = activeDocumentVersions.map((version) => version.id);
      const hasParsedFiles = parsedCount > 0;

      if (hasParsedFiles) {
        await supabase.from("projects").update({ workflow_status: "parsing" }).eq("id", project_id);
        await updateJob("processing", 40);
        await log("pipeline_parsing_complete", { parsed_count: parsedCount, active_document_version_count: activeDocumentVersionIds.length });
      }

      let drawingCount = 0;
      if (activeDocumentVersionIds.length > 0) {
        const { data: drawingRows } = await supabase
          .from("drawing_search_index")
          .select("id, document_version_id")
          .eq("project_id", project_id)
          .in("document_version_id", activeDocumentVersionIds);
        drawingCount = drawingRows?.length || 0;
      }

      const hasDrawings = drawingCount > 0;

      if (hasDrawings) {
        await supabase.from("projects").update({ workflow_status: "drawings_indexed" }).eq("id", project_id);
        await updateJob("processing", 50);
        await log("pipeline_drawings_indexed", { drawing_count: drawingCount });
      }

      const { data: project } = await supabase
        .from("projects")
        .select("scope_items, project_type")
        .eq("id", project_id)
        .single();

      const hasScope = project?.scope_items && Array.isArray(project.scope_items) && project.scope_items.length > 0;

      if (hasScope && hasParsedFiles) {
        await supabase.from("projects").update({ linkage_score: "L2", workflow_status: "scope_detected" }).eq("id", project_id);
        await updateJob("processing", 70);
        await log("pipeline_scope_detected", { scope_items: project.scope_items, project_type: project.project_type });
      } else if (hasParsedFiles && hasDrawings) {
        await supabase.from("projects").update({ linkage_score: "L1", workflow_status: "drawings_indexed" }).eq("id", project_id);
      } else if (hasParsedFiles) {
        await supabase.from("projects").update({ linkage_score: "L1", workflow_status: "parsing" }).eq("id", project_id);
      }

      const { count: estimateCount } = await supabase
        .from("estimate_versions")
        .select("id", { count: "exact", head: true })
        .eq("project_id", project_id);

      const hasEstimates = (estimateCount || 0) > 0;

      if (hasEstimates && hasScope && hasParsedFiles) {
        await supabase.from("projects").update({ linkage_score: "L3", workflow_status: "estimated" }).eq("id", project_id);
        await log("pipeline_complete", { linkage_score: "L3" });
      }

      const hasFiles = activeFiles.length > 0;
      const finalScore = hasEstimates && hasScope && hasParsedFiles ? "L3"
        : hasScope && hasParsedFiles ? "L2"
        : hasParsedFiles ? "L1"
        : hasFiles ? "L1"
        : "L0";

      const finalStatus = finalScore === "L3" ? "estimated"
        : finalScore === "L2" ? "scope_detected"
        : hasDrawings ? "drawings_indexed"
        : hasParsedFiles ? "parsing"
        : hasFiles ? "files_uploaded"
        : "intake";

      await supabase.from("projects").update({
        linkage_score: finalScore,
        workflow_status: finalStatus,
        intake_complete: finalScore !== "L0",
      }).eq("id", project_id);

      await updateJob("completed", 100, {
        linkage_score: finalScore,
        workflow_status: finalStatus,
        file_count: activeFiles.length,
        total_file_count: allFiles.length,
        parsed_count: parsedCount,
        drawing_count: drawingCount,
        estimate_count: estimateCount || 0,
        has_scope: hasScope,
      });

      await log("pipeline_complete", {
        linkage_score: finalScore,
        workflow_status: finalStatus,
        active_file_count: activeFiles.length,
        total_file_count: allFiles.length,
      });

      return new Response(JSON.stringify({
        linkage_score: finalScore,
        workflow_status: finalStatus,
        file_count: activeFiles.length,
        total_file_count: allFiles.length,
        drawing_count: drawingCount,
        estimate_count: estimateCount || 0,
        has_scope: hasScope,
        job_id: jobId,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } catch (pipelineErr) {
      await updateJob("failed", 0, undefined, String(pipelineErr));
      await log("pipeline_failed", { error: String(pipelineErr) });
      throw pipelineErr;
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});