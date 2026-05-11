import React, { useState, useEffect, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist";
// Self-host the worker via Vite ?url so it ships in our bundle
// (no external CDN fetch, works offline, no version drift).
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    pdfWorkerUrl ||
    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
}

const PDF_LOAD_TIMEOUT_MS = 20_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

interface LegacyRenderPayload {
  imageUrl: string;
  width: number;
  height: number;
  pageCount: number;
  pageNumber: number;
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
  const [retryTick, setRetryTick] = useState(0);

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

      // Try direct URL load first (fast path for signed-URL PDFs); fall back to
      // fetch+ArrayBuffer if the worker can't open the URL directly. Both
      // attempts are wrapped in a timeout so the UI never hangs forever.
      try {
        const doc = await withTimeout(
          pdfjsLib.getDocument({ url: resolvedUrl }).promise,
          PDF_LOAD_TIMEOUT_MS,
          "PDF worker load",
        );
        if (cancelled) return;
        pdfDocRef.current = doc;
        onPageCount?.(doc.numPages);
        setLoading(false);
        return;
      } catch (urlErr) {
        if (cancelled) return;
        console.warn("PDF URL load failed, falling back to ArrayBuffer:", urlErr);
      }

      try {
        const response = await fetch(resolvedUrl, { method: "GET" });
        if (cancelled) return;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        if (cancelled) return;
        const doc = await withTimeout(
          pdfjsLib.getDocument({ data: buffer }).promise,
          PDF_LOAD_TIMEOUT_MS,
          "PDF worker load",
        );
        if (cancelled) return;
        pdfDocRef.current = doc;
        onPageCount?.(doc.numPages);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error("PDF load error:", err);
        const msg = err instanceof Error && /timed out/i.test(err.message)
          ? "PDF worker did not respond. Check your connection and retry."
          : "Failed to load PDF";
        emitLoadError(msg);
      }
    };

    loadPdf();
    return () => { cancelled = true; };
  }, [resolvedUrl, retryTick]);

  // Render current page
  useEffect(() => {
    if (!pdfDocRef.current || loading) return;
    let cancelled = false;
    onRenderStateChange?.({ status: "loading", error: null });

    const renderPage = async () => {
      try {
        const pageCount = pdfDocRef.current?.numPages || 1;
        const safePage = Math.min(Math.max(1, resolvedPage), pageCount);
        const pageDoc = await pdfDocRef.current!.getPage(safePage);
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
          pageCount,
          pageNumber: safePage,
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
  }, [resolvedPage, loading, scale, resolvedUrl]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-destructive text-sm">
        <span>{error}</span>
        <button
          type="button"
          onClick={() => { setError(null); setLoading(true); setRetryTick((n) => n + 1); }}
          className="px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider border border-destructive/50 hover:bg-destructive/10"
        >
          Retry
        </button>
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
