import React, { useState, useEffect, useRef, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";

// Set worker source
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

interface PdfRendererProps {
  url: string;
  currentPage: number;
  onPageCount: (count: number) => void;
  onPageRendered: (imageDataUrl: string, width: number, height: number) => void;
  scale?: number;
}

const PdfRenderer: React.FC<PdfRendererProps> = ({ url, currentPage, onPageCount, onPageRendered, scale = 2 }) => {
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
      } catch (err) {
        console.error("PDF render error:", err);
      }
    };

    renderPage();
    return () => { cancelled = true; };
  }, [currentPage, loading, scale]);

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
