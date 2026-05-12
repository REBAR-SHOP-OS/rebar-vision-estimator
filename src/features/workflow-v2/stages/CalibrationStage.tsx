import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { StageHeader, GateBanner, Pill, EmptyState, type StageProps } from "./_shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { resolveScale, type Calibration, type CalibrationDiagnostics, type CalibrationReason, type Discipline } from "../lib/scale-resolver";
import { detectDiscipline } from "@/lib/rebar-intake";
import { DEFAULT_MARK_PATTERNS } from "@/lib/ocr-page-labels";
import { CheckCircle2, RefreshCcw, Ruler, AlertTriangle, Loader2, MousePointerClick, X, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { toast } from "sonner";
import PdfRenderer from "@/components/chat/PdfRenderer";
import { deriveCalibrationStageState } from "./calibration-stage-state";

export type ScaleStatus = "auto-detected" | "verified" | "manual" | "ambiguous" | "failed";

interface SheetRow {
  id: string;
  page_number: number | null;
  sheet_number: string | null;
  raw_text: string;
  calibration: Calibration | null;
  ppfOverride: string;
  detectedDiscipline: Discipline;
  discipline: Discipline; // effective (override > detected)
  scale_status: ScaleStatus;
  scale_reason?: CalibrationReason;
  diagnostics?: CalibrationDiagnostics;
  unmatchedTokens?: string[];
  file_path: string | null; // for two-point calibration modal
}

type StepStatus = "idle" | "loading" | "done" | "error";

interface LoadSteps {
  index: StepStatus;
  revisions: StepStatus;
  drawings: StepStatus;
  files: StepStatus;
  errors: {
    index?: string;
    revisions?: string;
    drawings?: string;
    files?: string;
  };
}

function initialSteps(): LoadSteps {
  return { index: "idle", revisions: "idle", drawings: "idle", files: "idle", errors: {} };
}

function deriveScaleStatus(cal: Calibration | null, storedStatus?: ScaleStatus): ScaleStatus {
  if (storedStatus === "verified" || storedStatus === "manual") return storedStatus;
  if (storedStatus === "ambiguous" || storedStatus === "failed") return storedStatus;
  if (cal?.reviewState === "ambiguous") return "ambiguous";
  if (cal?.reviewState === "failed") return "failed";
  if (!cal || cal.pixelsPerFoot <= 0) return "failed";
  if (cal.source === "user") return "manual";
  return "auto-detected";
}

/** Warn when a loading step takes longer than this threshold. */
const SLOW_STEP_THRESHOLD_MS = 3000;
const STEP_TIMEOUT_MS = 15000;

function classifyFromText(text: string): Discipline {
  const t = text.toUpperCase().slice(0, 800);
  if (/\bSTRUCTURAL\b|\bSTR[-_ ]/.test(t)) return "Structural";
  if (/\bARCHITECTURAL\b|\bARCH[-_ ]/.test(t)) return "Architectural";
  return "Other";
}

function detectSheetDiscipline(opts: { fileName?: string | null; sheetNumber?: string | null; rawText?: string | null; tableDiscipline?: string | null }): Discipline {
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

const REBAR_KEYWORDS = /(concrete|rebar|reinforc|bar mark|f['\u2019]c|\bpsi\b|\bmpa\b|slab|footing|pier|pile|pile cap|cap beam|\bbeam\b|\bcolumn\b|wall reinf|\blap\b|dowel|stirrup|\btie\b|\bhook\b|#\s?[3-9]|#\s?1[0-1])/i;
const REBAR_SHEET_NUM = /^(s[a-z]?-?\d|sd-?\d|f[a-z]?-?\d|fd-?\d|c[a-z]?-?\d)/i;
function isRelevantSheet(opts: { rawText: string; sheetNumber: string | null; tableDiscipline: string | null; barMarks: string[] | null; fileName?: string | null }): boolean {
  const td = (opts.tableDiscipline || "").toLowerCase();
  if (td.startsWith("struct") || td.startsWith("found") || td.startsWith("civil")) return true;
  if (opts.barMarks && opts.barMarks.length > 0) return true;
  if (opts.sheetNumber && REBAR_SHEET_NUM.test(opts.sheetNumber.trim())) return true;
  if (opts.fileName && REBAR_SHEET_NUM.test(opts.fileName.trim())) return true;
  if (opts.rawText && REBAR_KEYWORDS.test(opts.rawText)) return true;
  return false;
}

const REASON_LABEL: Record<CalibrationReason, string> = {
  "no scale text found": "No scale text found",
  "multiple scales detected": "Multiple competing scales detected",
  "detail scales found only": "Only detail scales were detected",
  "OCR incomplete": "OCR looks incomplete",
  "metadata load failed": "Metadata load failed",
};

/**
 * Scan raw OCR text for short alpha+digit tokens that look like structural marks
 * but did not match any DEFAULT_MARK_PATTERN. Useful for diagnosing why a
 * footing/wall mark wasn't recognised on the same sheet being calibrated.
 */
function scanUnmatchedMarkTokens(rawText: string, limit = 30): string[] {
  if (!rawText) return [];
  const out = new Set<string>();
  const tokens = rawText.split(/[\s,;:()\[\]\/\\]+/);
  for (const raw of tokens) {
    const t = (raw || "").trim().toUpperCase();
    if (t.length < 2 || t.length > 10) continue;
    if (!/[A-Z]/.test(t) || !/\d/.test(t)) continue;
    if (DEFAULT_MARK_PATTERNS.some((p) => p.test(t))) continue;
    out.add(t);
    if (out.size >= limit) break;
  }
  return Array.from(out);
}

function requiresReview(row: SheetRow): boolean {
  if (row.scale_status === "ambiguous" || row.scale_status === "failed") return true;
  if (row.scale_status === "verified" || row.scale_status === "manual") return false;
  const cal = row.calibration;
  if (!cal || cal.pixelsPerFoot <= 0) return true;
  if (cal.confidence === "low") return true;
  if (row.discipline === "Structural" && (cal.confidence !== "high" || (cal.detailOverrides?.length || 0) > 0)) return true;
  return false;
}

/**
 * Heuristic: does this sheet look like a non-scaled page (cover, drawing
 * index, schedules, general notes, legends) where two-point calibration is
 * meaningless? Returns the reason so the UI can show the right pill copy.
 */
type NonScaledReason = "cover" | "schedule" | "notes" | null;
function getNonScaledReason(row: SheetRow): NonScaledReason {
  const sn = (row.sheet_number || "").trim().toUpperCase();
  const txt = (row.raw_text || "").toUpperCase().slice(0, 800);
  const noScale = !row.calibration || row.calibration.pixelsPerFoot <= 0;

  if (sn && /^[A-Z]{1,3}-?0\.0$/.test(sn)) return "cover";
  if (/COVER\s+(SHEET|PAGE)/.test(txt)) return "cover";
  if (noScale && /\bN\.?\s*T\.?\s*S\.?\b/.test(txt) && !/SCHEDULE|NOTES|LEGEND|INDEX/.test(txt)) return "cover";

  if (noScale) {
    if (/^(G|GN)-/.test(sn)) return "notes";
    if (/(GENERAL\s+NOTES|ABBREVIATIONS|LEGEND)/.test(txt)) return "notes";
    if (/(DRAWING\s+(INDEX|LIST))/.test(txt)) return "cover";
    if (/(LOADING\s+INFORMATION|BAR\s+SCHEDULE|BEAM\s+SCHEDULE|COLUMN\s+SCHEDULE|REBAR\s+DEVELOPMENT\s+SCHEDULE|STEEL\s+SCHEDULE|LINTEL\s+SCHEDULE)/.test(txt)) return "schedule";
  }
  return null;
}
function isLikelyCoverSheet(row: SheetRow): boolean {
  return getNonScaledReason(row) !== null;
}

export default function CalibrationStage({ projectId, state, goToStage }: StageProps) {
  const [sheets, setSheets] = useState<SheetRow[]>([]);
  const [steps, setSteps] = useState<LoadSteps>(initialSteps());
  const [confirming, setConfirming] = useState(false);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [showAll, setShowAll] = useState<boolean>(!!state.local.calibrationShowAll);
  const [twoPointSheet, setTwoPointSheet] = useState<SheetRow | null>(null);
  const notApplicable = (state.local.calibrationNotApplicable || {}) as Record<string, boolean>;
  const isNotApplicable = (id: string) => !!notApplicable[id];
  const toggleNotApplicable = (id: string, value: boolean) => {
    const cur = (state.local.calibrationNotApplicable || {}) as Record<string, boolean>;
    const next = { ...cur };
    if (value) next[id] = true; else delete next[id];
    state.setLocal({ calibrationNotApplicable: next });
  };
  const [emptyState, setEmptyState] = useState<{ mode: "sheets" | "empty"; title?: string; hint?: string }>({
    mode: "empty",
    title: "Loading indexed sheets…",
  });

  const loading = steps.index === "loading" || steps.revisions === "loading" || steps.drawings === "loading" || steps.files === "loading";

  const setStep = (key: keyof Omit<LoadSteps, "errors">, status: StepStatus, err?: string) => {
    setSteps((prev) => ({
      ...prev,
      [key]: status,
      errors: err !== undefined ? { ...prev.errors, [key]: err } : { ...prev.errors, [key]: undefined },
    }));
  };

  // Timing helper: logs a console warning if a step takes longer than 3 s.
  const timedFetch = async <T,>(
    label: keyof Omit<LoadSteps, "errors">,
    fn: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> => {
    const start = performance.now();
    setStep(label, "loading");
    let timeoutId: ReturnType<typeof window.setTimeout> | null = null;
    const controller = new AbortController();
    try {
      const result = await Promise.race([
        fn(controller.signal),
        new Promise<T>((_, reject) => {
          timeoutId = setTimeout(() => {
            controller.abort();
            reject(new Error(`${label} timed out after ${Math.round(STEP_TIMEOUT_MS / 1000)}s`));
          }, STEP_TIMEOUT_MS);
        }),
      ]);
      const elapsed = performance.now() - start;
      if (elapsed > SLOW_STEP_THRESHOLD_MS) console.warn(`[CalibrationStage] step "${label}" took ${Math.round(elapsed)}ms`);
      if (import.meta.env.DEV) console.debug(`[CalibrationStage] ${label} finished in ${Math.round(elapsed)}ms`);
      setStep(label, "done");
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStep(label, "error", msg);
      console.error(`[CalibrationStage] ${label} failed`, err);
      throw err;
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
    }
  };

  const load = async () => {
    if (loading && sheets.length > 0) return;
    setSteps(initialSteps());

    // ── Step 1: drawing_search_index ──────────────────────────────────────────
    let indexRowsRaw: Array<{
      id: string;
      page_number: number | null;
      raw_text: string | null;
      sheet_revision_id: string | null;
      logical_drawing_id: string | null;
      document_version_id: string | null;
      bar_marks: string[] | null;
    }> = [];
    try {
      indexRowsRaw = await timedFetch("index", async (signal) => {
        const { data, error } = await supabase
          .from("drawing_search_index")
          .select("id, page_number, raw_text, sheet_revision_id, logical_drawing_id, document_version_id, bar_marks")
          .eq("project_id", projectId)
          .order("page_number", { ascending: true })
          .abortSignal(signal);
        if (error) throw error;
        return (data || []) as typeof indexRowsRaw;
      });
    } catch {
      return; // step error already set
    }

    const indexRows = indexRowsRaw.map((r) => ({ ...r, raw_text: r.raw_text || "" }));
    if (indexRows.length === 0) {
      const [{ data: documents }, { data: jobs }] = await Promise.all([
        supabase
          .from("document_versions")
          .select("file_name, parse_status, parse_error, pdf_metadata")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false }),
        supabase
          .from("processing_jobs")
          .select("status, error_message")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false })
          .limit(1),
      ]);
      setEmptyState(deriveCalibrationStageState({
        fileCount: state.fileCount,
        indexRowCount: 0,
        documents: (documents || []) as unknown as Parameters<typeof deriveCalibrationStageState>[0]["documents"],
        latestJob: jobs?.[0] || null,
      }));
      setSheets([]);
      setHiddenCount(0);
      return;
    }

    setEmptyState(deriveCalibrationStageState({
      fileCount: state.fileCount,
      indexRowCount: indexRows.length,
      documents: [],
    }));
    const sheetRevIds = Array.from(new Set(indexRows.map((r) => r.sheet_revision_id).filter(Boolean) as string[]));
    const logicalIds = Array.from(new Set(indexRows.map((r) => r.logical_drawing_id).filter(Boolean) as string[]));
    const docVerIds = Array.from(new Set(indexRows.map((r) => r.document_version_id).filter(Boolean) as string[]));

    // ── Steps 2-4: sheet metadata (parallel) ─────────────────────────────────
    type RevRow = { id: string; sheet_number: string | null; discipline: string | null };
    type LogicRow = { id: string; sheet_id: string | null; discipline: string | null };
    type DocRow = { id: string; file_name: string | null; file_path: string | null };

    let revData: RevRow[] = [];
    let logicData: LogicRow[] = [];
    let docData: DocRow[] = [];

    const [revResult, logicResult, docResult] = await Promise.allSettled([
      timedFetch("revisions", async (signal) => {
        if (!sheetRevIds.length) return [] as RevRow[];
        const { data, error } = await supabase.from("sheet_revisions").select("id, sheet_number, discipline").in("id", sheetRevIds).abortSignal(signal);
        if (error) throw error;
        return (data || []) as RevRow[];
      }),
      timedFetch("drawings", async (signal) => {
        if (!logicalIds.length) return [] as LogicRow[];
        const { data, error } = await supabase.from("logical_drawings").select("id, sheet_id, discipline").in("id", logicalIds).abortSignal(signal);
        if (error) throw error;
        return (data || []) as LogicRow[];
      }),
      timedFetch("files", async (signal) => {
        if (!docVerIds.length) return [] as DocRow[];
        const { data, error } = await supabase.from("document_versions").select("id, file_name, file_path").in("id", docVerIds).abortSignal(signal);
        if (error) throw error;
        return (data || []) as DocRow[];
      }),
    ]);

    if (revResult.status === "fulfilled") revData = revResult.value;
    if (logicResult.status === "fulfilled") logicData = logicResult.value;
    if (docResult.status === "fulfilled") docData = docResult.value;

    const revMap = new Map<string, RevRow>(revData.map((r) => [r.id, r]));
    const logicMap = new Map<string, LogicRow>(logicData.map((r) => [r.id, r]));
    const docMap = new Map<string, DocRow>(docData.map((r) => [r.id, r]));

    const overrideMap = (state.local.disciplineOverride || {}) as Record<string, Discipline>;
    const storedCals = (state.local.calibration || {}) as Record<string, Calibration>;
    const storedStatuses = (state.local.scaleStatus || {}) as Record<string, ScaleStatus>;
    const storedReasons = (state.local.scaleReason || {}) as Record<string, CalibrationReason | undefined>;
    const metadataFailed = revResult.status === "rejected" || logicResult.status === "rejected" || docResult.status === "rejected";

    const allRows: Array<SheetRow & { _relevant: boolean }> = indexRows.map((r) => {
      const rev = r.sheet_revision_id ? revMap.get(r.sheet_revision_id) : undefined;
      const logic = r.logical_drawing_id ? logicMap.get(r.logical_drawing_id) : undefined;
      const doc = r.document_version_id ? docMap.get(r.document_version_id) : undefined;
      const sheetNumber = rev?.sheet_number || logic?.sheet_id || null;
      const tableDiscipline = rev?.discipline || logic?.discipline || null;
      const fileName = doc?.file_name ?? undefined;
      const filePath = doc?.file_path ?? null;
      const detected = detectSheetDiscipline({ fileName, sheetNumber, rawText: r.raw_text, tableDiscipline });
      const override = overrideMap[r.id];
      const storedCal = storedCals[r.id];
      const autoCal = resolveScale({ rawText: r.raw_text || "", discipline: override || detected });
      const cal = storedCal || autoCal;
      const derivedStatus = deriveScaleStatus(cal, storedStatuses[r.id]);
      const unresolvedWithMetadataError = metadataFailed && (derivedStatus === "ambiguous" || derivedStatus === "failed");
      const resolvedReason = storedReasons[r.id] || cal?.reason || (unresolvedWithMetadataError ? "metadata load failed" : undefined);
      const relevant = isRelevantSheet({ rawText: r.raw_text || "", sheetNumber, tableDiscipline, barMarks: r.bar_marks, fileName });
      return {
        id: r.id,
        page_number: r.page_number,
        sheet_number: sheetNumber,
        raw_text: r.raw_text || "",
        calibration: cal,
        ppfOverride: cal && cal.pixelsPerFoot > 0 ? cal.pixelsPerFoot.toFixed(2) : "",
        detectedDiscipline: detected,
        discipline: override || detected,
        scale_status: derivedStatus,
        scale_reason: resolvedReason,
        diagnostics: cal?.diagnostics,
        unmatchedTokens: scanUnmatchedMarkTokens(r.raw_text || ""),
        file_path: filePath,
        _relevant: relevant,
      };
    });

    const relevantRows = allRows.filter((r) => r._relevant);
    const fallbackToAll = !showAll && relevantRows.length === 0 && allRows.length > 0;
    const filtered = showAll ? allRows : fallbackToAll ? allRows : relevantRows;
    setHiddenCount(showAll || fallbackToAll ? 0 : allRows.length - filtered.length);
    const rows: SheetRow[] = filtered.map(({ _relevant, ...r }) => r);
    setSheets(rows);

    // Persist auto-resolved px/ft and scale statuses.
    const calMap: Record<string, Calibration> = {};
    const statusMap: Record<string, ScaleStatus> = {};
    const reasonMap: Record<string, CalibrationReason | undefined> = {};
    for (const r of rows) {
      if (r.calibration) calMap[r.id] = r.calibration;
      statusMap[r.id] = r.scale_status;
      reasonMap[r.id] = r.scale_reason;
    }
    if (Object.keys(calMap).length > 0) state.setLocal({ calibration: calMap, scaleStatus: statusMap, scaleReason: reasonMap });
  };

  useEffect(() => {
    load();
  }, [projectId, showAll]); // load is intentionally stable; deps are projectId and showAll

  const persist = (next: SheetRow[]) => {
    const calMap: Record<string, Calibration> = {};
    const statusMap: Record<string, ScaleStatus> = {};
    const reasonMap: Record<string, CalibrationReason | undefined> = {};
    for (const r of next) {
      if (r.calibration) calMap[r.id] = r.calibration;
      statusMap[r.id] = r.scale_status;
      reasonMap[r.id] = r.scale_reason;
    }
    state.setLocal({ calibration: calMap, scaleStatus: statusMap, scaleReason: reasonMap });
  };

  const updateOverride = (id: string, value: string) => {
    setSheets((prev) => {
      const next = prev.map((r) => {
        if (r.id !== id) return r;
        const ppf = Number(value);
        const cal: Calibration | null = Number.isFinite(ppf) && ppf > 0
          ? { source: "user", pixelsPerFoot: ppf, confidence: "user", method: "Estimator override" }
          : r.calibration;
        const scale_status = deriveScaleStatus(cal, "manual");
        return { ...r, ppfOverride: value, calibration: cal, scale_status, scale_reason: undefined, diagnostics: cal?.diagnostics };
      });
      persist(next);
      return next;
    });
  };

  const acceptScale = (id: string) => {
    setSheets((prev) => {
      const next = prev.map((r) =>
        r.id === id ? { ...r, scale_status: "verified" as ScaleStatus, scale_reason: undefined } : r,
      );
      persist(next);
      return next;
    });
  };

  const applyTwoPoint = (id: string, ppf: number) => {
    setSheets((prev) => {
      const next = prev.map((r) => {
        if (r.id !== id) return r;
        const cal: Calibration = {
          source: "user",
          pixelsPerFoot: ppf,
          confidence: "user",
          method: "Two-point measurement",
        };
        return { ...r, calibration: cal, ppfOverride: ppf.toFixed(2), scale_status: "manual" as ScaleStatus, scale_reason: undefined };
      });
      persist(next);
      return next;
    });
    setTwoPointSheet(null);
  };

  const setDiscipline = (id: string, value: Discipline) => {
    setSheets((prev) => prev.map((r) => (r.id === id ? { ...r, discipline: value } : r)));
    const cur = (state.local.disciplineOverride || {}) as Record<string, Discipline>;
    state.setLocal({ disciplineOverride: { ...cur, [id]: value }, calibrationPrimary: "structural" });
  };

  const structural = sheets.filter((r) => r.discipline === "Structural");
  const reference = sheets.filter((r) => r.discipline !== "Structural");
  const architectural = sheets.filter((r) => r.discipline === "Architectural");
  const gateRowsAll = (structural.length + architectural.length > 0)
    ? [...structural, ...architectural]
    : sheets;
  const gateRows = gateRowsAll.filter((r) => !isNotApplicable(r.id));
  const isResolved = (r: SheetRow) => !!r.calibration && r.calibration.pixelsPerFoot > 0 && !requiresReview(r);
  const isCalibrated = (r: SheetRow) => !!r.calibration && r.calibration.pixelsPerFoot > 0;
  const isVerifiedOrManual = (r: SheetRow) => r.scale_status === "verified" || r.scale_status === "manual";
  const structuralResolved = structural.filter(isCalibrated).length;
  const gateResolved = gateRows.filter(isCalibrated).length;
  const verifiedCount = gateRows.filter(isVerifiedOrManual).length;
  const allConfirmable = gateRows.length > 0 && gateRows.every(isResolved);
  const hasVerified = verifiedCount > 0;
  const unresolvedRequired = gateRows.filter((r) => !isResolved(r));

  const promoteAllToStructural = () => {
    const cur = (state.local.disciplineOverride || {}) as Record<string, Discipline>;
    const next: Record<string, Discipline> = { ...cur };
    for (const r of sheets) next[r.id] = "Structural";
    state.setLocal({ disciplineOverride: next, calibrationPrimary: "structural" });
    setSheets((prev) => prev.map((r) => ({ ...r, discipline: "Structural" })));
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("CalibrationStage confirm failed:", err);
      toast.error(`Could not confirm — ${msg || "retry"}`);
      setConfirming(false);
    }
  };
  const reset = () => {
    state.setLocal({ calibrationConfirmed: false });
    state.refresh();
  };

  const confirmed = !!state.local.calibrationConfirmed;

  // Loading banner: show step-specific states
  const anyLoading = steps.index === "loading" || steps.revisions === "loading" || steps.drawings === "loading" || steps.files === "loading";
  const anyError = steps.index === "error" || steps.revisions === "error" || steps.drawings === "error" || steps.files === "error";
  const showLoadBanner = anyLoading || (anyError && sheets.length === 0);

  return (
    <div className="flex flex-col h-full">
      <StageHeader
        kicker="Stage 03"
        title="Scale Calibration"
        subtitle="Structural sheets drive takeoff. Architectural sheets are reference only — Structural always wins on conflicting dimensions."
        right={
          <div className="flex items-center gap-2">
            {hiddenCount > 0 && !showAll && (
              <span className="text-[11px] text-muted-foreground font-mono tabular-nums">
                {sheets.length} relevant · {hiddenCount} hidden
              </span>
            )}
            <label className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showAll}
                onChange={(e) => { setShowAll(e.target.checked); state.setLocal({ calibrationShowAll: e.target.checked }); }}
                className="h-3 w-3"
              />
              Show all sheets
            </label>
            <Button size="sm" variant="outline" onClick={load} disabled={loading}>
              {loading ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5 mr-1.5" />}
              {loading ? "Loading…" : "Re-detect"}
            </Button>
            {confirmed
              ? <Button size="sm" variant="outline" onClick={reset}>Re-open</Button>
              : <Button size="sm" disabled={!allConfirmable || loading || confirming} onClick={confirmAll}>
                  {confirming ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />}
                  {confirming ? "Confirming…" : "Confirm calibration"}
                </Button>}
          </div>
        }
      />

      {confirmed && (
        <div className="px-4 py-2 border-b border-border bg-[hsl(var(--status-supported))]/10 text-[12px] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-[hsl(var(--status-supported))]" />
          Calibration confirmed ({gateResolved}/{gateRows.length} sheets · {verifiedCount} verified). Takeoff can proceed.
          {goToStage && <Button size="sm" variant="ghost" className="ml-auto" onClick={() => goToStage("takeoff")}>Open Takeoff →</Button>}
        </div>
      )}

      {/* Step-specific load progress banner */}
      {showLoadBanner && (
        <div className="border-b border-border px-4 py-2 bg-card">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono mb-1.5">Loading steps</div>
          <div className="flex flex-wrap gap-3">
            {(["index", "revisions", "drawings", "files"] as const).map((key) => {
              const labels: Record<string, string> = { index: "OCR index", revisions: "Sheet revisions", drawings: "Drawing metadata", files: "File names" };
              const s = steps[key];
              const errMsg = steps.errors[key];
              return (
                <div key={key} className="flex items-center gap-1.5">
                  {s === "loading" && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
                  {s === "done" && <CheckCircle2 className="w-3 h-3 text-[hsl(var(--status-supported))]" />}
                  {s === "error" && (
                    <button
                      className="flex items-center gap-1 text-[hsl(var(--status-blocked))] hover:underline"
                      onClick={load}
                      title={errMsg ? `${errMsg} — click to retry this step` : "Retry this step"}
                    >
                      <AlertTriangle className="w-3 h-3" />
                      <span className="text-[10px] font-mono">retry</span>
                    </button>
                  )}
                  {s === "idle" && <span className="w-3 h-3 rounded-full border border-border inline-block" />}
                  <span className={`text-[11px] font-mono ${s === "error" ? "text-[hsl(var(--status-blocked))]" : s === "done" ? "text-muted-foreground" : "text-foreground"}`}>
                    {labels[key]}
                    {s === "error" && <span className="ml-1 opacity-70" title={errMsg}>failed</span>}
                  </span>
                </div>
              );
            })}
          </div>
          {anyError && (
            <div className="mt-2 space-y-1">
              {(() => {
                const labels: Record<string, string> = {
                  index: "Loading sheet index",
                  revisions: "Loading sheet revisions",
                  drawings: "Loading logical drawings",
                  files: "Loading document versions",
                };
                return (Object.entries(steps.errors) as Array<[keyof LoadSteps["errors"], string | undefined]>)
                  .filter(([, msg]) => !!msg)
                  .map(([key, msg]) => (
                    <div key={key} className="text-[11px] text-[hsl(var(--status-blocked))]">
                      {labels[key]}: {msg}
                    </div>
                  ));
              })()}
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[hsl(var(--status-blocked))]">Retry failed step(s) from this stage.</span>
                <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={load}>Retry</Button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-auto p-4">
        {loading && sheets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin" />
            <div className="text-[12px]">Loading sheets…</div>
          </div>
        ) : sheets.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
            <EmptyState title={emptyState.title || "No indexed sheets yet"} hint={emptyState.hint} />
            {goToStage && (
              <Button variant="outline" size="sm" onClick={() => goToStage("files")}>
                Review Stage 01
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            <DisciplineSection
              title="Sheets"
              subtitle="All sheets in one list. Use the discipline dropdown on each row to reclassify. Structural always wins on conflicting dimensions."
              tone="primary"
              rows={[...sheets].sort((a, b) => (a.page_number ?? 0) - (b.page_number ?? 0))}
              resolvedCount={sheets.filter(isCalibrated).length}
              verifiedCount={sheets.filter(isVerifiedOrManual).length}
              empty={<div className="text-[11px] text-muted-foreground px-1">No sheets.</div>}
              onUpdateOverride={updateOverride}
              onChangeDiscipline={setDiscipline}
              onAcceptScale={acceptScale}
              onMeasure={(r) => setTwoPointSheet(r)}
              onRetryMetadata={load}
              isNotApplicable={isNotApplicable}
              isLikelyCover={isLikelyCoverSheet}
              onToggleNotApplicable={toggleNotApplicable}
            />
          </div>
        )}
      </div>

      {!confirmed && (
        <div className="border-t border-border px-4 py-2 space-y-1.5">
          {allConfirmable && !hasVerified && (
            <div className="flex items-center gap-2 text-[11px] text-[hsl(var(--status-inferred))]">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>All scales are auto-detected. Click <strong>Accept</strong> on at least one sheet to verify, or use <strong>Measure</strong> for two-point measurement.</span>
            </div>
          )}
          {!allConfirmable && unresolvedRequired.length > 0 && (
            <div className="flex items-center gap-2 text-[11px] text-[hsl(var(--status-blocked))]">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>
                {unresolvedRequired.length} required sheet{unresolvedRequired.length === 1 ? "" : "s"} still need verification or manual calibration.
              </span>
            </div>
          )}
          <GateBanner
            tone={allConfirmable ? "warn" : "blocked"}
            title={allConfirmable
              ? hasVerified ? `Ready · ${verifiedCount}/${gateRows.length} verified` : "Ready (no sheets verified yet)"
              : gateRows.length === 0
                ? "No discipline-tagged sheets"
                : "Calibration required"}
            message={allConfirmable
              ? hasVerified
                ? "Scale verified by estimator — confirm to unlock takeoff."
                : "Auto-scaled only — accept or measure at least one sheet to confirm geometry, then confirm."
              : gateRows.length === 0
                ? "No discipline-tagged sheets. Reclassify at least one sheet, or confirm to proceed with the available pages."
                : `Calibrated (${gateResolved}/${gateRows.length}). Resolve ambiguous/failed or review-required sheets, then confirm.`}
          />
        </div>
      )}

      {twoPointSheet && (
        <TwoPointCalModal
          sheet={twoPointSheet}
          onClose={() => setTwoPointSheet(null)}
          onApply={(ppf) => applyTwoPoint(twoPointSheet.id, ppf)}
        />
      )}
    </div>
  );
}

// ── Scale-status pill ────────────────────────────────────────────────────────
const STATUS_PILL: Record<ScaleStatus, { tone: Parameters<typeof Pill>[0]["tone"]; label: string }> = {
  "auto-detected": { tone: "warn", label: "auto" },
  "verified": { tone: "supported", label: "verified" },
  "manual": { tone: "supported", label: "manual" },
  "ambiguous": { tone: "blocked", label: "ambiguous" },
  "failed": { tone: "blocked", label: "failed" },
};

// ── DisciplineSection ────────────────────────────────────────────────────────
function DisciplineSection({
  title, subtitle, tone, rows, resolvedCount, verifiedCount, empty,
  onUpdateOverride, onChangeDiscipline, onAcceptScale, onMeasure, onRetryMetadata,
  isNotApplicable, isLikelyCover, onToggleNotApplicable,
}: {
  title: string;
  subtitle: string;
  tone: "primary" | "muted";
  rows: SheetRow[];
  resolvedCount: number;
  verifiedCount: number;
  empty: React.ReactNode;
  onUpdateOverride: (id: string, value: string) => void;
  onChangeDiscipline: (id: string, value: Discipline) => void;
  onAcceptScale: (id: string) => void;
  onMeasure: (row: SheetRow) => void;
  onRetryMetadata?: () => void;
  isNotApplicable: (id: string) => boolean;
  isLikelyCover: (row: SheetRow) => boolean;
  onToggleNotApplicable: (id: string, value: boolean) => void;
}) {
  const accent = tone === "primary" ? "border-l-2 border-l-primary pl-3" : "border-l-2 border-l-border pl-3 opacity-90";
  return (
    <section className={accent}>
      <header className="flex items-baseline justify-between mb-2">
        <div>
          <div className="text-[11px] uppercase tracking-[0.16em] font-mono text-foreground">{title}</div>
          <div className="text-[11px] text-muted-foreground">{subtitle}</div>
        </div>
        <div className="text-[11px] font-mono text-muted-foreground tabular-nums">
          {resolvedCount}/{rows.length} resolved · {verifiedCount} verified
        </div>
      </header>
      {rows.length === 0 ? empty : (
        <div className="grid gap-2">
          {rows.map((r) => {
            const cal = r.calibration;
            const toneCal = !cal || cal.pixelsPerFoot === 0 ? "blocked" : cal.confidence === "high" || cal.confidence === "user" ? "supported" : cal.confidence === "medium" ? "inferred" : "blocked";
            const reclassified = r.discipline !== r.detectedDiscipline;
            const statusPill = STATUS_PILL[r.scale_status];
            const canAccept = r.scale_status === "auto-detected" && !!cal && cal.pixelsPerFoot > 0;
            const rowNeedsReview = requiresReview(r);
            const naFlag = isNotApplicable(r.id);
            const naReason = naFlag ? null : getNonScaledReason(r);
            const suggestNa = !!naReason;
            const naLabel = naReason === "schedule" ? "info-only sheet" : naReason === "notes" ? "notes / legend" : "looks like cover";
            return (
              <div
                key={r.id}
                className={`border bg-card px-3 py-2.5 flex items-center gap-3 ${
                  naFlag
                    ? "border-border opacity-60"
                    : suggestNa
                      ? "border-[hsl(var(--status-inferred))]/50"
                      : "border-border"
                }`}
              >
                <Ruler className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-semibold flex items-center gap-2 flex-wrap">
                    <span>Page {r.page_number ?? "—"}{r.sheet_number ? ` · ${r.sheet_number}` : ""}</span>
                    {naFlag ? (
                      <Pill tone="info">n/a</Pill>
                    ) : (
                      <>
                        <Pill tone={statusPill.tone}>{statusPill.label}</Pill>
                        <Pill tone={toneCal}>{cal ? cal.confidence : "none"}</Pill>
                      </>
                    )}
                    {cal?.source === "grid_dimension" && <Pill tone="info">grid</Pill>}
                    {cal?.source === "auto_dimension" && <Pill tone="info">auto-dimension</Pill>}
                    {reclassified && <Pill tone="info">reclassified</Pill>}
                    {!naFlag && rowNeedsReview && <Pill tone="blocked">needs review</Pill>}
                    {suggestNa && <Pill tone="warn">{naLabel}</Pill>}
                    {cal?.scaleText && <span className="text-[11px] text-muted-foreground font-mono truncate">{cal.scaleText}</span>}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{cal?.method || "No scale text detected — enter px/ft manually."}</div>
                  {r.scale_reason && (
                    <div className="text-[11px] text-[hsl(var(--status-blocked))] mt-0.5 flex items-center gap-2">
                      <span>{REASON_LABEL[r.scale_reason]}</span>
                      {r.scale_reason === "metadata load failed" && (
                        <button
                          className="underline hover:text-foreground"
                          onClick={() => onRetryMetadata?.()}
                          title="Re-fetch sheet metadata"
                        >
                          retry metadata
                        </button>
                      )}
                    </div>
                  )}
                  {cal?.detailOverrides && cal.detailOverrides.length > 0 && (
                    <details className="mt-1">
                      <summary className="text-[11px] text-muted-foreground cursor-pointer hover:text-foreground">
                        {cal.detailOverrides.length} detail scale{cal.detailOverrides.length === 1 ? "" : "s"} detected
                      </summary>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {cal.detailOverrides.map((d, i) => (
                          <span key={`${d.tag}-${i}`} className="inline-flex items-center gap-1 px-1.5 py-0.5 border border-border bg-background text-[11px] font-mono">
                            <span>{d.tag}</span>
                            <span className="text-muted-foreground">·</span>
                            <span>{d.scaleText}</span>
                            {d.nts && <Pill tone="warn">N.T.S.</Pill>}
                          </span>
                        ))}
                      </div>
                    </details>
                  )}
                  {r.diagnostics && (
                    <details className="mt-1">
                      <summary className="text-[11px] text-muted-foreground cursor-pointer hover:text-foreground">
                        diagnostics
                      </summary>
                      <dl className="mt-1 text-[11px] text-muted-foreground font-mono space-y-0.5">
                        <div>
                          <dt className="inline font-semibold">decision:</dt>{" "}
                          <dd className="inline">{r.diagnostics.decision}</dd>
                        </div>
                        <div>
                          <dt className="inline font-semibold">ocr:</dt>{" "}
                          <dd className="inline">{r.diagnostics.ocrLength} chars, scanned: {r.diagnostics.scannedLength} ({r.diagnostics.scannedSegments.join(", ")})</dd>
                        </div>
                        {r.diagnostics.matchedSheetScaleTexts.length > 0 && (
                          <div>
                            <dt className="inline font-semibold">sheet scales:</dt>{" "}
                            <dd className="inline">{r.diagnostics.matchedSheetScaleTexts.join(" | ")}</dd>
                          </div>
                        )}
                        {r.diagnostics.matchedDetailScaleTexts.length > 0 && (
                          <div>
                            <dt className="inline font-semibold">detail scales:</dt>{" "}
                            <dd className="inline">{r.diagnostics.matchedDetailScaleTexts.join(" | ")}</dd>
                          </div>
                        )}
                        {r.unmatchedTokens && r.unmatchedTokens.length > 0 && (
                          <div>
                            <dt className="inline font-semibold">unmatched marks:</dt>{" "}
                            <dd className="inline" title="Short alpha+digit tokens read by OCR that did not match any structural mark pattern">
                              {r.unmatchedTokens.slice(0, 20).join(", ")}
                              {r.unmatchedTokens.length > 20 ? `, +${r.unmatchedTokens.length - 20} more` : ""}
                            </dd>
                          </div>
                        )}
                      </dl>
                    </details>
                  )}
                </div>
                <select
                  value={r.discipline}
                  onChange={(e) => onChangeDiscipline(r.id, e.target.value as Discipline)}
                  className="h-7 px-1.5 border border-border bg-background text-[11px]"
                  title="Discipline"
                  disabled={naFlag}
                >
                  <option value="Structural">Structural</option>
                  <option value="Architectural">Architectural</option>
                  <option value="Other">Other</option>
                </select>
                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  px / ft
                  <input
                    value={r.ppfOverride}
                    onChange={(e) => onUpdateOverride(r.id, e.target.value)}
                    className="w-20 h-7 px-2 border border-border bg-background text-[12px] tabular-nums"
                    placeholder="—"
                    disabled={naFlag}
                  />
                </label>
                {!naFlag && canAccept && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px] shrink-0"
                    onClick={() => onAcceptScale(r.id)}
                    title="Accept auto-detected scale as verified"
                  >
                    Accept
                  </Button>
                )}
                {!naFlag && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px] gap-1 shrink-0"
                    onClick={() => onMeasure(r)}
                    title="Click two points on the drawing to measure a known distance"
                  >
                    <MousePointerClick className="w-3 h-3" />
                    Measure
                  </Button>
                )}
                {naFlag ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[11px] shrink-0"
                    onClick={() => onToggleNotApplicable(r.id, false)}
                    title="Restore this sheet to the calibration gate"
                  >
                    Undo N/A
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant={suggestNa ? "outline" : "ghost"}
                    className="h-7 text-[11px] shrink-0"
                    onClick={() => onToggleNotApplicable(r.id, true)}
                    title="Mark this sheet as not applicable for calibration (cover sheet, NTS, schematic)"
                  >
                    Mark N/A
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── Two-point calibration modal ──────────────────────────────────────────────
/** Module-level cache for signed URLs (1h TTL — matches createSignedUrl). */
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
const SIGNED_URL_TTL_MS = 55 * 60 * 1000; // refresh slightly before the 1h server expiry

function TwoPointCalModal({
  sheet,
  onClose,
  onApply,
}: {
  sheet: SheetRow;
  onClose: () => void;
  onApply: (ppf: number) => void;
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [rendered, setRendered] = useState<{ url: string; w: number; h: number } | null>(null);
  const [points, setPoints] = useState<[number, number][]>([]);
  const [realDist, setRealDist] = useState("");
  const [unit, setUnit] = useState<"ft" | "in" | "m" | "cm" | "mm">("ft");
  const [zoom, setZoom] = useState(1);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ active: boolean; moved: boolean; startX: number; startY: number; scrollLeft: number; scrollTop: number; pointerId: number }>({
    active: false, moved: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0, pointerId: -1,
  });

  const pageNumber = sheet.page_number ?? 1;

  // Reset rendered + points whenever the target sheet/page changes so we don't
  // leak the previously-rendered page across openings.
  useEffect(() => {
    setRendered(null);
    setPoints([]);
    setRealDist("");
    setUnit("ft");
    setZoom(1);
  }, [sheet.id, pageNumber]);

  // Fetch signed URL for the drawing file
  useEffect(() => {
    if (!sheet.file_path) {
      setUrlError("No file linked to this sheet. Use the px/ft input instead.");
      return;
    }
    const cached = signedUrlCache.get(sheet.file_path);
    if (cached && cached.expiresAt > Date.now()) {
      setSignedUrl(cached.url);
      return;
    }
    supabase.storage
      .from("blueprints")
      .createSignedUrl(sheet.file_path, 3600)
      .then(({ data, error }) => {
        if (error || !data?.signedUrl) {
          const detail = error?.message ? ` (${error.message})` : "";
          setUrlError(`Could not load drawing preview${detail}. Use the px/ft input instead.`);
        } else {
          signedUrlCache.set(sheet.file_path!, { url: data.signedUrl, expiresAt: Date.now() + SIGNED_URL_TTL_MS });
          setSignedUrl(data.signedUrl);
        }
      });
  }, [sheet.file_path]);

  const handlePageRendered = (dataUrl: string, w: number, h: number) => {
    setRendered({ url: dataUrl, w, h });
  };

  // Redraw overlay canvas whenever points or rendered image changes
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !rendered || !img) return;
    const displayW = img.clientWidth || rendered.w;
    const displayH = img.clientHeight || rendered.h;
    canvas.width = displayW;
    canvas.height = displayH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, displayW, displayH);

    // displayRatio = display pixels per rendered pixel (used to map stored rendered coords → canvas coords)
    const displayRatioX = displayW / rendered.w;
    const displayRatioY = displayH / rendered.h;

    for (const [px, py] of points) {
      const dx = px * displayRatioX;
      const dy = py * displayRatioY;
      ctx.beginPath();
      ctx.arc(dx, dy, 7, 0, 2 * Math.PI);
      ctx.fillStyle = "rgba(239,68,68,0.85)";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    if (points.length === 2) {
      const [[x1r, y1r], [x2r, y2r]] = points;
      ctx.beginPath();
      ctx.moveTo(x1r * displayRatioX, y1r * displayRatioY);
      ctx.lineTo(x2r * displayRatioX, y2r * displayRatioY);
      ctx.strokeStyle = "rgba(239,68,68,0.7)";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [points, rendered]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Suppress the click that ends a drag-pan gesture.
    if (panRef.current.moved) {
      panRef.current.moved = false;
      return;
    }
    if (points.length >= 2) {
      setPoints([]); // reset on 3rd click
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    // Convert display coords → rendered pixel coords (rendered.w/h are at scale=1 = native PDF pixels)
    const renderToDisplayX = rendered ? rendered.w / rect.width : 1;
    const renderToDisplayY = rendered ? rendered.h / rect.height : 1;
    const px = clickX * renderToDisplayX;
    const py = clickY * renderToDisplayY;
    setPoints((prev) => [...prev, [px, py]]);
  };

  const pixelDist =
    points.length === 2
      ? Math.sqrt(Math.pow(points[1][0] - points[0][0], 2) + Math.pow(points[1][1] - points[0][1], 2))
      : null;

  const UNIT_TO_FT: Record<typeof unit, number> = {
    ft: 1,
    in: 1 / 12,
    m: 3.28084,
    cm: 0.0328084,
    mm: 0.00328084,
  };
  const parsedVal = parseFloat(realDist);
  const parsedFt = parsedVal > 0 ? parsedVal * UNIT_TO_FT[unit] : 0;
  const computedPpf = pixelDist && parsedFt > 0 ? pixelDist / parsedFt : null;
  const unitPlaceholder: Record<typeof unit, string> = { ft: "e.g. 10", in: "e.g. 120", m: "e.g. 3", cm: "e.g. 300", mm: "e.g. 3000" };

  const label = `Page ${sheet.page_number ?? "—"}${sheet.sheet_number ? ` · ${sheet.sheet_number}` : ""}`;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl w-full h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 py-3 border-b border-border flex-row items-center justify-between shrink-0">
          <div>
            <DialogTitle className="text-sm font-semibold">Two-point scale measurement — {label}</DialogTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">Click two points on a known dimension. Enter the real-world distance to compute px/ft.</p>
          </div>
          <button onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </DialogHeader>

        <div
          ref={viewportRef}
          className="flex-1 overflow-auto relative bg-muted/30"
          onPointerDown={(e) => {
            if (!rendered) return;
            // Ignore non-primary buttons; allow middle-button always.
            if (e.button !== 0 && e.button !== 1) return;
            const vp = viewportRef.current;
            if (!vp) return;
            panRef.current = {
              active: true,
              moved: false,
              startX: e.clientX,
              startY: e.clientY,
              scrollLeft: vp.scrollLeft,
              scrollTop: vp.scrollTop,
              pointerId: e.pointerId,
            };
          }}
          onPointerMove={(e) => {
            const p = panRef.current;
            if (!p.active) return;
            const dx = e.clientX - p.startX;
            const dy = e.clientY - p.startY;
            if (!p.moved && Math.hypot(dx, dy) < 4) return;
            const vp = viewportRef.current;
            if (!vp) return;
            if (!p.moved) {
              p.moved = true;
              try { (e.currentTarget as HTMLDivElement).setPointerCapture(p.pointerId); } catch { /* noop */ }
              vp.style.cursor = "grabbing";
            }
            vp.scrollLeft = p.scrollLeft - dx;
            vp.scrollTop = p.scrollTop - dy;
          }}
          onPointerUp={(e) => {
            const p = panRef.current;
            if (p.active) {
              try { (e.currentTarget as HTMLDivElement).releasePointerCapture(p.pointerId); } catch { /* noop */ }
              p.active = false;
              const vp = viewportRef.current;
              if (vp) vp.style.cursor = "";
            }
          }}
          onPointerCancel={() => {
            panRef.current.active = false;
            panRef.current.moved = false;
            const vp = viewportRef.current;
            if (vp) vp.style.cursor = "";
          }}
          onWheel={(e) => {
            if (!rendered) return;
            if (!(e.ctrlKey || e.metaKey)) return;
            e.preventDefault();
            setZoom((z) => Math.max(0.25, Math.min(8, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))));
          }}
        >
          {rendered && (
            <div className="sticky top-2 z-10 ml-2 inline-flex items-center gap-1 bg-background/90 backdrop-blur border border-border rounded-sm px-1 py-1 shadow-sm">
              <button
                type="button"
                title="Zoom out"
                onClick={() => setZoom((z) => Math.max(0.25, z / 1.25))}
                className="p-1 hover:bg-muted text-foreground"
              ><ZoomOut className="w-3.5 h-3.5" /></button>
              <button
                type="button"
                title="Reset to 100%"
                onClick={() => setZoom(1)}
                className="px-1.5 text-[11px] font-mono tabular-nums hover:bg-muted text-foreground min-w-[3.25rem]"
              >{Math.round(zoom * 100)}%</button>
              <button
                type="button"
                title="Zoom in"
                onClick={() => setZoom((z) => Math.min(8, z * 1.25))}
                className="p-1 hover:bg-muted text-foreground"
              ><ZoomIn className="w-3.5 h-3.5" /></button>
              <button
                type="button"
                title="Fit to width"
                onClick={() => {
                  const vp = viewportRef.current;
                  const img = imgRef.current;
                  if (!vp || !img) return;
                  // img.clientWidth is the layout width (CSS transforms don't change it).
                  const layoutW = img.clientWidth;
                  if (layoutW > 0) setZoom(Math.max(0.25, Math.min(8, (vp.clientWidth - 16) / layoutW)));
                }}
                className="p-1 hover:bg-muted text-foreground"
              ><Maximize2 className="w-3.5 h-3.5" /></button>
            </div>
          )}
          {urlError ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground px-8 text-center">
              <AlertTriangle className="w-8 h-8" />
              <div className="text-[13px]">{urlError}</div>
            </div>
          ) : !signedUrl ? (
            <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-[12px]">Loading drawing…</span>
            </div>
          ) : !rendered ? (
            <div className="relative h-full">
              {/* PdfRenderer renders page 1 and calls onPageRendered; canvas stays hidden until done */}
              <div className="absolute inset-0 flex items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-[12px]">Rendering page…</span>
              </div>
              <PdfRenderer
                url={signedUrl}
                currentPage={pageNumber}
                scale={1}
                onPageRendered={handlePageRendered}
              />
            </div>
          ) : (
            <div
              className="relative inline-block"
              style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
            >
              <img
                ref={imgRef}
                src={rendered.url}
                alt={label}
                className="block max-w-full"
                style={{ userSelect: "none" }}
              />
              <canvas
                ref={canvasRef}
                onClick={handleCanvasClick}
                className="absolute inset-0 w-full h-full cursor-crosshair"
                style={{ touchAction: "none" }}
              />
            </div>
          )}
        </div>

        {/* Controls footer */}
        <div className="shrink-0 border-t border-border px-4 py-3 flex items-center gap-3 bg-card">
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground min-w-0">
            {points.length === 0 && <span>Click <strong>point 1</strong> on the drawing</span>}
            {points.length === 1 && <span>Click <strong>point 2</strong> on the drawing</span>}
            {points.length === 2 && pixelDist && (
              <span className="font-mono tabular-nums">{Math.round(pixelDist)} px measured</span>
            )}
          </div>
          {points.length === 2 && (
            <>
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground shrink-0">
                Known distance
                <input
                  type="number"
                  min="0.1"
                  step="any"
                  value={realDist}
                  onChange={(e) => setRealDist(e.target.value)}
                  className="w-24 h-7 px-2 border border-border bg-background text-[12px] tabular-nums"
                  placeholder={unitPlaceholder[unit]}
                  autoFocus
                />
                <select
                  value={unit}
                  onChange={(e) => setUnit(e.target.value as typeof unit)}
                  className="h-7 px-1.5 border border-border bg-background text-[12px]"
                >
                  <option value="ft">ft</option>
                  <option value="in">in</option>
                  <option value="m">m</option>
                  <option value="cm">cm</option>
                  <option value="mm">mm</option>
                </select>
              </label>
              {computedPpf && (
                <span className="text-[12px] font-mono text-muted-foreground tabular-nums">
                  = {computedPpf.toFixed(2)} px/ft
                </span>
              )}
            </>
          )}
          <div className="ml-auto flex gap-2">
            {points.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => setPoints([])}>Reset points</Button>
            )}
            <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              size="sm"
              disabled={!computedPpf}
              onClick={() => computedPpf && onApply(computedPpf)}
            >
              Apply {computedPpf ? `(${computedPpf.toFixed(2)} px/ft)` : ""}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
