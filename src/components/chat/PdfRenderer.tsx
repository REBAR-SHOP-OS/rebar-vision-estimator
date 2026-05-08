import React, { useState, useEffect, useRef, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
// Self-host the worker via Vite ?url so it ships in our bundle
// (no external CDN fetch, works offline, no version drift).
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfRendererProps {
  url: string;
  currentPage: number;
  onPageCount: (count: number) => void;
  onPageRendered: (imageDataUrl: string, width: number, height: number) => void;
  onRenderStateChange?: (state: { status: "loading" | "ready" | "error"; error?: string | null }) => void;
  /** Optional: emit text items with image-pixel bboxes for the rendered page.
   *  Coordinates are in the same image-pixel space as the rendered raster
   *  returned by onPageRendered (pre-scale, top-left origin). */
  onPageText?: (items: Array<{ str: string; x: number; y: number; w: number; h: number }>) => void;
  scale?: number;
}

const PdfRenderer: React.FC<PdfRendererProps> = ({ url, currentPage, onPageCount, onPageRendered, onRenderStateChange, onPageText, scale = 2 }) => {
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load PDF document
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const loadPdf = async () => {
      try {
        const doc = await pdfjsLib.getDocument(url).promise;
        if (cancelled) return;
        pdfDocRef.current = doc;
        onPageCount(doc.numPages);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error("PDF load error:", err);
        setError("Failed to load PDF");
        setLoading(false);
      }
    };

    loadPdf();
    return () => { cancelled = true; };
  }, [url]);

  // Render current page
  useEffect(() => {
    if (!pdfDocRef.current || loading) return;
    let cancelled = false;
    onRenderStateChange?.({ status: "loading", error: null });

    const renderPage = async () => {
      try {
        const page = await pdfDocRef.current!.getPage(currentPage);
        if (cancelled) return;

        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d")!;

        await page.render({ canvasContext: ctx, viewport }).promise;
        if (cancelled) return;

        const dataUrl = canvas.toDataURL("image/png");
        onPageRendered(dataUrl, viewport.width / scale, viewport.height / scale);
        onRenderStateChange?.({ status: "ready", error: null });

        // Emit text items (positions in image-pixel space, pre-scale).
        if (onPageText) {
          try {
            const tc = await page.getTextContent();
            if (cancelled) return;
            // PDF text items: transform = [a,b,c,d,e,f]; position = (e, f)
            // in PDF user-space, origin BOTTOM-left. Convert via viewport, then
            // un-scale so coords match the dataUrl/imgSize space we report.
            const items: Array<{ str: string; x: number; y: number; w: number; h: number }> = [];
            for (const it of (tc.items as any[])) {
              const str = String(it.str || "");
              if (!str.trim()) continue;
              const tx = (pdfjsLib as any).Util.transform(viewport.transform, it.transform);
              const fontHeight = Math.hypot(tx[2], tx[3]);
              const widthPx = Number(it.width) * Math.hypot(tx[0], tx[1]) / Math.max(1e-6, Math.hypot(it.transform[0], it.transform[1]));
              const xCanvas = tx[4];
              const yCanvas = tx[5] - fontHeight; // top edge
              items.push({
                str,
                x: xCanvas / scale,
                y: yCanvas / scale,
                w: (widthPx || fontHeight * str.length * 0.5) / scale,
                h: fontHeight / scale,
              });
            }
            onPageText(items);
          } catch (e) {
            console.warn("PDF text extraction failed:", e);
            onPageText([]);
          }
        }
      } catch (err) {
        console.error("PDF render error:", err);
        onRenderStateChange?.({ status: "error", error: `Failed to render page ${currentPage}.` });
      }
    };

    renderPage();
    return () => { cancelled = true; };
  }, [currentPage, loading, scale, url]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-destructive text-sm">
        {error}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading PDF...
      </div>
    );
  }

  return null; // This component is headless - it renders via callbacks
};

export default PdfRenderer;
