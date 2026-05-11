import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import PdfRenderer from "@/components/chat/PdfRenderer";
import type { Calibration, Discipline } from "../../lib/scale-resolver";
import { Check, Layers3, MousePointer2, Ruler, X } from "lucide-react";

interface CalibrationDimension {
  id: string;
  label: string;
  feet: number | null;
  millimeters: number | null;
  x: number | null;
  y: number | null;
  w: number | null;
  h: number | null;
  source: "entity" | "text";
}

interface SheetRow {
  id: string;
  page_number: number | null;
  sheet_number: string | null;
  calibration: Calibration | null;
  ppfOverride: string;
  discipline: Discipline;
  source_file_id: string | null;
  source_file_name: string | null;
  source_file_path: string | null;
  dimensions: CalibrationDimension[];
}

interface OverlayRow {
  id: string;
  segment_id: string | null;
  page_number: number;
  polygon: Array<[number, number]>;
  color_hint: string | null;
  source_file_id?: string | null;
}

interface SegmentOverlay extends OverlayRow {
  name: string;
  longestEdgePx: number;
}

interface SheetViewerProps {
  projectId: string;
  sheet: SheetRow;
  confirmedDimensions: Record<string, true>;
  onDimensionConfirmed: (dimensionId: string, confirmed: boolean) => void;
  onConfirmAllDimensions: () => void;
  onAssignCalibration: (dimensionId: string, longestEdgePx: number | null) => void;
  onOverrideChange: (value: string) => void;
  onDisciplineChange: (value: Discipline) => void;
}

function polygonPointMax(polygon: Array<[number, number]>) {
  return polygon.reduce(
    (acc, [x, y]) => ({ x: Math.max(acc.x, x), y: Math.max(acc.y, y) }),
    { x: 0, y: 0 },
  );
}

function toAbsolutePoint(point: [number, number], width: number, height: number, normalized: boolean) {
  return normalized ? [point[0] * width, point[1] * height] : [point[0], point[1]];
}

function polygonPointsToSvg(polygon: Array<[number, number]>, width: number, height: number) {
  const max = polygonPointMax(polygon);
  const normalized = max.x <= 1.5 && max.y <= 1.5;
  return polygon
    .map((point) => {
      const [x, y] = toAbsolutePoint(point, width, height, normalized);
      return `${x},${y}`;
    })
    .join(" ");
}

function longestEdgePx(polygon: Array<[number, number]>, width: number, height: number) {
  if (polygon.length < 2) return 0;
  const max = polygonPointMax(polygon);
  const normalized = max.x <= 1.5 && max.y <= 1.5;
  let longest = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    const [x1, y1] = toAbsolutePoint(current, width, height, normalized);
    const [x2, y2] = toAbsolutePoint(next, width, height, normalized);
    const distance = Math.hypot(x2 - x1, y2 - y1);
    if (distance > longest) longest = distance;
  }
  return longest;
}

function formatFeet(value: number | null) {
  if (!value || !Number.isFinite(value)) return "—";
  return `${value.toFixed(value < 10 ? 2 : 1)} ft`;
}

function formatMillimeters(value: number | null) {
  if (!value || !Number.isFinite(value)) return "—";
  return `${Math.round(value)} mm`;
}

function overlayAnchor(dimension: CalibrationDimension, width: number, height: number) {
  const x = dimension.x ?? 0;
  const y = dimension.y ?? 0;
  const w = dimension.w ?? 0;
  const anchorX = Math.max(12, Math.min(width - 118, x + w / 2 - 36));
  const anchorY = Math.max(12, Math.min(height - 28, y - 18));
  return { x: anchorX, y: anchorY };
}

function calibrationTone(calibration: Calibration | null) {
  if (!calibration || calibration.pixelsPerFoot <= 0) return "text-[hsl(var(--status-blocked))]";
  if (calibration.confidence === "high" || calibration.confidence === "user") {
    return "text-[hsl(var(--status-supported))]";
  }
  return "text-[hsl(var(--status-inferred))]";
}

export default function SheetViewer({
  projectId,
  sheet,
  confirmedDimensions,
  onDimensionConfirmed,
  onConfirmAllDimensions,
  onAssignCalibration,
  onOverrideChange,
  onDisciplineChange,
}: SheetViewerProps) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [overlays, setOverlays] = useState<SegmentOverlay[]>([]);
  const [renderState, setRenderState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    setSignedUrl(null);
    setImageUrl(null);
    setPageSize(null);
    setSelectedSegmentId(null);
    setRenderState("idle");
  }, [sheet.id]);

  useEffect(() => {
    let cancelled = false;
    if (!sheet.source_file_path) return;
    (async () => {
      const { data } = await supabase.storage.from("blueprints").createSignedUrl(sheet.source_file_path, 3600);
      if (!cancelled) setSignedUrl(data?.signedUrl || null);
    })();
    return () => {
      cancelled = true;
    };
  }, [sheet.source_file_path]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const query = supabase
        .from("takeoff_overlays" as never)
        .select("id,segment_id,page_number,polygon,color_hint,source_file_id")
        .eq("project_id", projectId)
        .eq("page_number", sheet.page_number || 1);

      const scopedQuery = sheet.source_file_id ? query.eq("source_file_id", sheet.source_file_id) : query;
      const { data, error } = await scopedQuery;
      if (cancelled) return;
      if (error) {
        console.warn("Failed to load takeoff overlays:", error.message);
        setOverlays([]);
        return;
      }

      const overlayRows = ((data as unknown as OverlayRow[]) || []).map((overlay) => ({
        ...overlay,
        polygon: Array.isArray(overlay.polygon) ? overlay.polygon : [],
      }));

      if (overlayRows.length === 0) {
        setOverlays([]);
        return;
      }

      const segmentIds = Array.from(
        new Set(overlayRows.map((overlay) => overlay.segment_id).filter(Boolean) as string[]),
      );
      let nameMap = new Map<string, string>();
      if (segmentIds.length > 0) {
        const { data: segments } = await supabase.from("segments").select("id,name").in("id", segmentIds);
        nameMap = new Map((segments || []).map((segment: any) => [segment.id, segment.name]));
      }

      setOverlays(
        overlayRows.map((overlay) => ({
          ...overlay,
          name: overlay.segment_id ? nameMap.get(overlay.segment_id) || "Segment" : "Unassigned",
          longestEdgePx: 0,
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, sheet.page_number, sheet.source_file_id]);

  const enrichedOverlays = useMemo(() => {
    if (!pageSize) return overlays;
    return overlays.map((overlay) => ({
      ...overlay,
      longestEdgePx: longestEdgePx(overlay.polygon, pageSize.width, pageSize.height),
    }));
  }, [overlays, pageSize]);

  const selectedSegment = enrichedOverlays.find((overlay) => overlay.id === selectedSegmentId) || null;
  const visibleDimensions = sheet.dimensions.filter(
    (dimension) =>
      dimension.x !== null &&
      dimension.y !== null &&
      dimension.w !== null &&
      dimension.h !== null &&
      pageSize,
  );
  const isPdf = /\.pdf$/i.test(sheet.source_file_name || "");

  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto]">
      <div className="min-h-0 overflow-hidden border-b border-border bg-sidebar/30">
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Viewer
            </div>
            <div className="text-[13px] font-semibold text-foreground">
              {sheet.sheet_number || `Page ${sheet.page_number ?? "—"}`}
            </div>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className={`font-mono ${calibrationTone(sheet.calibration)}`}>
              {sheet.calibration?.pixelsPerFoot ? `${sheet.calibration.pixelsPerFoot.toFixed(2)} px/ft` : "No scale"}
            </span>
            <span>{sheet.dimensions.length} dimensions</span>
            <span>{enrichedOverlays.length} segments</span>
          </div>
        </div>

        <div className="relative flex h-full items-center justify-center overflow-auto p-4">
          {isPdf && signedUrl && (
            <PdfRenderer
              url={signedUrl}
              currentPage={sheet.page_number || 1}
              scale={1.5}
              onPageRendered={(image, width, height) => {
                setImageUrl(image);
                setPageSize({ width, height });
              }}
              onRenderStateChange={({ status }) => {
                if (status === "loading") setRenderState("loading");
                if (status === "ready") setRenderState("ready");
                if (status === "error") setRenderState("error");
              }}
            />
          )}

          {!sheet.source_file_path ? (
            <div className="text-center text-[12px] text-muted-foreground">
              No source file path was found for this drawing page.
            </div>
          ) : !signedUrl ? (
            <div className="text-center text-[12px] text-muted-foreground">Preparing sheet…</div>
          ) : !isPdf ? (
            <div className="text-center text-[12px] text-muted-foreground">Only PDF-backed sheets render in this workspace.</div>
          ) : imageUrl && pageSize ? (
            <div className="relative" style={{ width: pageSize.width, height: pageSize.height }}>
              <img
                src={imageUrl}
                alt={sheet.sheet_number || `Page ${sheet.page_number ?? "—"}`}
                className="block h-auto max-w-full border border-border bg-white shadow-sm"
                style={{ width: pageSize.width, height: pageSize.height }}
              />
              <svg
                className="absolute left-0 top-0 h-full w-full"
                viewBox={`0 0 ${pageSize.width} ${pageSize.height}`}
              >
                {enrichedOverlays.map((overlay) => {
                  const isSelected = overlay.id === selectedSegmentId;
                  return (
                    <polygon
                      key={overlay.id}
                      points={polygonPointsToSvg(overlay.polygon, pageSize.width, pageSize.height)}
                      fill={isSelected ? "hsl(var(--primary) / 0.35)" : "hsl(var(--muted-foreground) / 0.15)"}
                      stroke={isSelected ? "hsl(var(--primary))" : "hsl(var(--border))"}
                      strokeWidth={isSelected ? 2 : 1.25}
                      onMouseEnter={(event) => {
                        if (event.currentTarget !== document.activeElement && !isSelected) {
                          event.currentTarget.setAttribute("fill", "hsl(var(--accent) / 0.25)");
                        }
                      }}
                      onMouseLeave={(event) => {
                        event.currentTarget.setAttribute(
                          "fill",
                          isSelected ? "hsl(var(--primary) / 0.35)" : "hsl(var(--muted-foreground) / 0.15)",
                        );
                      }}
                      onClick={() => setSelectedSegmentId(overlay.id)}
                      style={{ cursor: "pointer" }}
                    />
                  );
                })}

                {visibleDimensions.map((dimension) => {
                  const { x, y } = overlayAnchor(dimension, pageSize.width, pageSize.height);
                  const confirmed = !!confirmedDimensions[dimension.id];
                  return (
                    <g key={dimension.id} transform={`translate(${x}, ${y})`}>
                      <rect
                        width={120}
                        height={24}
                        rx={6}
                        fill={confirmed ? "hsl(var(--background))" : "hsl(var(--card))"}
                        stroke={confirmed ? "hsl(var(--status-supported))" : "hsl(var(--border))"}
                      />
                      <text
                        x={8}
                        y={15}
                        fill="currentColor"
                        className="fill-foreground text-[10px] font-semibold"
                      >
                        {dimension.label}
                      </text>
                      <rect
                        x={78}
                        y={4}
                        width={16}
                        height={16}
                        rx={4}
                        fill={confirmed ? "hsl(var(--status-supported))" : "hsl(var(--muted))"}
                        onClick={() => onDimensionConfirmed(dimension.id, true)}
                        style={{ cursor: "pointer" }}
                      />
                      <text x={83} y={15} className="fill-black text-[11px] font-bold">
                        ✓
                      </text>
                      <rect
                        x={98}
                        y={4}
                        width={16}
                        height={16}
                        rx={4}
                        fill="hsl(var(--muted))"
                        onClick={() => onDimensionConfirmed(dimension.id, false)}
                        style={{ cursor: "pointer" }}
                      />
                      <text x={103} y={15} className="fill-foreground text-[11px] font-bold">
                        ✕
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          ) : (
            <div className="text-center text-[12px] text-muted-foreground">
              {renderState === "error" ? "PDF render failed." : "Rendering page…"}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 bg-card px-4 py-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Dimensions
              </div>
              <div className="text-[12px] text-muted-foreground">
                Confirm trusted dimensions. Click one after selecting a segment to derive sheet px/ft.
              </div>
            </div>
            <button
              type="button"
              onClick={onConfirmAllDimensions}
              className="inline-flex h-8 items-center gap-1 border border-border px-2 text-[11px] hover:bg-accent/30"
            >
              <Check className="h-3.5 w-3.5" />
              Confirm all
            </button>
          </div>

          <div className="max-h-[280px] space-y-2 overflow-auto pr-1">
            {sheet.dimensions.length === 0 ? (
              <div className="border border-dashed border-border px-3 py-4 text-[12px] text-muted-foreground">
                No dimensions were detected on this sheet yet.
              </div>
            ) : (
              sheet.dimensions.map((dimension) => {
                const confirmed = !!confirmedDimensions[dimension.id];
                const assignable = !!selectedSegment && !!dimension.feet;
                return (
                  <button
                    key={dimension.id}
                    type="button"
                    onClick={() => {
                      if (assignable) onAssignCalibration(dimension.id, selectedSegment?.longestEdgePx || null);
                    }}
                    className={`grid w-full grid-cols-[minmax(0,1fr)_88px_88px_32px] items-center gap-3 border px-3 py-2 text-left ${
                      confirmed ? "border-[hsl(var(--status-supported))]/40 bg-[hsl(var(--status-supported))]/5" : "border-border hover:bg-accent/20"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-semibold text-foreground">{dimension.label}</div>
                      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                        {assignable ? "Click to calibrate from selected segment" : dimension.source === "entity" ? "OCR anchored" : "Text fallback"}
                      </div>
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground">{formatFeet(dimension.feet)}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">{formatMillimeters(dimension.millimeters)}</div>
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(event) => onDimensionConfirmed(dimension.id, event.target.checked)}
                      onClick={(event) => event.stopPropagation()}
                      className="h-4 w-4"
                    />
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="space-y-3 border border-border bg-background p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Calibration
              </div>
              <div className="text-[12px] font-semibold text-foreground">
                {sheet.calibration?.pixelsPerFoot ? `${sheet.calibration.pixelsPerFoot.toFixed(2)} px/ft` : "Awaiting scale"}
              </div>
            </div>
            <div className="text-right text-[11px] text-muted-foreground">
              <div>{sheet.calibration?.confidence || "none"}</div>
              <div className="max-w-[160px] truncate">{sheet.calibration?.scaleText || sheet.calibration?.method || "No source"}</div>
            </div>
          </div>

          <label className="block text-[11px] text-muted-foreground">
            Discipline
            <select
              value={sheet.discipline}
              onChange={(event) => onDisciplineChange(event.target.value as Discipline)}
              className="mt-1 h-9 w-full border border-border bg-background px-2 text-[12px] text-foreground"
            >
              <option value="Structural">Structural</option>
              <option value="Architectural">Architectural</option>
              <option value="Other">Other</option>
            </select>
          </label>

          <label className="block text-[11px] text-muted-foreground">
            px / ft
            <input
              value={sheet.ppfOverride}
              onChange={(event) => onOverrideChange(event.target.value)}
              className="mt-1 h-9 w-full border border-border bg-background px-2 font-mono text-[12px] tabular-nums text-foreground"
              placeholder="—"
            />
          </label>

          <div className="space-y-2 border-t border-border pt-3 text-[11px] text-muted-foreground">
            <div className="flex items-start gap-2">
              <MousePointer2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {selectedSegment
                  ? `${selectedSegment.name} selected · longest edge ${selectedSegment.longestEdgePx.toFixed(1)} px`
                  : "Select a segment polygon in the viewer to turn it into a calibration reference."}
              </span>
            </div>
            <div className="flex items-start gap-2">
              <Ruler className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Confirming a dimension marks it as trusted. Clicking a dimension with a selected segment recalculates px/ft for this sheet.
              </span>
            </div>
            <div className="flex items-start gap-2">
              <Layers3 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{enrichedOverlays.length} overlay segment{enrichedOverlays.length === 1 ? "" : "s"} on this page.</span>
            </div>
          </div>

          {selectedSegment && (
            <button
              type="button"
              onClick={() => setSelectedSegmentId(null)}
              className="inline-flex h-8 items-center gap-1 border border-border px-2 text-[11px] hover:bg-accent/30"
            >
              <X className="h-3.5 w-3.5" />
              Clear selected segment
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
