import React, { useState, useEffect, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist";
// Self-host the worker via Vite ?url so it ships in our bundle
// (no external CDN fetch, works offline, no version drift).
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface LegacyRenderPayload {
  imageUrl: string;
  width: number;
  height: number;
  pageCount: number;
  textItems: Array<{ str: string; x: number; y: number; w: number; h: number }>;
}

interface PdfRendererProps {
  url?: string;
  currentPage?: number;
  onPageCount?: (count: number) => void;
  onPageRendered?: (imageDataUrl: string, width: number, height: number) => void;
  onRenderStateChange?: (state: { status: "loading" | "ready" | "error"; error?: string | null }) => void;
  /** Optional: emit text items with image-pixel bboxes for the rendered page.
   *  Coordinates are in the same image-pixel space as the rendered raster
   *  returned by onPageRendered (pre-scale, top-left origin). */
  onPageText?: (items: Array<{ str: string; x: number; y: number; w: number; h: number }>) => void;
  scale?: number;
  // Legacy QAStage props kept for backward compatibility.
  file?: string;
  page?: number;
  onRender?: (payload: LegacyRenderPayload) => void;
  onError?: (message: string) => void;
}

const PdfRenderer: React.FC<PdfRendererProps> = ({
  url,
  currentPage,
  onPageCount,
  onPageRendered,
  onRenderStateChange,
  onPageText,
  scale = 2,
  file,
  page,
  onRender,
  onError,
}) => {
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const resolvedUrl = url || file || "";
  const resolvedPage = currentPage ?? page ?? 1;

  // Load PDF document
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    pdfDocRef.current = null;

    const emitLoadError = (message: string) => {
      setError(message);
      setLoading(false);
      onRenderStateChange?.({ status: "error", error: message });
      onError?.(message);
    };

    const loadPdf = async () => {
      if (!resolvedUrl) {
        if (cancelled) return;
        emitLoadError("Failed to load PDF");
        return;
      }

      try {
        const response = await fetch(resolvedUrl, { method: "GET" });
        if (cancelled) return;
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const buffer = await response.arrayBuffer();
        if (cancelled) return;
        const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
        if (cancelled) return;
        pdfDocRef.current = doc;
        onPageCount?.(doc.numPages);
        setLoading(false);
      } catch (fetchErr) {
        if (cancelled) return;
        console.warn("PDF binary fetch failed, falling back to direct pdfjs URL load:", fetchErr);
        try {
          const doc = await pdfjsLib.getDocument(resolvedUrl).promise;
          if (cancelled) return;
          pdfDocRef.current = doc;
          onPageCount?.(doc.numPages);
          setLoading(false);
        } catch (err) {
          if (cancelled) return;
          console.error("PDF load error:", err);
          emitLoadError("Failed to load PDF");
        }
      }
    };

    loadPdf();
    return () => { cancelled = true; };
  }, [resolvedUrl, onError, onPageCount, onRenderStateChange]);

  // Render current page
  useEffect(() => {
    if (!pdfDocRef.current || loading) return;
    let cancelled = false;
    onRenderStateChange?.({ status: "loading", error: null });

    const renderPage = async () => {
      try {
        const pageDoc = await pdfDocRef.current!.getPage(resolvedPage);
        if (cancelled) return;

        const viewport = pageDoc.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d")!;

        await pageDoc.render({ canvasContext: ctx, viewport }).promise;
        if (cancelled) return;

        const dataUrl = canvas.toDataURL("image/png");

        // Extract text items before emitting the legacy onRender callback so
        // QAStage receives the full payload shape it expects.
        let textItems: Array<{ str: string; x: number; y: number; w: number; h: number }> = [];
        if (onPageText || onRender) {
          try {
            const tc = await pageDoc.getTextContent();
            if (cancelled) return;
            textItems = [];
            for (const it of (tc.items as any[])) {
              const str = String(it.str || "");
              if (!str.trim()) continue;
              const tx = (pdfjsLib as any).Util.transform(viewport.transform, it.transform);
              const fontHeight = Math.hypot(tx[2], tx[3]);
              const widthPx = Number(it.width) * Math.hypot(tx[0], tx[1]) / Math.max(1e-6, Math.hypot(it.transform[0], it.transform[1]));
              const xCanvas = tx[4];
              const yCanvas = tx[5] - fontHeight;
              textItems.push({
                str,
                x: xCanvas / scale,
                y: yCanvas / scale,
                w: (widthPx || fontHeight * str.length * 0.5) / scale,
                h: fontHeight / scale,
              });
            }
            onPageText?.(textItems);
          } catch (e) {
            console.warn("PDF text extraction failed:", e);
            textItems = [];
            onPageText?.([]);
          }
        }

        onPageRendered?.(dataUrl, viewport.width / scale, viewport.height / scale);
        onRender?.({
          imageUrl: dataUrl,
          width: viewport.width / scale,
          height: viewport.height / scale,
          pageCount: pdfDocRef.current?.numPages || 1,
          textItems,
        });
        onRenderStateChange?.({ status: "ready", error: null });
      } catch (err) {
        console.error("PDF render error:", err);
        const message = `Failed to render page ${resolvedPage}.`;
        onRenderStateChange?.({ status: "error", error: message });
        onError?.(message);
      }
    };

    renderPage();
    return () => { cancelled = true; };
  }, [resolvedPage, loading, scale, resolvedUrl, onError, onPageRendered, onPageText, onRender, onRenderStateChange]);

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
