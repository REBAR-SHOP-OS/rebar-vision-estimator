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
  imageWidth: number;
  imageHeight: number;
  renderScale: number;
  crop?: {
    kind: "title_block" | "callout_band" | "detail_band" | "left_marks";
    bbox: [number, number, number, number];
    sourcePageNumber: number;
  };
}

export type PdfCropKind = NonNullable<PdfPageImage["crop"]>["kind"];

export function chooseAdaptivePdfRenderScale(
  pageWidth: number,
  pageHeight: number,
  preferred?: number | "adaptive",
): number {
  if (typeof preferred === "number" && Number.isFinite(preferred) && preferred > 0) return preferred;
  let scale = pageWidth * pageHeight <= 850_000 ? 3.5 : pageWidth * pageHeight <= 1_500_000 ? 3 : 2.5;
  while (pageWidth * scale * pageHeight * scale > 18_000_000 && scale > 2.25) scale -= 0.25;
  return Math.max(2.25, Math.min(4, Number(scale.toFixed(2))));
}

export function getTargetCropRegions(width: number, height: number): Array<{ kind: PdfCropKind; bbox: [number, number, number, number] }> {
  return [
    { kind: "title_block", bbox: [width * 0.62, height * 0.72, width, height] },
    { kind: "callout_band", bbox: [width * 0.08, height * 0.18, width * 0.92, height * 0.58] },
    { kind: "detail_band", bbox: [0, height * 0.58, width, height] },
    { kind: "left_marks", bbox: [0, 0, width * 0.22, height] },
  ];
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
    scale?: number | "adaptive";
    targetCrops?: boolean;
    onProgress?: (current: number, total: number) => void;
  }
): Promise<PdfPageImage[]> {
  const maxPages = options?.maxPages ?? 10;
  const onProgress = options?.onProgress;

  console.log(`[pdf-to-images] Loading PDF from: ${pdfUrl.substring(0, 60)}...`);
  const doc = await pdfjsLib.getDocument(pdfUrl).promise;
  const totalPages = Math.min(doc.numPages, maxPages);
  console.log(`[pdf-to-images] PDF has ${doc.numPages} pages, rendering ${totalPages}`);

  // Refresh session to prevent JWT expiry during long rendering+upload loops
  const { data: { session }, error: refreshErr } = await supabase.auth.refreshSession();
  if (refreshErr || !session?.user) throw new Error("Not authenticated – cannot upload page images");
  const userId = session.user.id;

  const results: PdfPageImage[] = [];
  const timestamp = Date.now();

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    onProgress?.(pageNum, totalPages);
    console.log(`[pdf-to-images] Rendering page ${pageNum}/${totalPages}`);

    try {
      const page = await doc.getPage(pageNum);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = chooseAdaptivePdfRenderScale(baseViewport.width, baseViewport.height, options?.scale ?? "adaptive");
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

      // Upload to Storage
      const storagePath = `${userId}/${projectId}/pages/${timestamp}_page_${pageNum}.png`;
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
          width: baseViewport.width,
          height: baseViewport.height,
          imageWidth: viewport.width,
          imageHeight: viewport.height,
          renderScale: scale,
        });
      }

      if (options?.targetCrops) {
        for (const region of getTargetCropRegions(canvas.width, canvas.height)) {
          const [x1, y1, x2, y2] = region.bbox.map((v) => Math.round(v)) as [number, number, number, number];
          const cropW = Math.max(1, x2 - x1);
          const cropH = Math.max(1, y2 - y1);
          const cropCanvas = document.createElement("canvas");
          cropCanvas.width = cropW;
          cropCanvas.height = cropH;
          cropCanvas.getContext("2d")!.drawImage(canvas, x1, y1, cropW, cropH, 0, 0, cropW, cropH);
          const cropBlob = await new Promise<Blob>((resolve, reject) => {
            cropCanvas.toBlob(
              (b) => (b ? resolve(b) : reject(new Error("Crop canvas toBlob failed"))),
              "image/png",
              0.9
            );
          });
          cropCanvas.width = 0;
          cropCanvas.height = 0;
          const cropPath = `${userId}/${projectId}/pages/${timestamp}_page_${pageNum}_${region.kind}.png`;
          const { error: cropUploadError } = await supabase.storage
            .from("blueprints")
            .upload(cropPath, cropBlob, { contentType: "image/png", upsert: true });
          if (cropUploadError) {
            console.error(`[pdf-to-images] Crop upload failed for page ${pageNum} ${region.kind}:`, cropUploadError);
            continue;
          }
          const { data: cropSignedData } = await supabase.storage
            .from("blueprints")
            .createSignedUrl(cropPath, 3600);
          if (cropSignedData?.signedUrl) {
            results.push({
              pageNumber: pageNum,
              signedUrl: cropSignedData.signedUrl,
              storagePath: cropPath,
              width: baseViewport.width,
              height: baseViewport.height,
              imageWidth: cropW,
              imageHeight: cropH,
              renderScale: scale,
              crop: {
                kind: region.kind,
                bbox: [x1 / scale, y1 / scale, x2 / scale, y2 / scale],
                sourcePageNumber: pageNum,
              },
            });
          }
        }
      }

      // Free canvas memory immediately
      canvas.width = 0;
      canvas.height = 0;

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
