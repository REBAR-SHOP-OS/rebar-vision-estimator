/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from "@/integrations/supabase/client";
import { renderPdfPagesToImages } from "@/lib/pdf-to-images";
import { auditIndexedPages } from "@/features/workflow-v2/accuracy-audit";
import { summarizeIndexingOutcome, type PopulateSearchIndexResponse } from "@/lib/indexing-pipeline";

export type ParseStatus = "pending" | "parsing" | "indexed" | "failed";

export interface ParseFileRef {
  id: string;
  legacy_file_id?: string | null;
  file_name: string;
  file_path: string;
}

export interface ParseFileResult {
  status: ParseStatus;
  pages_indexed: number;
  document_version_id: string | null;
  error?: string;
  skipped?: boolean;
  pages?: Array<{ page_number: number; raw_text?: string; title_block?: any; ocr_metadata?: any; is_ocr?: boolean }>;
}

/**
 * Idempotently parse + index a single uploaded file.
 * - Skips if document_versions.parse_status === 'indexed'
 * - Records parse_status transitions (parsing -> indexed | failed)
 * - Falls back to client-side render + OCR for scanned / large PDFs
 */
export async function parseAndIndexFile(
  projectId: string,
  file: ParseFileRef,
  onProgress?: (msg: string) => void,
  opts?: { force?: boolean }
): Promise<ParseFileResult> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { status: "failed", pages_indexed: 0, document_version_id: null, error: "Not authenticated" };

  const legacyFileId = file.legacy_file_id || file.id;
  const runStartedAt = new Date().toISOString();

  // 1. Locate or create document_versions row
  const { data: existingDv } = await supabase
    .from("document_versions")
    .select("id, parse_status, pdf_metadata")
    .eq("file_id", legacyFileId)
    .maybeSingle();

  let dvId: string | null = existingDv?.id || null;
  const currentStatus = (existingDv as any)?.parse_status as ParseStatus | undefined;
  const currentPdfMetadata = ((existingDv as any)?.pdf_metadata || {}) as Record<string, any>;

  if (!opts?.force && currentStatus === "indexed") {
    return { status: "indexed", pages_indexed: 0, document_version_id: dvId, skipped: true };
  }

  if (!dvId) {
    const { data: newDv } = await supabase.from("document_versions").insert({
      project_id: projectId,
      user_id: user.id,
      file_id: legacyFileId,
      file_name: file.file_name,
      file_path: file.file_path,
      sha256: `pending_${Date.now()}_${legacyFileId}`,
      source_system: "upload",
      parse_status: "parsing" as any,
      pdf_metadata: {
        indexing_diagnostics: {
          upload_received_at: runStartedAt,
          parse_started_at: runStartedAt,
          project_id: projectId,
          file_id: legacyFileId,
          source: "parseAndIndexFile",
          status: "parsing",
        },
      },
    } as any).select("id").single();
    dvId = newDv?.id || null;
  } else {
    await supabase.from("document_versions").update({
      parse_status: "parsing",
      parse_error: null,
      pdf_metadata: {
        ...currentPdfMetadata,
        indexing_diagnostics: {
          ...(currentPdfMetadata.indexing_diagnostics || {}),
          upload_received_at: currentPdfMetadata.indexing_diagnostics?.upload_received_at || runStartedAt,
          parse_started_at: runStartedAt,
          project_id: projectId,
          file_id: legacyFileId,
          document_version_id: dvId,
          source: "parseAndIndexFile",
          status: "parsing",
        },
      },
    } as any).eq("id", dvId);
  }

  try {
    const { data: urlData } = await supabase.storage
      .from("blueprints")
      .createSignedUrl(file.file_path, 3600);
    if (!urlData?.signedUrl) throw new Error("Could not create signed URL");

    onProgress?.(`Extracting ${file.file_name}`);
    const { data: extraction } = await supabase.functions.invoke("extract-pdf-text", {
      body: { pdf_url: urlData.signedUrl, project_id: projectId },
    });

    let pages: any[] = extraction?.pages || [];
    const sha256 = extraction?.sha256 || `file_${legacyFileId}`;
    const hasText = pages.some((p: any) => p.raw_text && p.raw_text.trim().length > 20);
    const totalPages = Number(extraction?.total_pages || pages.length || 0);
    const sparseTextPages = pages.filter((p: any) => String(p.raw_text || "").trim().length < 120).length;
    const needsRasterOcr = !hasText
      || (totalPages > pages.length)
      || (pages.length > 0 && sparseTextPages / pages.length > 0.25);

    if (needsRasterOcr) {
      onProgress?.(`High-DPI OCR render: ${file.file_name}`);
      const pageImages = await renderPdfPagesToImages(urlData.signedUrl, projectId, {
        maxPages: 50,
        scale: "adaptive",
        targetCrops: true,
        onProgress: (cur, total) => onProgress?.(`Rendering ${cur}/${total}: ${file.file_name}`),
      });
      pages = [];
      const fullPages = pageImages.filter((img) => !img.crop);
      const cropPages = pageImages.filter((img) => img.crop);
      for (let bi = 0; bi < fullPages.length; bi += 3) {
        const batch = fullPages.slice(bi, bi + 3);
        const results = await Promise.allSettled(batch.map(async (img) => {
          onProgress?.(`OCR page ${img.pageNumber}/${fullPages.length}: ${file.file_name}`);
          const fullText = await ocrBestText(img.signedUrl);
          const crops = cropPages.filter((crop) => crop.pageNumber === img.pageNumber);
          const cropPasses: Array<{ kind: string; text: string; text_length: number; bbox?: number[] }> = [];
          for (const crop of crops) {
            const cropText = await ocrBestText(crop.signedUrl);
            if (cropText.trim().length > 0) {
              cropPasses.push({
                kind: crop.crop?.kind || "crop",
                text: cropText,
                text_length: cropText.trim().length,
                bbox: crop.crop?.bbox,
              });
            }
          }
          const cropTextBlock = cropPasses
            .map((crop) => `\n[OCR CROP ${crop.kind.toUpperCase()}]\n${crop.text}`)
            .join("\n");
          return {
            page_number: img.pageNumber,
            raw_text: `${fullText}${cropTextBlock}`.trim(),
            is_ocr: true,
            ocr_metadata: {
              render_scale: img.renderScale,
              image_size: { w: img.imageWidth, h: img.imageHeight },
              source_page_size: { w: img.width, h: img.height },
              full_page_text_length: fullText.trim().length,
              crop_passes: cropPasses.map(({ kind, text_length, bbox }) => ({ kind, text_length, bbox })),
              reason: !hasText ? "no_text_layer" : totalPages > (extraction?.pages || []).length ? "server_page_limit_or_large_pdf" : "sparse_text",
            },
          };
        }));
        for (const r of results) {
          if (r.status === "fulfilled") pages.push(r.value);
        }
      }
    } else if (totalPages > pages.length) {
      pages = pages.map((page: any) => ({
        ...page,
        ocr_metadata: { ...(page.ocr_metadata || {}), skipped_reason: "server_page_limit" },
      }));
    }

    const extractionAudit = auditIndexedPages(
      pages.map((page: any) => ({
        page_number: page.page_number,
        raw_text: page.raw_text,
        title_block: page.title_block,
        is_scanned: page.is_ocr || page.is_scanned,
        ocr_metadata: page.ocr_metadata,
        extracted_entities: { title_block: page.title_block, bar_marks: [] },
      })),
      totalPages || pages.length,
    );

    let pagesIndexed = 0;
    let verifiedRows = 0;
    let indexResponse: PopulateSearchIndexResponse | null = null;
    if (pages.length > 0 && dvId) {
      onProgress?.(`Indexing ${file.file_name}`);
      const { data: indexed, error: indexErr } = await supabase.functions.invoke("populate-search-index", {
        body: {
          project_id: projectId,
          document_version_id: dvId,
          pages,
          file_name: file.file_name,
          sha256,
          pipeline_file_id: legacyFileId,
          is_ocr: needsRasterOcr,
        },
      });
      if (indexErr) throw indexErr;
      indexResponse = (indexed || null) as PopulateSearchIndexResponse | null;
      pagesIndexed = Number(indexResponse?.indexed ?? 0);

      const { count, error: rowCountErr } = await supabase
        .from("drawing_search_index")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .eq("document_version_id", dvId);
      if (rowCountErr) throw rowCountErr;
      verifiedRows = count || 0;

      const outcome = summarizeIndexingOutcome({
        requestedPages: pages.length,
        verifiedRows,
        response: indexResponse,
      });
      if (!outcome.ok) {
        throw new Error(outcome.error);
      }
    } else if (pages.length === 0) {
      throw new Error("Parsing produced zero pages to index.");
    }

    if (dvId) {
      await supabase.from("document_versions").update({
        parse_status: "indexed",
        parse_error: null,
        parsed_at: new Date().toISOString(),
        sha256,
        page_count: pages.length || null,
        is_scanned: needsRasterOcr || !hasText,
        pdf_metadata: {
          ...currentPdfMetadata,
          ...(extraction?.pdf_metadata || {}),
          extraction_audit: extractionAudit,
          ocr_strategy: needsRasterOcr ? "adaptive_high_dpi_with_target_crops" : "vector_text",
          total_pages_reported: totalPages || pages.length || null,
          pages_indexed: pages.length,
          indexing_diagnostics: {
            ...(currentPdfMetadata.indexing_diagnostics || {}),
            upload_received_at: currentPdfMetadata.indexing_diagnostics?.upload_received_at || runStartedAt,
            parse_started_at: runStartedAt,
            ocr_completed_at: new Date().toISOString(),
            project_id: projectId,
            file_id: legacyFileId,
            document_version_id: dvId,
            requested_pages: pages.length,
            indexed_rows_reported: pagesIndexed,
            indexed_rows_verified: verifiedRows,
            skipped_pages: Number(indexResponse?.skipped ?? 0),
            discipline_counts: indexResponse?.discipline_counts || {},
            conflicts: indexResponse?.conflicts || [],
            quality_issues: indexResponse?.quality_issues || [],
            failure_reason: null,
            status: "indexed",
          },
        },
      } as any).eq("id", dvId);
    }

    return {
      status: "indexed",
      pages_indexed: pagesIndexed,
      document_version_id: dvId,
      pages: pages.map((p: any) => ({
        page_number: p.page_number,
        raw_text: p.raw_text,
        title_block: p.title_block,
        ocr_metadata: p.ocr_metadata,
        is_ocr: p.is_ocr,
      })),
    };
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (dvId) {
      await supabase.from("document_versions").update({
        parse_status: "failed",
        parse_error: msg.slice(0, 500),
        pdf_metadata: {
          ...currentPdfMetadata,
          indexing_diagnostics: {
            ...(currentPdfMetadata.indexing_diagnostics || {}),
            upload_received_at: currentPdfMetadata.indexing_diagnostics?.upload_received_at || runStartedAt,
            parse_started_at: runStartedAt,
            project_id: projectId,
            file_id: legacyFileId,
            document_version_id: dvId,
            failure_reason: msg.slice(0, 500),
            status: "failed",
          },
        },
      } as any).eq("id", dvId);
    }
    return { status: "failed", pages_indexed: 0, document_version_id: dvId, error: msg };
  }
}

async function ocrBestText(imageUrl: string): Promise<string> {
  const { data: ocrData } = await supabase.functions.invoke("ocr-image", {
    body: { image_url: imageUrl },
  });
  return (ocrData?.ocr_results || [])
    .map((r: any) => r.fullText || "")
    .filter((t: string) => t.length > 0)
    .sort((a: string, b: string) => b.length - a.length)[0] || "";
}
