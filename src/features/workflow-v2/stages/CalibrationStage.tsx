import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { StageHeader, GateBanner, Pill, EmptyState, type StageProps } from "./_shared";
import { Button } from "@/components/ui/button";
import { resolveScale, type Calibration, type Discipline } from "../lib/scale-resolver";
import { detectDiscipline } from "@/lib/rebar-intake";
import { CheckCircle2, RefreshCcw, Ruler, AlertTriangle } from "lucide-react";

interface SheetRow {
  id: string;
  page_number: number | null;
  sheet_number: string | null;
  raw_text: string;
  calibration: Calibration | null;
  ppfOverride: string;
  detectedDiscipline: Discipline;
  discipline: Discipline; // effective (override > detected)
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

export default function CalibrationStage({ projectId, state, goToStage }: StageProps) {
  const [sheets, setSheets] = useState<SheetRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("drawing_search_index")
      .select("id, page_number, raw_text, sheet_revision_id, logical_drawing_id, document_version_id")
      .eq("project_id", projectId)
      .order("page_number", { ascending: true });
    const indexRows = (data || []) as Array<{ id: string; page_number: number | null; raw_text: string | null; sheet_revision_id: string | null; logical_drawing_id: string | null; document_version_id: string | null }>;
    const sheetRevIds = Array.from(new Set(indexRows.map((r) => r.sheet_revision_id).filter(Boolean) as string[]));
    const logicalIds = Array.from(new Set(indexRows.map((r) => r.logical_drawing_id).filter(Boolean) as string[]));
    const docVerIds = Array.from(new Set(indexRows.map((r) => r.document_version_id).filter(Boolean) as string[]));
    const [revRes, logicRes, docRes] = await Promise.all([
      sheetRevIds.length ? supabase.from("sheet_revisions").select("id, sheet_number, discipline").in("id", sheetRevIds) : Promise.resolve({ data: [] as any[] }),
      logicalIds.length ? supabase.from("logical_drawings").select("id, sheet_id, discipline").in("id", logicalIds) : Promise.resolve({ data: [] as any[] }),
      docVerIds.length ? supabase.from("document_versions").select("id, file_name").in("id", docVerIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    const revMap = new Map<string, { sheet_number: string | null; discipline: string | null }>((revRes.data || []).map((r: any) => [r.id, { sheet_number: r.sheet_number, discipline: r.discipline }]));
    const logicMap = new Map<string, { sheet_id: string | null; discipline: string | null }>((logicRes.data || []).map((r: any) => [r.id, { sheet_id: r.sheet_id, discipline: r.discipline }]));
    const docMap = new Map<string, string>((docRes.data || []).map((r: any) => [r.id, r.file_name]));
    const overrideMap = (state.local.disciplineOverride || {}) as Record<string, Discipline>;
    const rows: SheetRow[] = indexRows.map((r) => {
      const rev = r.sheet_revision_id ? revMap.get(r.sheet_revision_id) : undefined;
      const logic = r.logical_drawing_id ? logicMap.get(r.logical_drawing_id) : undefined;
      const fileName = r.document_version_id ? docMap.get(r.document_version_id) : undefined;
      const sheetNumber = rev?.sheet_number || logic?.sheet_id || null;
      const tableDiscipline = rev?.discipline || logic?.discipline || null;
      const detected = detectSheetDiscipline({ fileName, sheetNumber, rawText: r.raw_text, tableDiscipline });
      const override = overrideMap[r.id];
      const cal = resolveScale({ rawText: r.raw_text || "" });
      return {
        id: r.id,
        page_number: r.page_number,
        sheet_number: sheetNumber,
        raw_text: r.raw_text || "",
        calibration: cal,
        ppfOverride: cal && cal.pixelsPerFoot > 0 ? cal.pixelsPerFoot.toFixed(2) : "",
        detectedDiscipline: detected,
        discipline: override || detected,
      };
    });
    // hydrate from local
    const stored = (state.local.calibration || {}) as Record<string, Calibration>;
    for (const r of rows) {
      const s = stored[r.id];
      if (s) {
        r.calibration = s;
        r.ppfOverride = String(s.pixelsPerFoot.toFixed(2));
      }
    }
    setSheets(rows);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const persist = (next: SheetRow[]) => {
    const map: Record<string, Calibration> = {};
    for (const r of next) if (r.calibration) map[r.id] = r.calibration;
    state.setLocal({ calibration: map });
  };

  const updateOverride = (id: string, value: string) => {
    setSheets((prev) => {
      const next = prev.map((r) => {
        if (r.id !== id) return r;
        const ppf = Number(value);
        const cal: Calibration | null = Number.isFinite(ppf) && ppf > 0
          ? { source: "user", pixelsPerFoot: ppf, confidence: "user", method: "Estimator override" }
          : r.calibration;
        return { ...r, ppfOverride: value, calibration: cal };
      });
      persist(next);
      return next;
    });
  };

  const setDiscipline = (id: string, value: Discipline) => {
    setSheets((prev) => prev.map((r) => (r.id === id ? { ...r, discipline: value } : r)));
    const cur = (state.local.disciplineOverride || {}) as Record<string, Discipline>;
    state.setLocal({ disciplineOverride: { ...cur, [id]: value }, calibrationPrimary: "structural" });
  };

  const structural = sheets.filter((r) => r.discipline === "Structural");
  const reference = sheets.filter((r) => r.discipline !== "Structural");
  const isResolved = (r: SheetRow) => !!r.calibration && r.calibration.pixelsPerFoot > 0 && r.calibration.confidence !== "low";
  const structuralResolved = structural.filter(isResolved).length;
  const allConfirmable = structural.length > 0 && structural.every(isResolved);

  const confirmAll = () => {
    state.setLocal({ calibrationConfirmed: true, calibrationPrimary: "structural" });
    state.refresh();
  };
  const reset = () => {
    state.setLocal({ calibrationConfirmed: false });
    state.refresh();
  };

  const confirmed = !!state.local.calibrationConfirmed;

  return (
    <div className="flex flex-col h-full">
      <StageHeader
        kicker="Stage 03"
        title="Scale Calibration"
        subtitle="Structural sheets drive takeoff. Architectural sheets are reference only — Structural always wins on conflicting dimensions."
        right={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={load}><RefreshCcw className="w-3.5 h-3.5 mr-1.5" /> Re-detect</Button>
            {confirmed
              ? <Button size="sm" variant="outline" onClick={reset}>Re-open</Button>
              : <Button size="sm" disabled={!allConfirmable} onClick={confirmAll}><CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Confirm calibration</Button>}
          </div>
        }
      />

      {confirmed && (
        <div className="px-4 py-2 border-b border-border bg-[hsl(var(--status-supported))]/10 text-[12px] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-[hsl(var(--status-supported))]" />
          Structural calibration confirmed ({structuralResolved}/{structural.length} sheets). Takeoff can proceed.
          {goToStage && <Button size="sm" variant="ghost" className="ml-auto" onClick={() => goToStage("takeoff")}>Open Takeoff →</Button>}
        </div>
      )}

      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <EmptyState title="Loading sheets…" />
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
              empty={
                <div className="flex items-center gap-2 px-3 py-2.5 border border-[hsl(var(--status-blocked))]/40 bg-[hsl(var(--status-blocked))]/5 text-[12px]">
                  <AlertTriangle className="w-4 h-4 text-[hsl(var(--status-blocked))]" />
                  No Structural sheets detected. Reclassify a reference sheet below or upload structural drawings before takeoff.
                </div>
              }
              onUpdateOverride={updateOverride}
              onChangeDiscipline={setDiscipline}
            />
            <DisciplineSection
              title="Architectural / Reference"
              subtitle="Shown for context. Not required for the takeoff gate. Reclassify if structural intent is documented here."
              tone="muted"
              rows={reference}
              resolvedCount={reference.filter(isResolved).length}
              empty={<div className="text-[11px] text-muted-foreground px-1">No reference sheets.</div>}
              onUpdateOverride={updateOverride}
              onChangeDiscipline={setDiscipline}
            />
          </div>
        )}
      </div>

      {!confirmed && (
        <div className="border-t border-border px-4 py-2">
          <GateBanner
            tone={allConfirmable ? "warn" : "blocked"}
            title={allConfirmable ? "Ready to confirm" : structural.length === 0 ? "No Structural sheets detected" : "Structural calibration required"}
            message={allConfirmable
              ? "Every Structural sheet has a usable scale. Architectural sheets are reference only. Confirm to unlock Takeoff."
              : structural.length === 0
                ? "Reclassify at least one sheet as Structural, or upload structural drawings, before takeoff can run."
                : `Resolve every Structural sheet (${structuralResolved}/${structural.length} done). Architectural sheets are skipped from this gate.`}
          />
        </div>
      )}
    </div>
  );
}

function DisciplineSection({
  title, subtitle, tone, rows, resolvedCount, empty, onUpdateOverride, onChangeDiscipline,
}: {
  title: string;
  subtitle: string;
  tone: "primary" | "muted";
  rows: SheetRow[];
  resolvedCount: number;
  empty: React.ReactNode;
  onUpdateOverride: (id: string, value: string) => void;
  onChangeDiscipline: (id: string, value: Discipline) => void;
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
          {resolvedCount}/{rows.length} resolved
        </div>
      </header>
      {rows.length === 0 ? empty : (
        <div className="grid gap-2">
          {rows.map((r) => {
            const cal = r.calibration;
            const toneCal = !cal || cal.pixelsPerFoot === 0 ? "blocked" : cal.confidence === "high" || cal.confidence === "user" ? "supported" : cal.confidence === "medium" ? "inferred" : "blocked";
            const reclassified = r.discipline !== r.detectedDiscipline;
            return (
              <div key={r.id} className="border border-border bg-card px-3 py-2.5 flex items-center gap-3">
                <Ruler className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-semibold flex items-center gap-2 flex-wrap">
                    <span>Page {r.page_number ?? "—"}{r.sheet_number ? ` · ${r.sheet_number}` : ""}</span>
                    <Pill tone={toneCal}>{cal ? cal.confidence : "none"}</Pill>
                    {cal?.source === "grid_dimension" && <Pill tone="info">grid</Pill>}
                    {cal?.source === "auto_dimension" && <Pill tone="info">auto</Pill>}
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
                    className="w-24 h-7 px-2 border border-border bg-background text-[12px] tabular-nums"
                    placeholder="—"
                  />
                </label>
                {cal?.source === "auto_dimension" && cal.pixelsPerFoot > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px]"
                    onClick={() => onUpdateOverride(r.id, cal.pixelsPerFoot.toFixed(2))}
                    title="Accept auto-inferred px/ft and mark as confirmed"
                  >
                    Use auto value
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
