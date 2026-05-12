import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import PdfRenderer from "@/components/chat/PdfRenderer";
import { colorForSegmentType, inferSegmentType } from "@/lib/segment-type";
import { detectRegions, hueDistance, parseHslHue, type Region } from "@/lib/region-segmentation";
import { detectPageLabels, markBucket, type LabelHit } from "@/lib/ocr-page-labels";
import { createManualShapePolygon, type ManualShape } from "@/lib/takeoff-manual-shapes";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Circle, Eye, EyeOff, Hand, Layers, Maximize2, Minus, Pencil, Plus, Redo2, Sparkles, Square, Trash2, Undo2 } from "lucide-react";
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
  /**
   * Optional read-only selection callout. When set, the canvas jumps to
   * `pageNumber` and overlays a `SELECTION: <label>` tag (matches the
   * Stage 02 design reference). No DB writes; cosmetic only.
   */
  highlight?: { label: string; pageNumber?: number; color?: string } | null;
}

type ManualPolygon = {
  id: string;
  segment_id: string | null;
  page_number: number;
  polygon: Array<[number, number]>; // normalised 0..1
  color_hint: string | null;
  source_file_id?: string | null;
};

type Tool = "pan" | "polygon" | "square" | "circle" | "erase";

function isPdfPath(path: string | null | undefined): boolean {
  return !!path && path.toLowerCase().split("?")[0].endsWith(".pdf");
}

export default function TakeoffCanvas({ projectId, layers, filePath, fileName, emptyHint, className, highlight }: TakeoffCanvasProps) {
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
  // Undo / redo history of overlay edits in the current session.
  type HistoryOp =
    | { kind: "add"; id: string; snapshot: Omit<ManualPolygon, "id"> }
    | { kind: "erase"; snapshot: ManualPolygon };
  const [undoStack, setUndoStack] = useState<HistoryOp[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryOp[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [regions, setRegions] = useState<Region[]>([]);
  const regionCacheRef = useRef<Map<string, Region[]>>(new Map());
  // OCR-based label hits (rects in normalised 0..1 coords).
  const [labelHits, setLabelHits] = useState<LabelHit[]>([]);
  const [labelImg, setLabelImg] = useState<{ w: number; h: number } | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const ocrCacheRef = useRef<Map<string, { hits: LabelHit[]; w: number; h: number }>>(new Map());
  // Zoom + pan transform applied to the image-box wrapper.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const imageBoxRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState<{ w: number; h: number } | null>(null);
  const panDragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  // Tracks whether the user has manually zoomed/panned — when true we won't
  // auto-frame matched hits. Cleared on sheet/page/highlight change.
  const userZoomedRef = useRef(false);

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

  // Keep `activeLayer` in sync with the `layers` prop. Layers can arrive
  // async (or change as the user adds/removes segments); without this the
  // initial `useState(layers[0]?.id || null)` would leave activeLayer
  // permanently null and silently break Polygon/Square/Circle clicks.
  useEffect(() => {
    if (layers.length === 0) { setActiveLayer(null); return; }
    setActiveLayer((cur) => (cur && layers.some((l) => l.id === cur)) ? cur : layers[0].id);
  }, [layers]);

  // Auto-detect colored regions on the rendered page (Togal-style overlay).
  useEffect(() => {
    if (!pdfImg && !signedUrl) { setRegions([]); return; }
    const src = isPdf ? pdfImg : signedUrl;
    if (!src) { setRegions([]); return; }
    const cacheKey = `${src}::${page}`;
    const cached = regionCacheRef.current.get(cacheKey);
    if (cached) { setRegions(cached); return; }
    let alive = true;
    const run = () => {
      detectRegions(src, {
        maxDim: 1536,
        minAreaPct: 0.0008,
        minSat: 0.1,
        minVal: 0.2,
        maxVal: 0.99,
        hueBuckets: 16,
      })
        .then((r) => {
          if (!alive) return;
          regionCacheRef.current.set(cacheKey, r);
          setRegions(r);
        })
        .catch(() => { if (alive) setRegions([]); });
    };
    const ric: ((cb: () => void) => number) | undefined =
      (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    const handle = ric ? ric(run) : window.setTimeout(run, 0);
    return () => {
      alive = false;
      const cic: ((h: number) => void) | undefined =
        (window as unknown as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback;
      if (ric && cic) cic(handle as number); else window.clearTimeout(handle as number);
    };
  }, [pdfImg, signedUrl, isPdf, page]);

  // For each detected region, find the closest layer by hue (Δ < 25°).
  // Regions with no layer match render as neutral "other regions".
  const regionAssignments = useMemo(() => {
    return regions.map((r) => {
      let best: { layer: CanvasLayer; dist: number } | null = null;
      for (const l of visibleLayers) {
        const lh = parseHslHue(layerColor(l));
        if (lh < 0) continue;
        const d = hueDistance(r.hueDeg, lh);
        if (best == null || d < best.dist) best = { layer: l, dist: d };
      }
      const layer = best && best.dist < 25 ? best.layer : null;
      return { region: r, layer };
    });
  }, [regions, visibleLayers, layerColor]);

  const highlightLabelLc = highlight?.label?.trim().toLowerCase() || null;
  const hasMatchedSelection = useMemo(() => {
    if (!highlightLabelLc) return false;
    return regionAssignments.some(({ layer }) => layer && layer.name.trim().toLowerCase() === highlightLabelLc);
  }, [regionAssignments, highlightLabelLc]);

  useEffect(() => {
    if (layers.length === 0) {
      if (activeLayer !== null) setActiveLayer(null);
      return;
    }

    const activeExists = activeLayer ? layers.some((layer) => layer.id === activeLayer) : false;
    if (!activeExists) {
      setActiveLayer(layers[0].id);
    }
  }, [layers, activeLayer]);

  const toggleLayer = (id: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const saveOverlayPolygon = useCallback(async (points: Array<[number, number]>, switchToPan = false) => {
    if (!user || !activeLayer || points.length < 3) return false;
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
        polygon: points,
        color_hint: color,
        source_file_id: sourceFileId,
      } as never)
      .select("id,segment_id,page_number,polygon,color_hint,source_file_id")
      .single();
    if (error) {
      toast.error(`Could not save polygon: ${error.message}`);
      return false;
    }
    setPolygons((prev) => [...prev, data as unknown as ManualPolygon]);
    const inserted = data as unknown as ManualPolygon;
    setUndoStack((s) => [...s, { kind: "add", id: inserted.id, snapshot: {
      segment_id: inserted.segment_id,
      page_number: inserted.page_number,
      polygon: inserted.polygon,
      color_hint: inserted.color_hint,
      source_file_id: inserted.source_file_id ?? null,
    } }]);
    setRedoStack([]);
    if (switchToPan) setTool("pan");
    return true;
  }, [user, activeLayer, layers, layerColor, projectId, page, sourceFileId]);

  const onStageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!imageBoxRef.current) return;
    if (tool !== "pan" && tool !== "erase" && !activeLayer) {
      toast.info("Pick a layer in the right panel first.");
      return;
    }
    if (!activeLayer) return;
    const rect = imageBoxRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    if (tool === "polygon") {
      setDraft((d) => [...d, [x, y]]);
      return;
    }
    if (tool === "square" || tool === "circle") {
      const shape = tool as ManualShape;
      void saveOverlayPolygon(createManualShapePolygon(shape, x, y));
    }
  };

  const finishDraft = useCallback(async () => {
    if (!user || !activeLayer || draft.length < 3) {
      setDraft([]);
      return;
    }
    const ok = await saveOverlayPolygon(draft, true);
    if (ok) setDraft([]);
  }, [user, activeLayer, draft, saveOverlayPolygon]);

  const erasePolygon = async (id: string) => {
    const target = polygons.find((p) => p.id === id);
    const { error } = await supabase.from("takeoff_overlays" as never).delete().eq("id", id);
    if (error) {
      toast.error(`Could not delete polygon: ${error.message}`);
      return;
    }
    setPolygons((prev) => prev.filter((p) => p.id !== id));
    if (target) {
      setUndoStack((s) => [...s, { kind: "erase", snapshot: target }]);
      setRedoStack([]);
    }
  };

  // Re-insert a polygon snapshot (used by undo of erase / redo of add).
  const reinsertSnapshot = useCallback(async (snap: Omit<ManualPolygon, "id">): Promise<ManualPolygon | null> => {
    if (!user) return null;
    const { data, error } = await supabase
      .from("takeoff_overlays" as never)
      .insert({
        user_id: user.id,
        project_id: projectId,
        segment_id: snap.segment_id,
        page_number: snap.page_number,
        polygon: snap.polygon,
        color_hint: snap.color_hint,
        source_file_id: snap.source_file_id ?? null,
      } as never)
      .select("id,segment_id,page_number,polygon,color_hint,source_file_id")
      .single();
    if (error || !data) {
      toast.error(`Could not restore polygon: ${error?.message || "unknown error"}`);
      return null;
    }
    const row = data as unknown as ManualPolygon;
    setPolygons((prev) => [...prev, row]);
    return row;
  }, [user, projectId]);

  const deleteById = useCallback(async (id: string): Promise<boolean> => {
    const { error } = await supabase.from("takeoff_overlays" as never).delete().eq("id", id);
    if (error) {
      toast.error(`Could not undo: ${error.message}`);
      return false;
    }
    setPolygons((prev) => prev.filter((p) => p.id !== id));
    return true;
  }, []);

  const handleUndo = useCallback(async () => {
    if (undoStack.length === 0) return;
    const op = undoStack[undoStack.length - 1];
    if (op.kind === "add") {
      const ok = await deleteById(op.id);
      if (!ok) return;
      setUndoStack((s) => s.slice(0, -1));
      setRedoStack((s) => [...s, op]);
    } else {
      const row = await reinsertSnapshot({
        segment_id: op.snapshot.segment_id,
        page_number: op.snapshot.page_number,
        polygon: op.snapshot.polygon,
        color_hint: op.snapshot.color_hint,
        source_file_id: op.snapshot.source_file_id ?? null,
      });
      if (!row) return;
      setUndoStack((s) => s.slice(0, -1));
      setRedoStack((s) => [...s, { kind: "erase", snapshot: row }]);
    }
  }, [undoStack, deleteById, reinsertSnapshot]);

  const handleRedo = useCallback(async () => {
    if (redoStack.length === 0) return;
    const op = redoStack[redoStack.length - 1];
    if (op.kind === "add") {
      const row = await reinsertSnapshot(op.snapshot);
      if (!row) return;
      setRedoStack((s) => s.slice(0, -1));
      setUndoStack((s) => [...s, { kind: "add", id: row.id, snapshot: op.snapshot }]);
    } else {
      const ok = await deleteById(op.snapshot.id);
      if (!ok) return;
      setRedoStack((s) => s.slice(0, -1));
      setUndoStack((s) => [...s, op]);
    }
  }, [redoStack, deleteById, reinsertSnapshot]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || (target?.isContentEditable ?? false);
      if (!typing && (e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) void handleRedo();
        else void handleUndo();
        return;
      }
      if (!typing && (e.ctrlKey || e.metaKey) && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        void handleRedo();
        return;
      }
      if (e.key === "Escape") setDraft([]);
      if (e.key === "Enter" && draft.length >= 3) finishDraft();
      if (e.key === "v" || e.key === "V") setTool("pan");
      if (e.key === "p" || e.key === "P") setTool("polygon");
      if (e.key === "r" || e.key === "R") setTool("square");
      if (e.key === "c" || e.key === "C") setTool("circle");
      if (e.key === "e" || e.key === "E") setTool("erase");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft, finishDraft, handleUndo, handleRedo]);

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

  // Auto-jump to the page that contains the currently-selected candidate.
  useEffect(() => {
    const target = highlight?.pageNumber;
    if (!target || target < 1) return;
    if (target === page) return;
    if (pageCount > 1 && target > pageCount) return;
    setPage(target);
  }, [highlight?.pageNumber, pageCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset zoom / pan when sheet or page changes.
  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, [signedUrl, page]);

  const clampZoom = (z: number) => Math.min(6, Math.max(0.5, z));
  const zoomIn = () => setZoom((z) => clampZoom(z * 1.25));
  const zoomOut = () => setZoom((z) => clampZoom(z / 1.25));
  const zoomReset = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  const onWheel = (e: React.WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    setZoom((z) => clampZoom(z * factor));
    userZoomedRef.current = true;
  };

  // Pan drag — active whenever the Hand tool is selected.
  const onStageMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (tool !== "pan" || e.button !== 0) return;
    panDragRef.current = { startX: e.clientX, startY: e.clientY, baseX: pan.x, baseY: pan.y };
    setIsPanning(true);
    userZoomedRef.current = true;
  };
  const onStageMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const d = panDragRef.current;
    if (!d) return;
    setPan({ x: d.baseX + (e.clientX - d.startX), y: d.baseY + (e.clientY - d.startY) });
  };
  const endPan = () => { panDragRef.current = null; setIsPanning(false); };

  // OCR label detection (on-demand + auto on first selection).
  const sourceUrlForOcr = isPdf ? pdfImg : signedUrl;
  const ocrCacheKey = sourceUrlForOcr ? `${sourceUrlForOcr}::${page}` : null;

  const runOcr = useCallback(async () => {
    if (!ocrCacheKey || !signedUrl) return;
    const cached = ocrCacheRef.current.get(ocrCacheKey);
    if (cached) {
      setLabelHits(cached.hits);
      setLabelImg({ w: cached.w, h: cached.h });
      return;
    }
    // ocr-image requires a publicly fetchable URL. PDFs render to blob/data URLs
    // that Google Vision cannot fetch, so OCR is only available when the
    // underlying file is an image (PNG/JPG/etc.). For PDFs we silently no-op
    // here — users can still draw polygons manually.
    setOcrLoading(true);
    try {
      // For PDFs, the rendered page is a blob/data URL Vision can't fetch.
      // Upload it to Storage once per page so we get a fetchable signed URL.
      let urlForOcr = signedUrl;
      if (isPdf && pdfImg && user) {
        const blob = await (await fetch(pdfImg)).blob();
        const objectPath = `${user.id}/${projectId}/pages/${sourceFileId || "sheet"}-p${page}.png`;
        const up = await supabase.storage.from("blueprints").upload(objectPath, blob, {
          upsert: true,
          contentType: blob.type || "image/png",
        });
        if (up.error && !/already exists/i.test(up.error.message)) throw up.error;
        const { data: signed } = await supabase.storage.from("blueprints").createSignedUrl(objectPath, 60 * 60);
        if (!signed?.signedUrl) throw new Error("Could not sign rendered page URL");
        urlForOcr = signed.signedUrl;
      }
      const res = await detectPageLabels(urlForOcr!);
      ocrCacheRef.current.set(ocrCacheKey, { hits: res.hits, w: res.imageWidth, h: res.imageHeight });
      setLabelHits(res.hits);
      setLabelImg({ w: res.imageWidth, h: res.imageHeight });
      if (res.hits.length === 0) toast.info("No structural marks detected on this page.");
    } catch (e) {
      toast.error(`Label detection failed: ${(e as Error)?.message || e}`);
    } finally {
      setOcrLoading(false);
    }
  }, [ocrCacheKey, signedUrl, isPdf, pdfImg, user, projectId, sourceFileId, page]);

  // When the sheet or page changes, restore cached hits (or clear).
  useEffect(() => {
    if (!ocrCacheKey) { setLabelHits([]); setLabelImg(null); return; }
    const cached = ocrCacheRef.current.get(ocrCacheKey);
    if (cached) { setLabelHits(cached.hits); setLabelImg({ w: cached.w, h: cached.h }); }
    else { setLabelHits([]); setLabelImg(null); }
  }, [ocrCacheKey]);

  // Auto-run OCR when the user selects a candidate OR navigates to a new
  // page. Cached after first run per (sheet, page).
  useEffect(() => {
    if (!ocrCacheKey) return;
    if (ocrCacheRef.current.has(ocrCacheKey)) return;
    if (ocrLoading) return;
    if (!highlight?.label && !pdfImg && !signedUrl) return;
    runOcr();
  }, [highlight?.label, page, ocrCacheKey, runOcr, ocrLoading, pdfImg, signedUrl]);

  // Group label hits by the layer they belong to (via segment_type bucket).
  const hitsByLayer = useMemo(() => {
    const m = new Map<string, LabelHit[]>();
    if (!labelHits.length || !labelImg) return m;
    for (const h of labelHits) {
      const bucket = markBucket(h.text);
      if (!bucket) continue;
      const layer = visibleLayers.find((l) => (l.segment_type || inferSegmentType(l.name)).toLowerCase() === bucket);
      if (!layer) continue;
      const arr = m.get(layer.id) || [];
      arr.push(h);
      m.set(layer.id, arr);
    }
    return m;
  }, [labelHits, labelImg, visibleLayers]);

  const hasLabelSelection = useMemo(() => {
    if (!highlightLabelLc) return false;
    for (const layer of visibleLayers) {
      if (layer.name.trim().toLowerCase() === highlightLabelLc && (hitsByLayer.get(layer.id)?.length || 0) > 0) return true;
    }
    return false;
  }, [hitsByLayer, highlightLabelLc, visibleLayers]);

  // Resolve which layer the current highlight points at — by exact name or
  // by inferred segment_type bucket.
  const selectedLayerId = useMemo(() => {
    if (!highlight?.label) return null;
    const want = highlight.label.trim().toLowerCase();
    const exact = layers.find((l) => l.name.trim().toLowerCase() === want);
    if (exact) return exact.id;
    const bucket = inferSegmentType(highlight.label);
    const byBucket = layers.find((l) => (l.segment_type || inferSegmentType(l.name)) === bucket);
    return byBucket?.id || null;
  }, [layers, highlight?.label]);

  // Reset user-zoom flag whenever the selection or page changes — that's a
  // signal the user wants to see the new match framed.
  useEffect(() => { userZoomedRef.current = false; }, [highlight?.label, page, signedUrl]);

  // Auto-frame the matched hits for the selected layer.
  useEffect(() => {
    if (userZoomedRef.current) return;
    if (!selectedLayerId || !labelImg || !stageSize) return;
    const hits = hitsByLayer.get(selectedLayerId);
    if (!hits || hits.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const h of hits) {
      minX = Math.min(minX, h.rect[0] / labelImg.w);
      minY = Math.min(minY, h.rect[1] / labelImg.h);
      maxX = Math.max(maxX, h.rect[2] / labelImg.w);
      maxY = Math.max(maxY, h.rect[3] / labelImg.h);
    }
    // Add ~12% padding on each side.
    const padX = 0.12, padY = 0.12;
    minX = Math.max(0, minX - padX); minY = Math.max(0, minY - padY);
    maxX = Math.min(1, maxX + padX); maxY = Math.min(1, maxY + padY);
    const bw = Math.max(0.001, maxX - minX);
    const bh = Math.max(0.001, maxY - minY);
    const z = clampZoom(Math.min(1 / bw, 1 / bh));
    if (!fittedBox) { setZoom(z); return; }
    // Pan offset so bbox center lands at stage center.
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const dx = (0.5 - cx) * fittedBox.w * z;
    const dy = (0.5 - cy) * fittedBox.h * z;
    setZoom(z);
    setPan({ x: dx, y: dy });
  }, [selectedLayerId, hitsByLayer, labelImg, stageSize, fittedBox]);

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
            <ToolBtn title="Square stamp (R)" active={tool === "square"} onClick={() => setTool("square")}><Square className="h-4 w-4" /></ToolBtn>
            <ToolBtn title="Circle stamp (C)" active={tool === "circle"} onClick={() => setTool("circle")}><Circle className="h-4 w-4" /></ToolBtn>
            <ToolBtn title="Erase (E)" active={tool === "erase"} onClick={() => setTool("erase")}><Trash2 className="h-4 w-4" /></ToolBtn>
            <div className="mt-1 flex flex-col items-center gap-0.5 border-t border-border pt-1">
              <ToolBtn title="Undo (Ctrl+Z)" active={false} disabled={undoStack.length === 0} onClick={() => void handleUndo()}><Undo2 className="h-4 w-4" /></ToolBtn>
              <ToolBtn title="Redo (Ctrl+Shift+Z)" active={false} disabled={redoStack.length === 0} onClick={() => void handleRedo()}><Redo2 className="h-4 w-4" /></ToolBtn>
            </div>
            <div className="mt-1 flex flex-col items-center gap-0.5 border-t border-border pt-1">
              <ToolBtn title="Zoom in (Ctrl + wheel)" active={false} onClick={zoomIn}><Plus className="h-4 w-4" /></ToolBtn>
              <ToolBtn title="Zoom out" active={false} onClick={zoomOut}><Minus className="h-4 w-4" /></ToolBtn>
              <ToolBtn title={`Fit (current ${Math.round(zoom * 100)}%)`} active={zoom !== 1} onClick={zoomReset}><Maximize2 className="h-4 w-4" /></ToolBtn>
            </div>
            <div className="mt-1 flex flex-col items-center gap-0.5 border-t border-border pt-1">
              <ToolBtn title={ocrLoading ? "Detecting labels…" : "Auto-detect labels on this page"} active={labelHits.length > 0} onClick={runOcr}>
                <Sparkles className={`h-4 w-4 ${ocrLoading ? "animate-pulse" : ""}`} />
              </ToolBtn>
            </div>
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
          {(tool === "polygon" || tool === "square" || tool === "circle") && activeLayer && (
            <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2 inline-flex items-center gap-2 rounded border border-primary bg-card/95 px-2.5 py-1 text-[11px] shadow backdrop-blur-sm">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: layerColor(layers.find((l) => l.id === activeLayer)!) }} />
              <span className="font-medium text-foreground">{layers.find((l) => l.id === activeLayer)?.name}</span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {tool === "polygon"
                  ? (draft.length === 0 ? "click to add points · double-click to close" : `${draft.length} pts · ⏎ close · esc cancel`)
                  : `click to stamp ${tool} · esc cancel`}
              </span>
            </div>
          )}

          {/* Stage */}
          <div
            ref={stageRef}
            className={`absolute inset-0 flex items-center justify-center p-2 overflow-hidden ${tool === "polygon" || tool === "square" || tool === "circle" ? "cursor-crosshair" : tool === "erase" ? "cursor-not-allowed" : isPanning ? "cursor-grabbing" : "cursor-grab"}`}
            onClick={onStageClick}
            onDoubleClick={() => { if (tool === "polygon") finishDraft(); }}
            onWheel={onWheel}
            onMouseDown={onStageMouseDown}
            onMouseMove={onStageMouseMove}
            onMouseUp={endPan}
            onMouseLeave={endPan}
          >
            {(!signedUrl || (isPdf && !pdfImg)) ? (
              <div className="text-center text-xs text-muted-foreground">
                {signedUrl ? "Rendering sheet…" : (emptyHint || "Upload a drawing to enable the canvas.")}
              </div>
            ) : (
              <div
                ref={imageBoxRef}
                className="relative block"
                style={{
                  ...(fittedBox ? { width: `${fittedBox.w}px`, height: `${fittedBox.h}px` } : { width: "100%", height: "100%" }),
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transformOrigin: "center center",
                  transition: "transform 80ms ease-out",
                }}
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
                    {/* Auto-detected colored regions (Togal-style overlay) */}
                    {regionAssignments.map(({ region, layer }, i) => {
                      const fill = layer ? layerColor(layer) : region.color;
                      const layerLc = layer?.name.trim().toLowerCase();
                      const isSel = !!highlightLabelLc && layerLc === highlightLabelLc;
                      const isAssigned = !!layer;
                      const fillOpacity = isSel ? 0.55 : (isAssigned ? 0.22 : 0.10);
                      const strokeWidth = isSel ? 0.008 : 0.003;
                      return (
                        <polygon
                          key={`reg-${i}`}
                          points={region.polygon.map((p) => p.join(",")).join(" ")}
                          fill={fill}
                          fillOpacity={fillOpacity}
                          stroke={fill}
                          strokeWidth={strokeWidth}
                          vectorEffect="non-scaling-stroke"
                        />
                      );
                    })}
                    {/* OCR-detected mark rectangles, grouped by inferred layer */}
                    {labelImg && visibleLayers.map((layer) => {
                      const hits = hitsByLayer.get(layer.id) || [];
                      if (!hits.length) return null;
                      const color = layerColor(layer);
                      const isSel = !!highlightLabelLc && layer.name.trim().toLowerCase() === highlightLabelLc;
                      const fillOpacity = isSel ? 0.42 : 0.18;
                      const strokeWidth = isSel ? 0.010 : 0.004;
                      const pad = 0.012;
                      return hits.map((h, i) => {
                        const x1 = Math.max(0, h.rect[0] / labelImg.w - pad);
                        const y1 = Math.max(0, h.rect[1] / labelImg.h - pad);
                        const x2 = Math.min(1, h.rect[2] / labelImg.w + pad);
                        const y2 = Math.min(1, h.rect[3] / labelImg.h + pad);
                        return (
                          <rect
                            key={`hit-${layer.id}-${i}`}
                            x={x1}
                            y={y1}
                            width={Math.max(0.001, x2 - x1)}
                            height={Math.max(0.001, y2 - y1)}
                            fill={color}
                            fillOpacity={fillOpacity}
                            stroke={color}
                            strokeWidth={strokeWidth}
                            vectorEffect="non-scaling-stroke"
                            rx={0.004}
                          />
                        );
                      });
                    })}
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
                {/* Selection callout — drives Stage 02 "selected segment" visual */}
                {highlight?.label && !hasMatchedSelection && !hasLabelSelection && (
                  <div
                    className="pointer-events-none absolute inset-0"
                    style={{
                      boxShadow: `inset 0 0 0 2px ${highlight.color || "hsl(24 95% 55%)"}`,
                      animation: "pulse 1.6s ease-in-out infinite",
                    }}
                  >
                    <div
                      className="absolute left-1/2 top-2 -translate-x-1/2 px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-background"
                      style={{ background: highlight.color || "hsl(24 95% 55%)" }}
                    >
                      Selection: {highlight.label}
                    </div>
                  </div>
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
                  onClick={() => {
                    setHidden((prev) => {
                      if (!prev.has(l.id)) return prev;
                      const next = new Set(prev);
                      next.delete(l.id);
                      return next;
                    });
                    setActiveLayer(l.id);
                    // Keep current tool — Pan lets the user just highlight a
                    // segment, Polygon stays on if they were drawing.
                  }}
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
                onClick={() => {
                  setHidden((prev) => {
                    if (!prev.has(l.id)) return prev;
                    const next = new Set(prev);
                    next.delete(l.id);
                    return next;
                  });
                  setActiveLayer(l.id);
                  // Keep current tool — Pan keeps the highlight without
                  // forcing the user into draw mode.
                }}
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

function ToolBtn({ children, title, active, onClick, disabled }: { children: React.ReactNode; title: string; active: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`grid h-8 w-8 place-items-center rounded transition-colors ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"} ${disabled ? "opacity-30 cursor-not-allowed hover:bg-transparent hover:text-muted-foreground" : ""}`}
    >
      {children}
    </button>
  );
}

// Re-export type for convenience
export type { CanvasLayer as TakeoffCanvasLayer };
