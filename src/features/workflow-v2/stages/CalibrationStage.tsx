import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { StageHeader, GateBanner, Pill, EmptyState, type StageProps } from "./_shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { resolveScale, type Calibration, type Discipline } from "../lib/scale-resolver";
import { detectDiscipline } from "@/lib/rebar-intake";
import { CheckCircle2, RefreshCcw, Ruler, AlertTriangle, Loader2, MousePointerClick, X } from "lucide-react";
import { toast } from "sonner";
import PdfRenderer from "@/components/chat/PdfRenderer";

export type ScaleStatus = "auto-detected" | "verified" | "manual" | "failed";

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
  if (!cal || cal.pixelsPerFoot <= 0) return "failed";
  if (cal.source === "user") return "manual";
  return "auto-detected";
}

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

export default function CalibrationStage({ projectId, state, goToStage }: StageProps) {
  const [sheets, setSheets] = useState<SheetRow[]>([]);
  const [steps, setSteps] = useState<LoadSteps>(initialSteps());
  const [confirming, setConfirming] = useState(false);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [showAll, setShowAll] = useState<boolean>(!!state.local.calibrationShowAll);
  const [twoPointSheet, setTwoPointSheet] = useState<SheetRow | null>(null);

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
    fn: () => Promise<T>,
  ): Promise<T> => {
    const start = performance.now();
    setStep(label, "loading");
    try {
      const result = await fn();
      const elapsed = performance.now() - start;
      if (elapsed > 3000) console.warn(`[CalibrationStage] step "${label}" took ${Math.round(elapsed)}ms`);
      setStep(label, "done");
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStep(label, "error", msg);
      throw err;
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
      indexRowsRaw = await timedFetch("index", async () => {
        const { data, error } = await supabase
          .from("drawing_search_index")
          .select("id, page_number, raw_text, sheet_revision_id, logical_drawing_id, document_version_id, bar_marks")
          .eq("project_id", projectId)
          .order("page_number", { ascending: true });
        if (error) throw error;
        return (data || []) as typeof indexRowsRaw;
      });
    } catch {
      return; // step error already set
    }

    const indexRows = indexRowsRaw.map((r) => ({ ...r, raw_text: (r.raw_text || "").slice(0, 4096) }));
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
      timedFetch("revisions", async () => {
        if (!sheetRevIds.length) return [] as RevRow[];
        const { data, error } = await supabase.from("sheet_revisions").select("id, sheet_number, discipline").in("id", sheetRevIds);
        if (error) throw error;
        return (data || []) as RevRow[];
      }),
      timedFetch("drawings", async () => {
        if (!logicalIds.length) return [] as LogicRow[];
        const { data, error } = await supabase.from("logical_drawings").select("id, sheet_id, discipline").in("id", logicalIds);
        if (error) throw error;
        return (data || []) as LogicRow[];
      }),
      timedFetch("files", async () => {
        if (!docVerIds.length) return [] as DocRow[];
        const { data, error } = await supabase.from("document_versions").select("id, file_name, file_path").in("id", docVerIds);
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
      const autoCal = resolveScale({ rawText: r.raw_text || "" });
      const cal = storedCal || autoCal;
      const scaleStatus = deriveScaleStatus(cal, storedStatuses[r.id]);
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
        scale_status: scaleStatus,
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
    for (const r of rows) {
      if (r.calibration) calMap[r.id] = r.calibration;
      statusMap[r.id] = r.scale_status;
    }
    if (Object.keys(calMap).length > 0) state.setLocal({ calibration: calMap, scaleStatus: statusMap });
  };

  useEffect(() => {
    load();
  }, [projectId, showAll]); // load is intentionally stable; deps are projectId and showAll

  const persist = (next: SheetRow[]) => {
    const calMap: Record<string, Calibration> = {};
    const statusMap: Record<string, ScaleStatus> = {};
    for (const r of next) {
      if (r.calibration) calMap[r.id] = r.calibration;
      statusMap[r.id] = r.scale_status;
    }
    state.setLocal({ calibration: calMap, scaleStatus: statusMap });
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
        return { ...r, ppfOverride: value, calibration: cal, scale_status };
      });
      persist(next);
      return next;
    });
  };

  const acceptScale = (id: string) => {
    setSheets((prev) => {
      const next = prev.map((r) =>
        r.id === id ? { ...r, scale_status: "verified" as ScaleStatus } : r,
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
        return { ...r, calibration: cal, ppfOverride: ppf.toFixed(2), scale_status: "manual" as ScaleStatus };
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
  const gateRows = (structural.length + architectural.length > 0)
    ? [...structural, ...architectural]
    : sheets;
  const isResolved = (r: SheetRow) => !!r.calibration && r.calibration.pixelsPerFoot > 0;
  const isVerifiedOrManual = (r: SheetRow) => r.scale_status === "verified" || r.scale_status === "manual";
  const structuralResolved = structural.filter(isResolved).length;
  const gateResolved = gateRows.filter(isResolved).length;
  const verifiedCount = gateRows.filter(isVerifiedOrManual).length;
  const allConfirmable = gateRows.length > 0 && gateRows.every(isResolved);
  const hasVerified = verifiedCount > 0;

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
                      className="flex items-center gap-1 text-[hsl(var(--status-blocked))]"
                      onClick={load}
                      title={errMsg || "Retry all"}
                    >
                      <AlertTriangle className="w-3 h-3" />
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
          {anyError && sheets.length === 0 && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[11px] text-[hsl(var(--status-blocked))]">One or more steps failed. Partial data may be shown.</span>
              <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={load}>Retry all</Button>
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
          <EmptyState title="No indexed sheets yet" hint="Upload and parse drawings in Stage 01 first." />
        ) : (
          <div className="space-y-5">
            <DisciplineSection
              title="Structural"
              subtitle="Required for takeoff — every sheet must resolve to a usable px/ft."
              tone="primary"
              rows={structural}
              resolvedCount={structuralResolved}
              verifiedCount={structural.filter(isVerifiedOrManual).length}
              empty={
                <div className="flex items-center gap-2 px-3 py-2.5 border border-[hsl(var(--status-inferred))]/40 bg-[hsl(var(--status-inferred))]/5 text-[12px]">
                  <AlertTriangle className="w-4 h-4 text-[hsl(var(--status-inferred))]" />
                  <span className="flex-1">No Structural sheets detected. Architectural sheets will be used for calibration; reclassify any sheet below if needed.</span>
                  {sheets.length > 0 && (
                    <Button size="sm" variant="outline" onClick={promoteAllToStructural}>Mark all as Structural</Button>
                  )}
                </div>
              }
              onUpdateOverride={updateOverride}
              onChangeDiscipline={setDiscipline}
              onAcceptScale={acceptScale}
              onMeasure={(r) => setTwoPointSheet(r)}
            />
            <DisciplineSection
              title="Architectural / Reference"
              subtitle="Required for takeoff — every Architectural sheet must also resolve to a usable px/ft. Structural still wins on conflicting dimensions."
              tone="muted"
              rows={reference}
              resolvedCount={reference.filter(isResolved).length}
              verifiedCount={reference.filter(isVerifiedOrManual).length}
              empty={<div className="text-[11px] text-muted-foreground px-1">No reference sheets.</div>}
              onUpdateOverride={updateOverride}
              onChangeDiscipline={setDiscipline}
              onAcceptScale={acceptScale}
              onMeasure={(r) => setTwoPointSheet(r)}
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
                : `Auto-scaled (${gateResolved}/${gateRows.length}). Override any sheet below if needed, then confirm.`}
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
  "failed": { tone: "blocked", label: "failed" },
};

// ── DisciplineSection ────────────────────────────────────────────────────────
function DisciplineSection({
  title, subtitle, tone, rows, resolvedCount, verifiedCount, empty,
  onUpdateOverride, onChangeDiscipline, onAcceptScale, onMeasure,
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
            return (
              <div key={r.id} className="border border-border bg-card px-3 py-2.5 flex items-center gap-3">
                <Ruler className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-semibold flex items-center gap-2 flex-wrap">
                    <span>Page {r.page_number ?? "—"}{r.sheet_number ? ` · ${r.sheet_number}` : ""}</span>
                    <Pill tone={statusPill.tone}>{statusPill.label}</Pill>
                    <Pill tone={toneCal}>{cal ? cal.confidence : "none"}</Pill>
                    {cal?.source === "grid_dimension" && <Pill tone="info">grid</Pill>}
                    {cal?.source === "auto_dimension" && <Pill tone="info">auto-dim</Pill>}
                    {reclassified && <Pill tone="info">reclassified</Pill>}
                    {cal?.scaleText && <span className="text-[11px] text-muted-foreground font-mono truncate">{cal.scaleText}</span>}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{cal?.method || "No scale text detected — enter px/ft manually."}</div>
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
                </div>
                <select
                  value={r.discipline}
                  onChange={(e) => onChangeDiscipline(r.id, e.target.value as Discipline)}
                  className="h-7 px-1.5 border border-border bg-background text-[11px]"
                  title="Discipline"
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
                  />
                </label>
                {canAccept && (
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
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── Two-point calibration modal ──────────────────────────────────────────────
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Fetch signed URL for the drawing file
  useEffect(() => {
    if (!sheet.file_path) {
      setUrlError("No file linked to this sheet. Use the px/ft input instead.");
      return;
    }
    supabase.storage
      .from("blueprints")
      .createSignedUrl(sheet.file_path, 3600)
      .then(({ data, error }) => {
        if (error || !data?.signedUrl) {
          setUrlError("Could not load drawing preview. Use the px/ft input instead.");
        } else {
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

    const scaleX = displayW / rendered.w;
    const scaleY = displayH / rendered.h;

    for (const [px, py] of points) {
      const dx = px * scaleX;
      const dy = py * scaleY;
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
      ctx.moveTo(x1r * scaleX, y1r * scaleY);
      ctx.lineTo(x2r * scaleX, y2r * scaleY);
      ctx.strokeStyle = "rgba(239,68,68,0.7)";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [points, rendered]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (points.length >= 2) {
      setPoints([]); // reset on 3rd click
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const displayW = rect.width;
    const displayH = rect.height;
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    // Convert display coords → rendered pixel coords
    const px = rendered ? clickX * (rendered.w / displayW) : clickX;
    const py = rendered ? clickY * (rendered.h / displayH) : clickY;
    setPoints((prev) => [...prev, [px, py]]);
  };

  const pixelDist =
    points.length === 2
      ? Math.sqrt(Math.pow(points[1][0] - points[0][0], 2) + Math.pow(points[1][1] - points[0][1], 2))
      : null;

  const parsedFt = parseFloat(realDist);
  const computedPpf = pixelDist && parsedFt > 0 ? pixelDist / parsedFt : null;

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

        <div className="flex-1 overflow-auto relative bg-muted/30">
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
                currentPage={1}
                scale={1}
                onPageRendered={handlePageRendered}
              />
            </div>
          ) : (
            <div className="relative inline-block max-w-full">
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
                Known distance (ft)
                <input
                  type="number"
                  min="0.1"
                  step="0.5"
                  value={realDist}
                  onChange={(e) => setRealDist(e.target.value)}
                  className="w-24 h-7 px-2 border border-border bg-background text-[12px] tabular-nums"
                  placeholder="e.g. 10"
                  autoFocus
                />
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
