import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { StageHeader, GateBanner, EmptyState, type StageProps } from "./_shared";
import { Button } from "@/components/ui/button";
import {
  parseImperialFeet,
  resolveScale,
  type Calibration,
  type Discipline,
} from "../lib/scale-resolver";
import { detectDiscipline } from "@/lib/rebar-intake";
import {
  CheckCircle2,
  RefreshCcw,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import SheetTile from "./calibration/SheetTile";
import SheetViewer from "./calibration/SheetViewer";

interface ExtractedDimensionEntity {
  value?: string | number | null;
  unit?: string | null;
  text?: string | null;
  x?: number | null;
  y?: number | null;
  w?: number | null;
  h?: number | null;
}

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
  raw_text: string;
  calibration: Calibration | null;
  ppfOverride: string;
  detectedDiscipline: Discipline;
  discipline: Discipline;
  source_file_id: string | null;
  source_file_name: string | null;
  source_file_path: string | null;
  dimensions: CalibrationDimension[];
}

function classifyFromText(text: string): Discipline {
  const t = text.toUpperCase().slice(0, 800);
  if (/\bSTRUCTURAL\b|\bSTR[-_ ]/.test(t)) return "Structural";
  if (/\bARCHITECTURAL\b|\bARCH[-_ ]/.test(t)) return "Architectural";
  return "Other";
}

function detectSheetDiscipline(opts: {
  fileName?: string | null;
  sheetNumber?: string | null;
  rawText?: string | null;
  tableDiscipline?: string | null;
}): Discipline {
  const td = (opts.tableDiscipline || "").toLowerCase();
  if (td.startsWith("struct")) return "Structural";
  if (td.startsWith("arch")) return "Architectural";
  for (const candidate of [opts.sheetNumber, opts.fileName]) {
    if (!candidate) continue;
    const d = detectDiscipline(candidate);
    if (d === "Structural") return "Structural";
    if (d === "Architectural") return "Architectural";
  }
  if (opts.rawText) {
    const d = classifyFromText(opts.rawText);
    if (d !== "Other") return d;
  }
  return "Other";
}

const REBAR_KEYWORDS =
  /(concrete|rebar|reinforc|bar mark|f['\u2019]c|\bpsi\b|\bmpa\b|slab|footing|pier|pile|pile cap|cap beam|\bbeam\b|\bcolumn\b|wall reinf|\blap\b|dowel|stirrup|\btie\b|\bhook\b|#\s?[3-9]|#\s?1[0-1])/i;
const REBAR_SHEET_NUM = /^(s[a-z]?-?\d|sd-?\d|f[a-z]?-?\d|fd-?\d|c[a-z]?-?\d)/i;

function isRelevantSheet(opts: {
  rawText: string;
  sheetNumber: string | null;
  tableDiscipline: string | null;
  barMarks: string[] | null;
  fileName?: string | null;
}): boolean {
  const td = (opts.tableDiscipline || "").toLowerCase();
  if (td.startsWith("struct") || td.startsWith("found") || td.startsWith("civil")) return true;
  if (opts.barMarks && opts.barMarks.length > 0) return true;
  if (opts.sheetNumber && REBAR_SHEET_NUM.test(opts.sheetNumber.trim())) return true;
  if (opts.fileName && REBAR_SHEET_NUM.test(opts.fileName.trim())) return true;
  if (opts.rawText && REBAR_KEYWORDS.test(opts.rawText)) return true;
  return false;
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseMetricMillimeters(label: string): number | null {
  const metric = label.match(/(\d+(?:\.\d+)?)\s*(mm|cm|m)\b/i);
  if (!metric) return null;
  const value = Number(metric[1]);
  if (!Number.isFinite(value)) return null;
  const unit = metric[2].toLowerCase();
  if (unit === "mm") return value;
  if (unit === "cm") return value * 10;
  return value * 1000;
}

function normalizeDimensionLabel(entity: ExtractedDimensionEntity): string {
  const base =
    (typeof entity.text === "string" && entity.text.trim()) ||
    (typeof entity.value === "string" && entity.value.trim()) ||
    (typeof entity.value === "number" ? String(entity.value) : "");
  const unit = entity.unit?.trim();
  if (unit && base && !new RegExp(`${unit}$`, "i").test(base)) return `${base} ${unit}`.trim();
  return base.trim();
}

function buildDimensionId(label: string, index: number, entity?: ExtractedDimensionEntity) {
  const parts = [
    label,
    entity?.x ?? "x",
    entity?.y ?? "y",
    entity?.w ?? "w",
    entity?.h ?? "h",
    index,
  ];
  return parts.join(":");
}

function extractDimensions(
  extractedEntities: { dimensions?: ExtractedDimensionEntity[] | null } | null | undefined,
  rawText: string,
): CalibrationDimension[] {
  const fromEntities = Array.isArray(extractedEntities?.dimensions)
    ? extractedEntities?.dimensions || []
    : [];

  if (fromEntities.length > 0) {
    return fromEntities
      .map((entity, index) => {
        const label = normalizeDimensionLabel(entity);
        if (!label) return null;
        return {
          id: buildDimensionId(label, index, entity),
          label,
          feet: parseImperialFeet(label),
          millimeters: parseMetricMillimeters(label),
          x: toFiniteNumber(entity.x),
          y: toFiniteNumber(entity.y),
          w: toFiniteNumber(entity.w),
          h: toFiniteNumber(entity.h),
          source: "entity" as const,
        };
      })
      .filter((dimension): dimension is CalibrationDimension => !!dimension);
  }

  const fallback = new Map<string, CalibrationDimension>();
  const matches = rawText.matchAll(
    /(\d+(?:\.\d+)?\s*'\s*[-\s]?\s*\d+(?:\.\d+)?\s*"|\d+(?:\.\d+)?\s*'|\d+(?:\.\d+)?\s*"|\d+(?:\.\d+)?\s*(?:mm|cm|m)\b)/gi,
  );

  let index = 0;
  for (const match of matches) {
    const label = match[0].replace(/\s+/g, " ").trim();
    if (!label || fallback.has(label)) continue;
    fallback.set(label, {
      id: buildDimensionId(label, index),
      label,
      feet: parseImperialFeet(label),
      millimeters: parseMetricMillimeters(label),
      x: null,
      y: null,
      w: null,
      h: null,
      source: "text",
    });
    index += 1;
  }

  return Array.from(fallback.values());
}

function determineTileState(
  _row: SheetRow,
  hasResolvedCalibration: boolean,
  hasConfirmedDimension: boolean,
): "complete" | "partial" | "attention" {
  if (hasResolvedCalibration && hasConfirmedDimension) return "complete";
  if (hasResolvedCalibration || hasConfirmedDimension) return "partial";
  return "attention";
}

export default function CalibrationStage({ projectId, state, goToStage }: StageProps) {
  const [sheets, setSheets] = useState<SheetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [showAll, setShowAll] = useState<boolean>(!!state.local.calibrationShowAll);
  const [activeSheetId, setActiveSheetId] = useState<string | null>(
    typeof state.local.calibrationActiveSheetId === "string"
      ? (state.local.calibrationActiveSheetId as string)
      : null,
  );

  const dimensionConfirmations = (state.local.dimensionConfirmations || {}) as Record<
    string,
    Record<string, true>
  >;

  const load = async () => {
    if (loading && sheets.length > 0) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("drawing_search_index")
        .select(
          "id, page_number, raw_text, sheet_revision_id, logical_drawing_id, document_version_id, bar_marks, extracted_entities",
        )
        .eq("project_id", projectId)
        .order("page_number", { ascending: true });
      if (error) throw error;
      const indexRowsRaw = (data || []) as Array<{
        id: string;
        page_number: number | null;
        raw_text: string | null;
        sheet_revision_id: string | null;
        logical_drawing_id: string | null;
        document_version_id: string | null;
        bar_marks: string[] | null;
        extracted_entities?: { dimensions?: ExtractedDimensionEntity[] | null } | null;
      }>;
      const indexRows = indexRowsRaw.map((r) => ({ ...r, raw_text: (r.raw_text || "").slice(0, 4096) }));
      const sheetRevIds = Array.from(
        new Set(indexRows.map((r) => r.sheet_revision_id).filter(Boolean) as string[]),
      );
      const logicalIds = Array.from(
        new Set(indexRows.map((r) => r.logical_drawing_id).filter(Boolean) as string[]),
      );
      const docVerIds = Array.from(
        new Set(indexRows.map((r) => r.document_version_id).filter(Boolean) as string[]),
      );
      const [revRes, logicRes, docRes] = await Promise.all([
        sheetRevIds.length
          ? supabase.from("sheet_revisions").select("id, sheet_number, discipline").in("id", sheetRevIds)
          : Promise.resolve({ data: [] as never[] }),
        logicalIds.length
          ? supabase.from("logical_drawings").select("id, sheet_id, discipline").in("id", logicalIds)
          : Promise.resolve({ data: [] as never[] }),
        docVerIds.length
          ? supabase.from("document_versions").select("id, file_name").in("id", docVerIds)
          : Promise.resolve({ data: [] as never[] }),
      ]);
      const revMap = new Map<string, { sheet_number: string | null; discipline: string | null }>(
        (revRes.data || []).map((r: any) => [
          r.id,
          { sheet_number: r.sheet_number, discipline: r.discipline },
        ]),
      );
      const logicMap = new Map<string, { sheet_id: string | null; discipline: string | null }>(
        (logicRes.data || []).map((r: any) => [r.id, { sheet_id: r.sheet_id, discipline: r.discipline }]),
      );
      const docMap = new Map<string, string>((docRes.data || []).map((r: any) => [r.id, r.file_name]));
      const overrideMap = (state.local.disciplineOverride || {}) as Record<string, Discipline>;
      const allRows: Array<SheetRow & { _relevant: boolean }> = indexRows.map((r) => {
        const rev = r.sheet_revision_id ? revMap.get(r.sheet_revision_id) : undefined;
        const logic = r.logical_drawing_id ? logicMap.get(r.logical_drawing_id) : undefined;
        const fileName = r.document_version_id ? docMap.get(r.document_version_id) : undefined;
        const sourceFile =
          state.files.find((file) => file.id === r.document_version_id) ||
          state.files.find((file) => file.legacy_file_id === r.document_version_id) ||
          state.files.find((file) => file.file_name === fileName) ||
          null;
        const sheetNumber = rev?.sheet_number || logic?.sheet_id || null;
        const tableDiscipline = rev?.discipline || logic?.discipline || null;
        const detected = detectSheetDiscipline({
          fileName,
          sheetNumber,
          rawText: r.raw_text,
          tableDiscipline,
        });
        const override = overrideMap[r.id];
        const cal = resolveScale({ rawText: r.raw_text || "" });
        const relevant = isRelevantSheet({
          rawText: r.raw_text || "",
          sheetNumber,
          tableDiscipline,
          barMarks: r.bar_marks,
          fileName,
        });
        return {
          id: r.id,
          page_number: r.page_number,
          sheet_number: sheetNumber,
          raw_text: r.raw_text || "",
          calibration: cal,
          ppfOverride: cal && cal.pixelsPerFoot > 0 ? cal.pixelsPerFoot.toFixed(2) : "",
          detectedDiscipline: detected,
          discipline: override || detected,
          source_file_id: sourceFile?.id || null,
          source_file_name: sourceFile?.file_name || fileName || null,
          source_file_path: sourceFile?.file_path || null,
          dimensions: extractDimensions(r.extracted_entities, r.raw_text || ""),
          _relevant: relevant,
        };
      });
      const filtered = showAll ? allRows : allRows.filter((r) => r._relevant);
      setHiddenCount(allRows.length - filtered.length);
      const rows: SheetRow[] = filtered.map(({ _relevant, ...row }) => row);
      const stored = (state.local.calibration || {}) as Record<string, Calibration>;
      for (const row of rows) {
        const saved = stored[row.id];
        if (saved) {
          row.calibration = saved;
          row.ppfOverride = String(saved.pixelsPerFoot.toFixed(2));
        }
      }
      setSheets(rows);
      const map: Record<string, Calibration> = {};
      for (const row of rows) if (row.calibration) map[row.id] = row.calibration;
      if (Object.keys(map).length > 0) state.setLocal({ calibration: map });
    } catch (err: any) {
      console.error("CalibrationStage load failed:", err);
      toast.error(`Failed to load sheets — ${err?.message || "retry"}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, showAll]);

  useEffect(() => {
    if (sheets.length === 0) {
      if (activeSheetId !== null) setActiveSheetId(null);
      return;
    }
    const currentExists = activeSheetId && sheets.some((sheet) => sheet.id === activeSheetId);
    if (currentExists) return;
    const nextId = sheets[0]?.id || null;
    if (!nextId) return;
    setActiveSheetId(nextId);
    state.setLocal({ calibrationActiveSheetId: nextId });
  }, [activeSheetId, sheets, state]);

  const persist = (next: SheetRow[]) => {
    const map: Record<string, Calibration> = {};
    for (const row of next) if (row.calibration) map[row.id] = row.calibration;
    state.setLocal({ calibration: map });
  };

  const updateOverride = (id: string, value: string) => {
    setSheets((prev) => {
      const next = prev.map((row) => {
        if (row.id !== id) return row;
        const ppf = Number(value);
        const calibration =
          Number.isFinite(ppf) && ppf > 0
            ? {
                source: "user",
                pixelsPerFoot: ppf,
                confidence: "user",
                method: "Estimator override",
              }
            : row.calibration;
        return { ...row, ppfOverride: value, calibration };
      });
      persist(next);
      return next;
    });
  };

  const setDiscipline = (id: string, value: Discipline) => {
    setSheets((prev) => prev.map((row) => (row.id === id ? { ...row, discipline: value } : row)));
    const current = (state.local.disciplineOverride || {}) as Record<string, Discipline>;
    state.setLocal({ disciplineOverride: { ...current, [id]: value }, calibrationPrimary: "structural" });
  };

  const setActiveSheet = (id: string) => {
    setActiveSheetId(id);
    state.setLocal({ calibrationActiveSheetId: id });
  };

  const setDimensionConfirmed = (sheetId: string, dimensionId: string, confirmed: boolean) => {
    const next: Record<string, Record<string, true>> = {
      ...dimensionConfirmations,
      [sheetId]: { ...(dimensionConfirmations[sheetId] || {}) },
    };
    if (confirmed) next[sheetId][dimensionId] = true;
    else delete next[sheetId][dimensionId];
    if (Object.keys(next[sheetId]).length === 0) delete next[sheetId];
    state.setLocal({ dimensionConfirmations: next });
  };

  const confirmAllDimensions = (sheetId: string) => {
    const target = sheets.find((sheet) => sheet.id === sheetId);
    if (!target || target.dimensions.length === 0) return;
    const next: Record<string, true> = {};
    for (const dimension of target.dimensions) next[dimension.id] = true;
    state.setLocal({
      dimensionConfirmations: {
        ...dimensionConfirmations,
        [sheetId]: next,
      },
    });
  };

  const applySegmentCalibration = (sheetId: string, dimensionId: string, longestEdgePx: number | null) => {
    if (!Number.isFinite(longestEdgePx) || !longestEdgePx || longestEdgePx <= 0) return;
    setSheets((prev) => {
      const next = prev.map((row) => {
        if (row.id !== sheetId) return row;
        const dimension = row.dimensions.find((entry) => entry.id === dimensionId);
        if (!dimension?.feet || dimension.feet <= 0) return row;
        const pixelsPerFoot = longestEdgePx / dimension.feet;
        if (!Number.isFinite(pixelsPerFoot) || pixelsPerFoot <= 0) return row;
        return {
          ...row,
          calibration: {
            source: "dimension",
            scaleText: dimension.label,
            pixelsPerFoot,
            confidence: "user",
            method: `Selected segment calibrated against ${dimension.label}`,
          },
          ppfOverride: pixelsPerFoot.toFixed(2),
        };
      });
      persist(next);
      return next;
    });
  };

  const structural = sheets.filter((row) => row.discipline === "Structural");
  const architectural = sheets.filter((row) => row.discipline === "Architectural");
  const gateRows = structural.length + architectural.length > 0 ? [...structural, ...architectural] : sheets;
  const isResolved = (row: SheetRow) => !!row.calibration && row.calibration.pixelsPerFoot > 0;
  const hasConfirmedDimension = (row: SheetRow) =>
    Object.keys(dimensionConfirmations[row.id] || {}).length > 0;
  const fullyConfirmedCount = gateRows.filter(
    (row) => isResolved(row) && hasConfirmedDimension(row),
  ).length;
  const allConfirmable =
    gateRows.length > 0 && gateRows.every((row) => isResolved(row) && hasConfirmedDimension(row));

  const promoteAllToStructural = () => {
    const current = (state.local.disciplineOverride || {}) as Record<string, Discipline>;
    const next: Record<string, Discipline> = { ...current };
    for (const row of sheets) next[row.id] = "Structural";
    state.setLocal({ disciplineOverride: next, calibrationPrimary: "structural" });
    setSheets((prev) => prev.map((row) => ({ ...row, discipline: "Structural" })));
  };

  const confirmAll = () => {
    if (confirming) return;
    setConfirming(true);
    try {
      state.setLocal({ calibrationConfirmed: true, calibrationPrimary: "structural" });
      state.refresh();
      requestAnimationFrame(() => {
        goToStage?.("takeoff");
        setConfirming(false);
      });
    } catch (err: any) {
      console.error("CalibrationStage confirm failed:", err);
      toast.error(`Could not confirm — ${err?.message || "retry"}`);
      setConfirming(false);
    }
  };

  const reset = () => {
    state.setLocal({ calibrationConfirmed: false });
    state.refresh();
  };

  const confirmed = !!state.local.calibrationConfirmed;
  const activeSheet = useMemo(
    () => sheets.find((sheet) => sheet.id === activeSheetId) || sheets[0] || null,
    [activeSheetId, sheets],
  );

  return (
    <div className="flex h-full flex-col">
      <StageHeader
        kicker="Stage 03"
        title="Scale Calibration Workspace"
        subtitle="Confirm a usable scale and at least one trusted dimension on every relevant sheet before takeoff."
        right={
          <div className="flex items-center gap-2">
            {hiddenCount > 0 && !showAll && (
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {sheets.length} relevant · {hiddenCount} hidden
              </span>
            )}
            <label className="flex cursor-pointer select-none items-center gap-1 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={showAll}
                onChange={(event) => {
                  setShowAll(event.target.checked);
                  state.setLocal({ calibrationShowAll: event.target.checked });
                }}
                className="h-3 w-3"
              />
              Show all sheets
            </label>
            <Button size="sm" variant="outline" onClick={load} disabled={loading}>
              {loading ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
              )}
              {loading ? "Loading…" : "Re-detect"}
            </Button>
            {confirmed ? (
              <Button size="sm" variant="outline" onClick={reset}>
                Re-open
              </Button>
            ) : (
              <Button size="sm" disabled={!allConfirmable || loading || confirming} onClick={confirmAll}>
                {confirming ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                )}
                {confirming ? "Confirming…" : "Confirm calibration"}
              </Button>
            )}
          </div>
        }
      />

      {confirmed && (
        <div className="flex items-center gap-2 border-b border-border bg-[hsl(var(--status-supported))]/10 px-4 py-2 text-[12px]">
          <CheckCircle2 className="h-4 w-4 text-[hsl(var(--status-supported))]" />
          Calibration confirmed ({fullyConfirmedCount}/{gateRows.length} sheets fully verified). Takeoff can proceed.
          {goToStage && (
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => goToStage("takeoff")}>
              Open Takeoff →
            </Button>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <div className="text-[12px]">Loading sheets…</div>
          </div>
        ) : sheets.length === 0 ? (
          <EmptyState title="No indexed sheets yet" hint="Upload and parse drawings in Stage 01 first." />
        ) : (
          <div className="grid h-full min-h-0 grid-cols-[220px_minmax(0,1fr)]">
            <aside className="flex min-h-0 flex-col border-r border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    Relevant Sheets
                  </div>
                  <div className="text-[12px] text-foreground">{sheets.length} in workspace</div>
                </div>
                <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {fullyConfirmedCount}/{gateRows.length}
                </div>
              </div>
              {structural.length === 0 && (
                <div className="border-b border-border bg-[hsl(var(--status-inferred))]/5 px-3 py-2 text-[11px] text-muted-foreground">
                  <div className="mb-2 flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--status-inferred))]" />
                    <span>No Structural sheets detected. Reclassify a sheet or promote the set before takeoff.</span>
                  </div>
                  <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={promoteAllToStructural}>
                    Mark all Structural
                  </Button>
                </div>
              )}
              <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
                {sheets.map((sheet) => (
                  <SheetTile
                    key={sheet.id}
                    active={sheet.id === activeSheet?.id}
                    pageNumber={sheet.page_number}
                    sheetNumber={sheet.sheet_number}
                    discipline={sheet.discipline}
                    status={determineTileState(sheet, isResolved(sheet), hasConfirmedDimension(sheet))}
                    sourceFileName={sheet.source_file_name}
                    sourceFilePath={sheet.source_file_path}
                    onSelect={() => setActiveSheet(sheet.id)}
                  />
                ))}
              </div>
            </aside>

            <div className="min-h-0">
              {activeSheet ? (
                <SheetViewer
                  key={activeSheet.id}
                  projectId={projectId}
                  sheet={activeSheet}
                  confirmedDimensions={dimensionConfirmations[activeSheet.id] || {}}
                  onDimensionConfirmed={(dimensionId, nextConfirmed) =>
                    setDimensionConfirmed(activeSheet.id, dimensionId, nextConfirmed)
                  }
                  onConfirmAllDimensions={() => confirmAllDimensions(activeSheet.id)}
                  onAssignCalibration={(dimensionId, longestEdgePx) =>
                    applySegmentCalibration(activeSheet.id, dimensionId, longestEdgePx)
                  }
                  onOverrideChange={(value) => updateOverride(activeSheet.id, value)}
                  onDisciplineChange={(value) => setDiscipline(activeSheet.id, value)}
                />
              ) : (
                <EmptyState title="Select a sheet" hint="Choose a relevant drawing to inspect its scale and dimensions." />
              )}
            </div>
          </div>
        )}
      </div>

      {!confirmed && (
        <div className="border-t border-border px-4 py-2">
          <GateBanner
            tone={allConfirmable ? "warn" : "blocked"}
            title={
              allConfirmable
                ? "Ready to confirm"
                : gateRows.length === 0
                  ? "No discipline-tagged sheets"
                  : "Calibration still needs review"
            }
            message={
              allConfirmable
                ? `${fullyConfirmedCount}/${gateRows.length} relevant sheets are fully confirmed.`
                : gateRows.length === 0
                  ? "Reclassify at least one sheet so the workspace knows what should drive takeoff."
                  : `${fullyConfirmedCount}/${gateRows.length} relevant sheets have both a resolved px/ft and at least one confirmed dimension.`
            }
          />
        </div>
      )}
    </div>
  );
}
