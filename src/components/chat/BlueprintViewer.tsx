import React, { useState, useRef, useCallback, useEffect } from "react";
import { ZoomIn, ZoomOut, Maximize2, X, ChevronLeft, ChevronRight, FileText, PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import DrawingOverlay, { ELEMENT_TYPE_COLORS, type OverlayElement, type ReviewStatus } from "./DrawingOverlay";
import PdfRenderer from "./PdfRenderer";
import FeaturesPanel from "./FeaturesPanel";
import { useIsMobile } from "@/hooks/use-mobile";

interface BlueprintViewerProps {
  imageUrl: string;
  elements: OverlayElement[];
  selectedElementId: string | null;
  onSelectElement: (id: string | null) => void;
  onClose: () => void;
  reviewStatuses?: Map<string, ReviewStatus>;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.25;

const isPdfUrl = (url: string) => {
  const path = url.toLowerCase().split("?")[0];
  return path.endsWith(".pdf");
};

const BlueprintViewer: React.FC<BlueprintViewerProps> = ({
  imageUrl,
  elements,
  selectedElementId,
  onSelectElement,
  onClose,
  reviewStatuses,
}) => {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [imageSize, setImageSize] = useState({ w: 0, h: 0 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [showPanel, setShowPanel] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const isMobile = useIsMobile();

  // PDF state
  const isPdf = isPdfUrl(imageUrl);
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(() => {
    const stored = sessionStorage.getItem("blueprint-viewer-initial-page");
    if (stored) { sessionStorage.removeItem("blueprint-viewer-initial-page"); return parseInt(stored, 10) || 1; }
    return 1;
  });
  const [pdfImageUrl, setPdfImageUrl] = useState<string | null>(null);

  // Visible type filter
  const allTypes = [...new Set(elements.map((e) => e.element_type))];
  const [visibleTypes, setVisibleTypes] = useState<Set<string>>(new Set(allTypes));
  const [showGuidance, setShowGuidance] = useState(true);

  useEffect(() => {
    setVisibleTypes(new Set([...new Set(elements.map((e) => e.element_type))]));
  }, [elements]);

  // Filter elements by current page for PDF
  const pageElements = isPdf
    ? elements.filter((el) => !el.page_number || el.page_number === currentPage)
    : elements;

  const handleImageLoad = useCallback(() => {
    if (imgRef.current) {
      setImageSize({ w: imgRef.current.naturalWidth, h: imgRef.current.naturalHeight });
      setImageLoaded(true);
      if (containerRef.current) {
        const cw = containerRef.current.clientWidth;
        const ch = containerRef.current.clientHeight - 52;
        const fitZoom = Math.min(cw / imgRef.current.naturalWidth, ch / imgRef.current.naturalHeight, 1);
        setZoom(fitZoom);
        setPan({ x: 0, y: 0 });
      }
    }
  }, []);

  const handlePdfPageRendered = useCallback((dataUrl: string, width: number, height: number) => {
    setPdfImageUrl(dataUrl);
    setImageSize({ w: width, h: height });
    setImageLoaded(true);
    if (containerRef.current) {
      const cw = containerRef.current.clientWidth;
      const ch = containerRef.current.clientHeight - 52;
      const fitZoom = Math.min(cw / width, ch / height, 1);
      setZoom(fitZoom);
      setPan({ x: 0, y: 0 });
    }
  }, []);

  const fitToScreen = useCallback(() => {
    if (imageSize.w && containerRef.current) {
      const cw = containerRef.current.clientWidth;
      const ch = containerRef.current.clientHeight - 52;
      const fitZoom = Math.min(cw / imageSize.w, ch / imageSize.h, 1);
      setZoom(fitZoom);
      setPan({ x: 0, y: 0 });
    }
  }, [imageSize]);

  // Navigate to element's page in PDF
  useEffect(() => {
    if (!selectedElementId || !isPdf) return;
    const el = elements.find((e) => e.element_id === selectedElementId);
    if (el?.page_number && el.page_number !== currentPage) {
      setCurrentPage(el.page_number);
    }
  }, [selectedElementId, elements, isPdf]);

  // Zoom to selected element
  useEffect(() => {
    if (!selectedElementId || !containerRef.current || !imageSize.w) return;
    const el = pageElements.find((e) => e.element_id === selectedElementId);
    if (!el || (el.bbox[2] <= el.bbox[0] && el.bbox[3] <= el.bbox[1])) return;

    const cx = (el.bbox[0] + el.bbox[2]) / 2;
    const cy = (el.bbox[1] + el.bbox[3]) / 2;
    const containerW = containerRef.current.clientWidth;
    const containerH = containerRef.current.clientHeight - 52;

    const targetZoom = Math.min(2, Math.max(1, containerW / (el.bbox[2] - el.bbox[0]) * 0.5));
    setZoom(targetZoom);
    setPan({
      x: containerW / 2 - cx * targetZoom,
      y: containerH / 2 - cy * targetZoom,
    });
  }, [selectedElementId, pageElements, imageSize]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z + delta)));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsPanning(true);
    setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
  }, [isPanning, panStart]);

  const handleMouseUp = useCallback(() => setIsPanning(false), []);

  const toggleType = (type: string) => {
    setVisibleTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const hoveredElement = elements.find((e) => e.element_id === hoveredId);
  const hasOverlays = pageElements.some(el => (el.bbox[2] - el.bbox[0]) > 10 && (el.bbox[3] - el.bbox[1]) > 10);
  const displayImageUrl = isPdf ? pdfImageUrl : imageUrl;
  const showFeaturesPanel = showPanel && !isMobile && elements.length > 0;

  return (
    <div className="flex flex-col h-full bg-card border border-border rounded-xl overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-3 py-2 bg-card border-b border-border flex-shrink-0 flex-wrap">
        <TooltipProvider delayDuration={200}>
          {/* Toggle Features Panel */}
          {!isMobile && elements.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={showPanel ? "secondary" : "ghost"}
                  size="icon"
                  className="h-7 w-7 rounded-lg"
                  onClick={() => setShowPanel((p) => !p)}
                >
                  <PanelLeft className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Features Panel</TooltipContent>
            </Tooltip>
          )}

          <div className="h-4 w-px bg-border mx-0.5" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg" onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))}>
                <ZoomIn className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Zoom In</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg" onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))}>
                <ZoomOut className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Zoom Out</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg" onClick={fitToScreen}>
                <Maximize2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Fit to Screen</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <span className="text-[10px] text-muted-foreground font-medium ml-1 hidden sm:inline">{Math.round(zoom * 100)}%</span>

        {/* PDF Page Navigation */}
        {isPdf && pdfPageCount > 1 && (
          <>
            <div className="h-4 w-px bg-border mx-1" />
            <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage <= 1}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="text-[10px] text-muted-foreground font-medium">
              {currentPage} / {pdfPageCount}
            </span>
            <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg" onClick={() => setCurrentPage((p) => Math.min(pdfPageCount, p + 1))} disabled={currentPage >= pdfPageCount}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </>
        )}

        {/* Mobile-only type filter chips */}
        {isMobile && allTypes.length > 0 && (
          <>
            <div className="h-4 w-px bg-border mx-1" />
            <div className="flex gap-1 flex-wrap">
              {allTypes.map((type) => {
                const color = ELEMENT_TYPE_COLORS[type] || ELEMENT_TYPE_COLORS.OTHER;
                const visible = visibleTypes.has(type);
                const count = pageElements.filter((e) => e.element_type === type).length;
                return (
                  <button
                    key={type}
                    onClick={() => toggleType(type)}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold transition-all border ${
                      visible ? "border-transparent" : "border-border opacity-40"
                    }`}
                    style={{
                      backgroundColor: visible ? `${color}18` : "transparent",
                      color: visible ? color : undefined,
                    }}
                  >
                    <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: color, opacity: visible ? 1 : 0.3 }} />
                    {type} ({count})
                  </button>
                );
              })}
            </div>
          </>
        )}

        <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg ml-auto" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* PDF Renderer (headless) */}
      {isPdf && (
        <PdfRenderer
          url={imageUrl}
          currentPage={currentPage}
          onPageCount={setPdfPageCount}
          onPageRendered={handlePdfPageRendered}
        />
      )}

      {/* Main content: Features Panel + Canvas */}
      <div className="flex flex-1 overflow-hidden">
        {/* Features Side Panel */}
        {showFeaturesPanel && (
          <FeaturesPanel
            elements={pageElements}
            selectedElementId={selectedElementId}
            onSelectElement={onSelectElement}
            visibleTypes={visibleTypes}
            onToggleType={toggleType}
            onClose={() => setShowPanel(false)}
            reviewStatuses={reviewStatuses}
          />
        )}

        {/* Canvas area */}
        <div
          ref={containerRef}
          className="flex-1 relative overflow-hidden cursor-grab active:cursor-grabbing bg-muted/30"
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {displayImageUrl ? (
            <div
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: "0 0",
                transition: isPanning ? "none" : "transform 0.3s ease-out",
              }}
              className="absolute"
            >
              <div className="relative inline-block">
                <img
                  ref={imgRef}
                  src={displayImageUrl}
                  alt="Blueprint"
                  onLoad={!isPdf ? handleImageLoad : undefined}
                  className="block max-w-none"
                  style={{ imageRendering: zoom > 2 ? "pixelated" : "auto" }}
                  draggable={false}
                />
                {imageLoaded && pageElements.length > 0 && (
                  <DrawingOverlay
                    elements={pageElements}
                    selectedId={selectedElementId}
                    hoveredId={hoveredId}
                    visibleTypes={visibleTypes}
                    onSelect={onSelectElement}
                    onHover={setHoveredId}
                    imageWidth={imageSize.w}
                    imageHeight={imageSize.h}
                    reviewStatuses={reviewStatuses}
                  />
                )}
              </div>
            </div>
          ) : (
            !isPdf && (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                Loading...
              </div>
            )
          )}

          {/* Guidance banner */}
          {imageLoaded && showGuidance && pageElements.length > 0 && (
            <div className="absolute top-3 left-3 right-3 bg-primary/10 backdrop-blur-sm border border-primary/30 rounded-lg px-3 py-2 shadow-md flex items-center gap-2 z-10">
              <span className="text-[11px] text-foreground">💡 Colored boxes highlight detected elements. <strong>Click any box</strong> to select it, or use the Features panel to browse.</span>
              <button onClick={() => setShowGuidance(false)} className="ml-auto text-muted-foreground hover:text-foreground flex-shrink-0">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Approximate position notice */}
          {imageLoaded && pageElements.length > 0 && !pageElements.some(el => (el.bbox[2] - el.bbox[0]) > 50) && (
            <div className="absolute top-3 left-3 bg-popover/90 backdrop-blur-sm border border-border rounded-lg px-3 py-2 shadow-md flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">📍 Element positions are approximate — parsed from tabular data</span>
            </div>
          )}

          {/* Hover Tooltip */}
          {hoveredElement && (
            <div
              className="absolute z-50 pointer-events-none bg-popover border border-border rounded-xl px-3 py-2 shadow-lg"
              style={{ bottom: 16, left: 16 }}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="w-2.5 h-2.5 rounded-sm"
                  style={{ backgroundColor: ELEMENT_TYPE_COLORS[hoveredElement.element_type] || ELEMENT_TYPE_COLORS.OTHER }}
                />
                <span className="text-xs font-bold text-foreground">{hoveredElement.element_id}</span>
                <Badge variant="outline" className="text-[9px] rounded-md">{hoveredElement.element_type}</Badge>
              </div>
              <div className="flex gap-3 text-[10px] text-muted-foreground">
                <span>Status: <span className="font-semibold text-foreground">{hoveredElement.status}</span></span>
                {hoveredElement.confidence !== undefined && (
                  <span>Confidence: <span className="font-semibold text-foreground">{Math.round(hoveredElement.confidence * 100)}%</span></span>
                )}
                {hoveredElement.weight_lbs !== undefined && (
                  <span>Weight: <span className="font-semibold text-foreground">{hoveredElement.weight_lbs.toLocaleString()} lbs</span></span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BlueprintViewer;
