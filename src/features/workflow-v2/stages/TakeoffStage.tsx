import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { StageHeader, Pill, EmptyState, type StageProps } from "./_shared";
import { Sparkles, FileText, CheckCircle2, Loader2, Wand2 } from "lucide-react";
import { loadWorkflowTakeoffRows, type WorkflowTakeoffRow } from "../takeoff-data";

export default function TakeoffStage({ projectId, state, goToStage }: StageProps) {
  const [rows, setRows] = useState<WorkflowTakeoffRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState<string>("");

  const reload = async () => {
    const mapped = await loadWorkflowTakeoffRows(projectId, state.files);
    setRows(mapped);
    setSelectedId((current) => mapped.find((row) => row.id === current)?.id || mapped[0]?.id || null);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const mapped = await loadWorkflowTakeoffRows(projectId, state.files);
      if (cancelled) return;
      setRows(mapped);
      setSelectedId((current) => mapped.find((row) => row.id === current)?.id || mapped[0]?.id || null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [projectId, state.files]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      // ── Step 1: Ensure project files are parsed & indexed ──
      const files = state.files || [];
      if (files.length > 0) {
        const { count: indexedCount } = await supabase
          .from("drawing_search_index")
          .select("id", { count: "exact", head: true })
          .eq("project_id", projectId);

        if (!indexedCount || indexedCount === 0) {
          setGenStatus(`Parsing ${files.length} file(s)...`);
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) throw new Error("Not authenticated");

          for (let i = 0; i < files.length; i++) {
            const f = files[i];
            setGenStatus(`Parsing ${i + 1}/${files.length}: ${f.file_name}`);
            try {
              const { data: urlData } = await supabase.storage
                .from("blueprints")
                .createSignedUrl(f.file_path, 3600);
              if (!urlData?.signedUrl) continue;

              // Ensure document_version row exists
              const legacyFileId = f.legacy_file_id || f.id;
              const { data: existingDv } = await supabase
                .from("document_versions")
                .select("id")
                .eq("file_id", legacyFileId)
                .maybeSingle();
              let dvId = existingDv?.id;
              if (!dvId) {
                const { data: newDv } = await supabase.from("document_versions").insert({
                  project_id: projectId,
                  user_id: user.id,
                  file_id: legacyFileId,
                  file_name: f.file_name,
                  file_path: f.file_path,
                  sha256: `pending_${Date.now()}_${legacyFileId}`,
                  source_system: "upload",
                }).select("id").single();
                dvId = newDv?.id;
              }

              const { data: extraction } = await supabase.functions.invoke("extract-pdf-text", {
                body: { pdf_url: urlData.signedUrl, project_id: projectId },
              });
              const pages = extraction?.pages || [];
              const sha256 = extraction?.sha256 || `file_${legacyFileId}`;
              if (pages.length > 0 && dvId) {
                await supabase.functions.invoke("populate-search-index", {
                  body: {
                    project_id: projectId,
                    document_version_id: dvId,
                    pages,
                    file_name: f.file_name,
                    sha256,
                    pipeline_file_id: legacyFileId,
                  },
                });
              }
            } catch (parseErr) {
              console.warn(`Parse failed for ${f.file_name}:`, parseErr);
            }
          }
        }
      }

      setGenStatus("Generating takeoff...");
      const { data: segs, error } = await supabase
        .from("segments")
        .select("id,name")
        .eq("project_id", projectId);
      if (error) throw error;
      const segments = segs || [];
      if (segments.length === 0) {
        toast.error("No approved scope segments found. Approve scope items in Stage 02 first.");
        return;
      }
      let ok = 0;
      let failed = 0;
      let totalItems = 0;
      for (const seg of segments) {
        try {
          const { data: estData, error: invokeErr } = await supabase.functions.invoke("auto-estimate", {
            body: { segment_id: seg.id, project_id: projectId },
          });
          if (invokeErr) throw invokeErr;
          const created = (estData as any)?.metadata?.items_created
            ?? (estData as any)?.items_created
            ?? (Array.isArray((estData as any)?.items) ? (estData as any).items.length : 0);
          totalItems += created || 0;
          ok++;
        } catch (err) {
          console.warn(`auto-estimate failed for segment ${seg.name}:`, err);
          failed++;
        }
      }
      if (ok > 0 && totalItems > 0) {
        toast.success(`Generated ${totalItems} takeoff item${totalItems > 1 ? "s" : ""} across ${ok} segment${ok > 1 ? "s" : ""}${failed ? ` (${failed} failed)` : ""}`);
      } else if (ok > 0 && totalItems === 0) {
        toast.warning("0 items generated — drawings may lack rebar data or parsing did not return text. Check Files tab to re-parse.");
      } else {
        toast.error("Takeoff generation failed for all segments.");
      }
      await reload();
      state.refresh();
    } finally {
      setGenerating(false);
      setGenStatus("");
    }
  };

  const sel = useMemo(() => rows.find((r) => r.id === selectedId), [rows, selectedId]);
  const totals = useMemo(() => ({
    rows: rows.length,
    weight: rows.reduce((s, r) => s + r.weight, 0),
    blocked: rows.filter((r) => r.status === "blocked").length,
  }), [rows]);

  return (
    <div className="grid h-full" style={{ gridTemplateColumns: "260px 1fr 340px" }}>
      <aside className="border-r border-border flex flex-col min-h-0" style={{ background: "hsl(var(--card))" }}>
        <div className="px-3 h-10 flex items-center border-b border-border">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]">
            <Sparkles className="w-3.5 h-3.5 text-primary" /> Estimator Copilot
          </div>
        </div>
        <div className="flex-1 overflow-auto p-3 space-y-3 text-[12px]">
          <div className="ip-card p-3">
            <div className="ip-kicker mb-1">Pending Changes</div>
            <div className="text-[11px] text-muted-foreground font-mono">No pending revisions</div>
          </div>
          <div className="ip-card p-3">
            <div className="flex items-center justify-between mb-1.5">
              <div className="ip-kicker">Issue Queue</div>
              {totals.blocked > 0 && <Pill tone="blocked" solid>{totals.blocked}</Pill>}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {totals.blocked === 0 ? "No blocking issues detected." : `${totals.blocked} row(s) below confidence threshold.`}
            </div>
          </div>
          <div className="ip-card p-3">
            <div className="ip-kicker mb-1.5">Copilot Notes</div>
            <div className="text-[11px] italic text-muted-foreground leading-relaxed">
              Click any row to inspect linked evidence and proof in the right panel.
            </div>
          </div>
        </div>
      </aside>

      <div className="border-r border-border flex flex-col min-h-0">
        <StageHeader
          kicker="Stage 03 - Production Takeoff Data"
          title="Takeoff Workspace"
          right={<div className="flex gap-2">
            <Pill tone="direct">{totals.rows} ROWS</Pill>
            <Pill tone="supported">{totals.weight.toFixed(0)} KG</Pill>
            {totals.blocked > 0 && <Pill tone="blocked" solid>{totals.blocked} BLOCKED</Pill>}
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 border border-primary text-primary text-[10px] font-mono uppercase tracking-wider hover:bg-primary/10 disabled:opacity-50"
            >
              {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
              {generating ? (genStatus || "Generating…") : rows.length === 0 ? "Generate Takeoff" : "Re-run"}
            </button>
          </div>}
        />
        <div className="flex-1 overflow-auto">
          {loading ? <EmptyState title="Loading takeoff..." /> :
            rows.length === 0 ? <EmptyState title="No takeoff rows" hint='Approve scope items in Stage 02, then click "Generate Takeoff" above.' /> : (
              <table className="w-full text-[12px] tabular-nums">
                <thead className="bg-muted/40 text-[10px] uppercase tracking-[0.14em] text-muted-foreground sticky top-0">
                  <tr>
                    <th className="text-left px-3 h-8 w-16">Item</th>
                    <th className="text-left px-3 h-8 w-14">Size</th>
                    <th className="text-left px-3 h-8">Shape</th>
                    <th className="text-right px-3 h-8 w-14">Qty</th>
                    <th className="text-right px-3 h-8 w-20">Length</th>
                    <th className="text-right px-3 h-8 w-20">Weight</th>
                    <th className="text-left px-3 h-8 w-24">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.id} onClick={() => setSelectedId(r.id)}
                      style={{ height: 32 }}
                      className={`border-t border-border cursor-pointer ${selectedId === r.id ? "bg-primary/10" : i % 2 ? "bg-card/30 hover:bg-accent/40" : "hover:bg-accent/40"}`}>
                      <td className="px-3 font-mono text-[hsl(var(--status-direct))]">{r.mark}</td>
                      <td className="px-3">{r.size}</td>
                      <td className="px-3 truncate max-w-0">{r.shape}</td>
                      <td className="px-3 text-right">{r.count}</td>
                      <td className="px-3 text-right">{r.length.toFixed(2)}</td>
                      <td className="px-3 text-right font-semibold">{r.weight.toFixed(1)}</td>
                      <td className="px-3">
                        {r.status === "ready" && <Pill tone="direct" solid>Direct</Pill>}
                        {r.status === "review" && <Pill tone="inferred" solid>Inferred</Pill>}
                        {r.status === "blocked" && <Pill tone="blocked" solid>Blocked</Pill>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      </div>

      <aside className="flex flex-col min-h-0" style={{ background: "hsl(var(--card))" }}>
        <div className="border-b border-border">
          <StageHeader kicker="Quantity Inspector" title={sel ? `Item ${sel.mark}` : "Select a row"} />
          <div className="flex border-t border-border text-[10px] uppercase tracking-[0.14em] font-semibold">
            {["Proof", "History", "Warnings", "RFI"].map((t, i) => (
              <button key={t} className={`flex-1 h-8 border-r border-border last:border-r-0 ${i === 0 ? "text-primary border-b-2 border-b-primary -mb-px" : "text-muted-foreground hover:text-foreground"}`}>{t}</button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-3">
          {!sel ? <EmptyState title="No row selected" /> : (
            <>
              <div>
                <div className="ip-kicker mb-2">1 - What This Is</div>
                <div className="ip-card p-3">
                  <div className="text-[13px] font-semibold">{sel.shape}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 font-mono">Item {sel.mark} - Bar {sel.size}</div>
                </div>
              </div>
              <div>
                <div className="ip-kicker mb-2">2 - Where It Came From</div>
                <div className="ip-card p-3 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary" />
                  <div className="flex-1 text-[12px] font-mono truncate">{sel.source}</div>
                </div>
              </div>
              <div>
                <div className="ip-kicker mb-2">3 - Calculated Total</div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Quantity" value={String(sel.count)} />
                  <Field label="Length (m)" value={sel.length.toFixed(2)} />
                  <Field label="Weight (kg)" value={sel.weight.toFixed(1)} />
                  <Field label="Source" value="Drawing" />
                </div>
              </div>
            </>
          )}
        </div>
        <div className="border-t border-border p-3">
          <button
            disabled={rows.length === 0}
            onClick={() => {
              state.refresh();
              goToStage?.("qa");
            }}
            className="w-full h-10 inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground text-[12px] font-semibold uppercase tracking-[0.14em] hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <CheckCircle2 className="w-4 h-4" /> Confirm Takeoff Data
          </button>
        </div>
      </aside>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border bg-background px-2 py-1.5">
      <div className="ip-kicker">{label}</div>
      <div className="truncate text-[12px] tabular-nums mt-0.5">{value}</div>
    </div>
  );
}
