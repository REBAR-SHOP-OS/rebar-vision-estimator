import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import PdfRenderer from "@/components/chat/PdfRenderer";
import { colorForSegmentType, inferSegmentType } from "@/lib/segment-type";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Eye, EyeOff, Hand, Layers, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

/** A bucket / segment the canvas can paint a layer for. */
export interface CanvasLayer {
  id: string;             // segment.id (or synthetic id)
  name: string;           // bucket / segment name
  segment_type?: string;  // inferred or stored
  count?: number;         // optional aggregate (LF/qty/etc, free text)
  unit?: string;          // optional unit suffix
  color?: string | null;  // overrides palette
}

interface TakeoffCanvasProps {
  projectId: string;
  layers: CanvasLayer[];
  filePath?: string | null;     // first storage path; if absent we pick first project file
  fileName?: string | null;
  emptyHint?: string;
  className?: string;
}

type ManualPolygon = {
  id: string;
  segment_id: string | null;
  page_number: number;
  polygon: Array<[number, number]>; // normalised 0..1
  color_hint: string | null;
  source_file_id?: string | null;
};

type Tool = "pan" | "polygon" | "erase";

function isPdfPath(path: string | null | undefined): boolean {
  return !!path && path.toLowerCase().split("?")[0].endsWith(".pdf");
}

export default function TakeoffCanvas({ projectId, layers, filePath, fileName, emptyHint, className }: TakeoffCanvasProps) {
  const { user } = useAuth();
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [resolvedName, setResolvedName] = useState<string | null>(fileName || null);
  const [sourceFileId, setSourceFileId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [pdfImg, setPdfImg] = useState<string | null>(null);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);

  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [activeLayer, setActiveLayer] = useState<string | null>(layers[0]?.id || null);
  const [tool, setTool] = useState<Tool>("pan");
  const [draft, setDraft] = useState<Array<[number, number]>>([]);
  const [polygons, setPolygons] = useState<ManualPolygon[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const imageBoxRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState<{ w: number; h: number } | null>(null);

  // Resolve project file id + signed URL.
  // Track stage size for fitted image box.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const r = e.contentRect;
        setStageSize({ w: r.width, h: r.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fittedBox = useMemo(() => {
    if (!imgSize || !stageSize) return null;
    const padding = 16; // matches p-2 on stage (~8px each side)
    const availW = Math.max(0, stageSize.w - padding);
    const availH = Math.max(0, stageSize.h - padding);
    const ar = imgSize.w / imgSize.h;
    let w = availW;
    let h = w / ar;
    if (h > availH) {
      h = availH;
      w = h * ar;
    }
    return { w, h };
  }, [imgSize, stageSize]);

  // Resolve project file id + signed URL.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let path = filePath || null;
      let name = fileName || null;
      let id: string | null = null;
      if (!path) {
        const { data } = await supabase
          .from("project_files")
          .select("id,file_path,file_name")
          .eq("project_id", projectId)
          .order("created_at", { ascending: true })
          .limit(1);
        const row = data?.[0];
        id = row?.id || null;
        path = row?.file_path || null;
        name = row?.file_name || null;
      } else {
        const { data } = await supabase
          .from("project_files")
          .select("id")
          .eq("project_id", projectId)
          .eq("file_path", path)
          .limit(1);
        id = data?.[0]?.id || null;
      }
      if (!path) return;
      const { data: signed } = await supabase.storage.from("blueprints").createSignedUrl(path, 60 * 60);
      if (cancelled) return;
      setSignedUrl(signed?.signedUrl || null);
      setResolvedName(name);
      setSourceFileId(id);
      setPage(1);
      setPdfImg(null);
      setImgSize(null);
    })();
    return () => { cancelled = true; };
  }, [projectId, filePath, fileName]);

  // Load saved polygons for this project / file / page
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let q = supabase
        .from("takeoff_overlays" as never)
        .select("id,segment_id,page_number,polygon,color_hint,source_file_id")
        .eq("project_id", projectId)
        .eq("page_number", page);
      if (sourceFileId) q = q.eq("source_file_id", sourceFileId);
      const { data, error } = await q;
      if (cancelled) return;
      if (error) {
        console.warn("Failed to load takeoff_overlays:", error.message);
        return;
      }
      const rows = (data as unknown as ManualPolygon[]) || [];
      setPolygons(rows.map((r) => ({ ...r, polygon: Array.isArray(r.polygon) ? r.polygon : [] })));
    })();
    return () => { cancelled = true; };
  }, [projectId, page, sourceFileId]);

  const isPdf = isPdfPath(signedUrl);

  const visibleLayers = useMemo(() => layers.filter((l) => !hidden.has(l.id)), [layers, hidden]);

  const layerColor = useCallback((l: CanvasLayer) => l.color || colorForSegmentType(l.segment_type), []);

  const toggleLayer = (id: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const onStageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (tool !== "polygon" || !imageBoxRef.current || !activeLayer) return;
    const rect = imageBoxRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    setDraft((d) => [...d, [x, y]]);
  };

  const finishDraft = useCallback(async () => {
    if (!user || !activeLayer || draft.length < 3) {
      setDraft([]);
      return;
    }
    const layer = layers.find((l) => l.id === activeLayer);
    const color = layer ? layerColor(layer) : null;
    const segId = activeLayer.startsWith("synthetic-") ? null : activeLayer;
    const { data, error } = await supabase
      .from("takeoff_overlays" as never)
      .insert({
        user_id: user.id,
        project_id: projectId,
        segment_id: segId,
        page_number: page,
        polygon: draft,
        color_hint: color,
        source_file_id: sourceFileId,
      } as never)
      .select("id,segment_id,page_number,polygon,color_hint,source_file_id")
      .single();
    if (error) {
      toast.error(`Could not save polygon: ${error.message}`);
      return;
    }
    setPolygons((prev) => [...prev, data as unknown as ManualPolygon]);
    setDraft([]);
    setTool("pan");
  }, [user, activeLayer, draft, layers, layerColor, projectId, page, sourceFileId]);

  const erasePolygon = async (id: string) => {
    const { error } = await supabase.from("takeoff_overlays" as never).delete().eq("id", id);
    if (error) {
      toast.error(`Could not delete polygon: ${error.message}`);
      return;
    }
    setPolygons((prev) => prev.filter((p) => p.id !== id));
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDraft([]);
      if (e.key === "Enter" && draft.length >= 3) finishDraft();
      if (e.key === "v" || e.key === "V") setTool("pan");
      if (e.key === "p" || e.key === "P") setTool("polygon");
      if (e.key === "e" || e.key === "E") setTool("erase");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft, finishDraft]);

  const polysByLayer = useMemo(() => {
    const m = new Map<string, ManualPolygon[]>();
    polygons.forEach((p) => {
      const key = p.segment_id || "_unassigned";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(p);
    });
    return m;
  }, [polygons]);

  const totalPolyCount = polygons.length;

  return (
    <div className={`flex h-full min-h-0 ${className || ""}`}>
      {/* Stage */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="relative flex-1 min-h-0 overflow-hidden bg-sidebar">
          {/* PDF headless renderer */}
          {isPdf && signedUrl && (
            <PdfRenderer
              file={signedUrl}
              page={page}
              onRender={({ imageUrl, width, height, pageCount: pc, pageNumber }) => {
                setPdfImg(imageUrl);
                setImgSize({ w: width, h: height });
                setPageCount(pc || 1);
                if (pageNumber && pageNumber !== page) setPage(pageNumber);
              }}
              onError={(m) => console.warn("Pdf render failed:", m)}
            />
          )}

          {/* Tool palette + page nav */}
          <div className="absolute left-3 top-3 z-10 flex flex-col gap-1 rounded border border-border bg-card/95 p-1 shadow backdrop-blur-sm">
            <ToolBtn title="Pan / Select (V)" active={tool === "pan"} onClick={() => setTool("pan")}><Hand className="h-4 w-4" /></ToolBtn>
            <ToolBtn title="Polygon (P)" active={tool === "polygon"} onClick={() => setTool("polygon")}><Pencil className="h-4 w-4" /></ToolBtn>
            <ToolBtn title="Erase (E)" active={tool === "erase"} onClick={() => setTool("erase")}><Trash2 className="h-4 w-4" /></ToolBtn>
            {isPdf && pageCount > 1 && (
              <div className="mt-1 flex flex-col items-center gap-0.5 border-t border-border pt-1">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} className="grid h-6 w-8 place-items-center rounded text-muted-foreground hover:bg-muted disabled:opacity-30" disabled={page <= 1}>
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span className="font-mono text-[9px] tabular-nums text-muted-foreground">{page}/{pageCount}</span>
                <button onClick={() => setPage((p) => Math.min(pageCount, p + 1))} className="grid h-6 w-8 place-items-center rounded text-muted-foreground hover:bg-muted disabled:opacity-30" disabled={page >= pageCount}>
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Active layer chip */}
          {tool === "polygon" && activeLayer && (
            <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2 inline-flex items-center gap-2 rounded border border-primary bg-card/95 px-2.5 py-1 text-[11px] shadow backdrop-blur-sm">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: layerColor(layers.find((l) => l.id === activeLayer)!) }} />
              <span className="font-medium text-foreground">{layers.find((l) => l.id === activeLayer)?.name}</span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {draft.length === 0 ? "click to add points · double-click to close" : `${draft.length} pts · ⏎ close · esc cancel`}
              </span>
            </div>
          )}

          {/* Stage */}
          <div
            ref={stageRef}
            className={`absolute inset-0 flex items-center justify-center p-2 ${tool === "polygon" ? "cursor-crosshair" : tool === "erase" ? "cursor-not-allowed" : "cursor-default"}`}
            onClick={onStageClick}
            onDoubleClick={() => { if (tool === "polygon") finishDraft(); }}
          >
            {(!signedUrl || (isPdf && !pdfImg)) ? (
              <div className="text-center text-xs text-muted-foreground">
                {signedUrl ? "Rendering sheet…" : (emptyHint || "Upload a drawing to enable the canvas.")}
              </div>
            ) : (
              <div
                ref={imageBoxRef}
                className="relative block max-h-full max-w-full"
                style={imgSize ? { aspectRatio: `${imgSize.w} / ${imgSize.h}`, width: "min(100%, calc((100% * 1) * 1))", height: "auto", maxHeight: "100%" } : { width: "100%", height: "100%" }}
              >
                <img
                  src={(isPdf ? pdfImg : signedUrl) || undefined}
                  alt={resolvedName || "Sheet"}
                  draggable={false}
                  className="block h-full w-full select-none object-contain"
                  onLoad={(e) => {
                    const i = e.currentTarget;
                    if (i.naturalWidth && i.naturalHeight) {
                      setImgSize({ w: i.naturalWidth, h: i.naturalHeight });
                    }
                  }}
                />
                {imgSize && (
                  <svg
                    className="absolute inset-0 h-full w-full pointer-events-none"
                    viewBox={`0 0 1 1`}
                    preserveAspectRatio="none"
                  >
                    {/* Saved polygons grouped by layer */}
                    {visibleLayers.map((layer) => {
                      const polys = polysByLayer.get(layer.id) || [];
                      const color = layerColor(layer);
                      return polys.map((poly) => (
                        <polygon
                          key={poly.id}
                          points={poly.polygon.map((p) => p.join(",")).join(" ")}
                          fill={color}
                          fillOpacity={0.45}
                          stroke={color}
                          strokeWidth={0.006}
                          vectorEffect="non-scaling-stroke"
                          style={{ pointerEvents: tool === "erase" ? "auto" : "none", cursor: tool === "erase" ? "pointer" : "default" }}
                          onClick={(e) => { if (tool === "erase") { e.stopPropagation(); erasePolygon(poly.id); } }}
                        />
                      ));
                    })}
                    {/* Unassigned polygons (layer deleted etc.) */}
                    {(polysByLayer.get("_unassigned") || []).map((poly) => (
                      <polygon
                        key={poly.id}
                        points={poly.polygon.map((p) => p.join(",")).join(" ")}
                        fill={poly.color_hint || "hsl(0 0% 55%)"}
                        fillOpacity={0.30}
                        stroke={poly.color_hint || "hsl(0 0% 55%)"}
                        strokeWidth={0.005}
                        vectorEffect="non-scaling-stroke"
                        style={{ pointerEvents: tool === "erase" ? "auto" : "none" }}
                        onClick={(e) => { if (tool === "erase") { e.stopPropagation(); erasePolygon(poly.id); } }}
                      />
                    ))}
                    {/* In-progress draft */}
                    {draft.length > 0 && (
                      <>
                        {draft.length >= 3 && (
                          <polygon
                            points={draft.map((p) => p.join(",")).join(" ")}
                            fill={activeLayer ? (layerColor(layers.find((l) => l.id === activeLayer)!) || "hsl(220 70% 55%)") : "hsl(220 70% 55%)"}
                            fillOpacity={0.25}
                            stroke="currentColor"
                            strokeWidth={0.005}
                            vectorEffect="non-scaling-stroke"
                          />
                        )}
                        {draft.map((p, i) => (
                          <circle key={i} cx={p[0]} cy={p[1]} r={0.006} fill="hsl(0 0% 100%)" stroke="hsl(220 90% 50%)" strokeWidth={0.003} vectorEffect="non-scaling-stroke" />
                        ))}
                      </>
                    )}
                  </svg>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Layer panel — collapsible */}
      <aside className={`flex-shrink-0 border-l border-border bg-card flex flex-col transition-[width] duration-150 ${panelOpen ? "w-[240px]" : "w-[52px]"}`}>
        <div className="flex items-center gap-2 border-b border-border px-2 py-2">
          <button
            onClick={() => setPanelOpen((v) => !v)}
            className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            title={panelOpen ? "Collapse layers" : "Expand layers"}
          >
            {panelOpen ? <ChevronsRight className="h-3.5 w-3.5" /> : <ChevronsLeft className="h-3.5 w-3.5" />}
          </button>
          {panelOpen && (
            <>
              <Layers className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Layers</span>
              <span className="ml-auto rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{layers.length}</span>
            </>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
          {layers.length === 0 ? (
            panelOpen ? <div className="p-4 text-center text-xs text-muted-foreground">{emptyHint || "No layers yet."}</div> : null
          ) : layers.map((l) => {
            const color = layerColor(l);
            const isActive = activeLayer === l.id;
            const isHidden = hidden.has(l.id);
            const drawnHere = (polysByLayer.get(l.id) || []).length;
            if (!panelOpen) {
              return (
                <button
                  key={l.id}
                  onClick={() => { setActiveLayer(l.id); setTool("polygon"); }}
                  title={`${l.name} — ${drawnHere} drawn`}
                  className={`flex h-9 w-full items-center justify-center rounded border ${isActive ? "border-primary ring-1 ring-primary" : "border-transparent hover:bg-muted/50"}`}
                >
                  <span className="h-4 w-4 rounded-sm" style={{ backgroundColor: color, opacity: isHidden ? 0.3 : 1 }} />
                </button>
              );
            }
            return (
              <button
                key={l.id}
                onClick={() => { setActiveLayer(l.id); setTool("polygon"); }}
                className={`flex w-full items-center gap-2 rounded border px-2 py-2 text-left text-xs transition-colors ${isActive ? "border-primary bg-primary/15 ring-1 ring-primary" : "border-transparent hover:bg-muted/50"}`}
              >
                <span className="h-3 w-3 flex-shrink-0 rounded-sm" style={{ backgroundColor: color, opacity: isHidden ? 0.3 : 1 }} />
                <div className="min-w-0 flex-1">
                  <div className={`truncate font-medium ${isHidden ? "text-muted-foreground" : "text-foreground"}`}>{l.name}</div>
                  <div className="font-mono text-[10px] text-muted-foreground tabular-nums">
                    {drawnHere} drawn{l.count !== undefined ? ` · ${l.count}${l.unit ? ` ${l.unit}` : ""}` : ""}
                  </div>
                </div>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); toggleLayer(l.id); }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleLayer(l.id); } }}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  title={isHidden ? "Show layer" : "Hide layer"}
                >
                  {isHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </span>
              </button>
            );
          })}
        </div>
        {panelOpen && (
        <div className="border-t border-border px-3 py-1.5">
          <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            <span>Σ Total drawn</span>
            <span className="text-foreground tabular-nums">{totalPolyCount}</span>
          </div>
        </div>
        )}
      </aside>
    </div>
  );
}

function ToolBtn({ children, title, active, onClick }: { children: React.ReactNode; title: string; active: boolean; onClick: () => void }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`grid h-8 w-8 place-items-center rounded transition-colors ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
    >
      {children}
    </button>
  );
}

// Re-export type for convenience
export type { CanvasLayer as TakeoffCanvasLayer };