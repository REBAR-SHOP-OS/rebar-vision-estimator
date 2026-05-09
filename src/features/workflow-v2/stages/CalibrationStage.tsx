import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { StageHeader, GateBanner, Pill, EmptyState, type StageProps } from "./_shared";
import { Button } from "@/components/ui/button";
import { resolveScale, type Calibration } from "../lib/scale-resolver";
import { CheckCircle2, RefreshCcw, Ruler } from "lucide-react";

interface SheetRow {
  id: string;
  page_number: number | null;
  sheet_number: string | null;
  raw_text: string;
  calibration: Calibration | null;
  ppfOverride: string;
}

export default function CalibrationStage({ projectId, state, goToStage }: StageProps) {
  const [sheets, setSheets] = useState<SheetRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("drawing_search_index")
      .select("id, page_number, raw_text, sheet_revision_id")
      .eq("project_id", projectId)
      .order("page_number", { ascending: true });
    const rows: SheetRow[] = (data || []).map((r: any) => {
      const cal = resolveScale({ rawText: r.raw_text || "" });
      return {
        id: r.id,
        page_number: r.page_number,
        sheet_number: r.sheet_revision_id,
        raw_text: r.raw_text || "",
        calibration: cal,
        ppfOverride: cal && cal.pixelsPerFoot > 0 ? cal.pixelsPerFoot.toFixed(2) : "",
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

  const allConfirmable = sheets.length > 0 && sheets.every((r) => r.calibration && r.calibration.pixelsPerFoot > 0 && r.calibration.confidence !== "low");

  const confirmAll = () => {
    state.setLocal({ calibrationConfirmed: true });
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
        subtitle="Detect each sheet's drawing scale before takeoff. Quantities are derived from real-world lengths, not pixels."
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
          Calibration confirmed for this project. Takeoff can proceed.
          {goToStage && <Button size="sm" variant="ghost" className="ml-auto" onClick={() => goToStage("takeoff")}>Open Takeoff →</Button>}
        </div>
      )}

      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <EmptyState title="Loading sheets…" />
        ) : sheets.length === 0 ? (
          <EmptyState title="No indexed sheets yet" hint="Upload and parse drawings in Stage 01 first." />
        ) : (
          <div className="grid gap-2">
            {sheets.map((r) => {
              const cal = r.calibration;
              const tone = !cal || cal.pixelsPerFoot === 0 ? "blocked" : cal.confidence === "high" || cal.confidence === "user" ? "supported" : cal.confidence === "medium" ? "inferred" : "blocked";
              return (
                <div key={r.id} className="border border-border bg-card px-3 py-2.5 flex items-center gap-3">
                  <Ruler className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-semibold flex items-center gap-2">
                      <span>Page {r.page_number ?? "—"}</span>
                      <Pill tone={tone}>{cal ? cal.confidence : "none"}</Pill>
                      {cal?.scaleText && <span className="text-[11px] text-muted-foreground font-mono truncate">{cal.scaleText}</span>}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{cal?.method || "No scale text detected — enter px/ft manually."}</div>
                  </div>
                  <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    px / ft
                    <input
                      value={r.ppfOverride}
                      onChange={(e) => updateOverride(r.id, e.target.value)}
                      className="w-24 h-7 px-2 border border-border bg-background text-[12px] tabular-nums"
                      placeholder="—"
                    />
                  </label>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {!confirmed && (
        <div className="border-t border-border px-4 py-2">
          <GateBanner
            tone={allConfirmable ? "warn" : "blocked"}
            title={allConfirmable ? "Ready to confirm" : "Calibration required"}
            message={allConfirmable
              ? "Every sheet has a usable scale. Confirm to unlock Takeoff."
              : "Resolve every sheet (high/medium confidence or estimator override) before continuing."}
          />
        </div>
      )}
    </div>
  );
}
