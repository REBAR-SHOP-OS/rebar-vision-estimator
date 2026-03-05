import * as pdfjsLib from "pdfjs-dist";
import { supabase } from "@/integrations/supabase/client";

// Ensure worker is set
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

export interface PdfPageImage {
  pageNumber: number;
  signedUrl: string;
  storagePath: string;
  width: number;
  height: number;
}

/**
 * Renders PDF pages to PNG images in the browser, uploads each to Storage,
 * and returns signed URLs. Sequential rendering to stay within browser memory.
 */
export async function renderPdfPagesToImages(
  pdfUrl: string,
  projectId: string,
  options?: {
    maxPages?: number;
    scale?: number;
    onProgress?: (current: number, total: number) => void;
  }
): Promise<PdfPageImage[]> {
  const maxPages = options?.maxPages ?? 10;
  const scale = options?.scale ?? 1.5;
  const onProgress = options?.onProgress;

  console.log(`[pdf-to-images] Loading PDF from: ${pdfUrl.substring(0, 60)}...`);
  const doc = await pdfjsLib.getDocument(pdfUrl).promise;
  const totalPages = Math.min(doc.numPages, maxPages);
  console.log(`[pdf-to-images] PDF has ${doc.numPages} pages, rendering ${totalPages}`);

  const results: PdfPageImage[] = [];
  const timestamp = Date.now();

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    onProgress?.(pageNum, totalPages);
    console.log(`[pdf-to-images] Rendering page ${pageNum}/${totalPages}`);

    try {
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale });

      // Create canvas, render, convert to blob
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d")!;

      await page.render({ canvasContext: ctx, viewport }).promise;

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Canvas toBlob failed"))),
          "image/png",
          0.85
        );
      });

      // Free canvas memory immediately
      canvas.width = 0;
      canvas.height = 0;

      // Upload to Storage
      const storagePath = `${projectId}/pages/${timestamp}_page_${pageNum}.png`;
      const { error: uploadError } = await supabase.storage
        .from("blueprints")
        .upload(storagePath, blob, {
          contentType: "image/png",
          upsert: true,
        });

      if (uploadError) {
        console.error(`[pdf-to-images] Upload failed for page ${pageNum}:`, uploadError);
        continue;
      }

      // Get signed URL
      const { data: signedData } = await supabase.storage
        .from("blueprints")
        .createSignedUrl(storagePath, 3600);

      if (signedData?.signedUrl) {
        results.push({
          pageNumber: pageNum,
          signedUrl: signedData.signedUrl,
          storagePath,
          width: viewport.width / scale,
          height: viewport.height / scale,
        });
      }

      // Clean up page
      page.cleanup();
    } catch (err) {
      console.error(`[pdf-to-images] Page ${pageNum} failed:`, err);
    }
  }

  doc.destroy();
  console.log(`[pdf-to-images] Done. ${results.length} page images uploaded.`);
  return results;
}
