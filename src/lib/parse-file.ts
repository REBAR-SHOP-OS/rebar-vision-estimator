/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from "@/integrations/supabase/client";
import { renderPdfPagesToImages } from "@/lib/pdf-to-images";

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

  // 1. Locate or create document_versions row
  const { data: existingDv } = await supabase
    .from("document_versions")
    .select("id, parse_status")
    .eq("file_id", legacyFileId)
    .maybeSingle();

  let dvId: string | null = existingDv?.id || null;
  const currentStatus = (existingDv as any)?.parse_status as ParseStatus | undefined;

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
    } as any).select("id").single();
    dvId = newDv?.id || null;
  } else {
    await supabase.from("document_versions").update({ parse_status: "parsing", parse_error: null } as any).eq("id", dvId);
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

    if (!hasText) {
      onProgress?.(`Rendering ${file.file_name}`);
      const pageImages = await renderPdfPagesToImages(urlData.signedUrl, projectId, {
        maxPages: 50,
        scale: 1.5,
        onProgress: (cur, total) => onProgress?.(`Rendering ${cur}/${total}: ${file.file_name}`),
      });
      pages = [];
      for (let bi = 0; bi < pageImages.length; bi += 4) {
        const batch = pageImages.slice(bi, bi + 4);
        const results = await Promise.allSettled(batch.map(async (img) => {
          onProgress?.(`OCR ${img.pageNumber}/${pageImages.length}: ${file.file_name}`);
          const { data: ocrData } = await supabase.functions.invoke("ocr-image", {
            body: { image_url: img.signedUrl },
          });
          const fullText = (ocrData?.ocr_results || [])
            .map((r: any) => r.fullText || "")
            .filter((t: string) => t.length > 0)
            .sort((a: string, b: string) => b.length - a.length)[0] || "";
          return { page_number: img.pageNumber, raw_text: fullText };
        }));
        for (const r of results) {
          if (r.status === "fulfilled") pages.push(r.value);
        }
      }
    }

    let pagesIndexed = 0;
    if (pages.length > 0 && dvId) {
      onProgress?.(`Indexing ${file.file_name}`);
      const { data: indexed } = await supabase.functions.invoke("populate-search-index", {
        body: {
          project_id: projectId,
          document_version_id: dvId,
          pages,
          file_name: file.file_name,
          sha256,
          pipeline_file_id: legacyFileId,
        },
      });
      pagesIndexed = (indexed as any)?.indexed ?? pages.length;
    }

    if (dvId) {
      await supabase.from("document_versions").update({
        parse_status: "indexed",
        parse_error: null,
        parsed_at: new Date().toISOString(),
        sha256,
        page_count: pages.length || null,
        is_scanned: !hasText,
      } as any).eq("id", dvId);
    }

    return { status: "indexed", pages_indexed: pagesIndexed, document_version_id: dvId };
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (dvId) {
      await supabase.from("document_versions").update({
        parse_status: "failed",
        parse_error: msg.slice(0, 500),
      } as any).eq("id", dvId);
    }
    return { status: "failed", pages_indexed: 0, document_version_id: dvId, error: msg };
  }
}