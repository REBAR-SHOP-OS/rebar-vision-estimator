import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { StageHeader, Pill, EmptyState, type StageProps } from "./_shared";
import { Sparkles, FileText, CheckCircle2 } from "lucide-react";

interface Row {
  id: string;
  mark: string;
  size: string;
  shape: string;
  count: number;
  length: number;
  weight: number;
  status: "ready" | "review" | "blocked";
  source: string;
}

export default function TakeoffStage({ projectId, state }: StageProps) {
  const [rows, setRows] = useState<Row[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("estimate_items")
        .select("id, bar_size, description, quantity_count, total_length, total_weight, status, confidence")
        .eq("project_id", projectId).limit(500);
      if (cancelled) return;
      const mapped: Row[] = (data || []).map((d, i: number) => ({
        id: d.id,
        mark: `M${String(i + 1).padStart(3, "0")}`,
        size: d.bar_size || "—",
        shape: (d.description || "Straight").slice(0, 24),
        count: d.quantity_count || 0,
        length: Number(d.total_length || 0),
        weight: Number(d.total_weight || 0),
        status: (d.status === "approved" ? "ready" : Number(d.confidence) < 0.6 ? "blocked" : "review") as Row["status"],
        source: state.files[i % Math.max(1, state.files.length)]?.file_name || "—",
      }));
      setRows(mapped);
      setSelectedId(mapped[0]?.id || null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [projectId, state.files]);

  const sel = useMemo(() => rows.find((r) => r.id === selectedId), [rows, selectedId]);
  const totals = useMemo(() => ({
    rows: rows.length,
    weight: rows.reduce((s, r) => s + r.weight, 0),
    blocked: rows.filter((r) => r.status === "blocked").length,
  }), [rows]);

  return (
    <div className="grid h-full" style={{ gridTemplateColumns: "260px 1fr 340px" }}>
      {/* Estimator Copilot */}
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

      {/* Center table */}
      <div className="border-r border-border flex flex-col min-h-0">
        <StageHeader
          kicker="Stage 03 · Production Takeoff Data"
          title="Takeoff Workspace"
          right={<div className="flex gap-2">
            <Pill tone="direct">{totals.rows} ROWS</Pill>
            <Pill tone="supported">{totals.weight.toFixed(0)} KG</Pill>
            {totals.blocked > 0 && <Pill tone="blocked" solid>{totals.blocked} BLOCKED</Pill>}
          </div>}
        />
        <div className="flex-1 overflow-auto">
          {loading ? <EmptyState title="Loading takeoff…" /> :
            rows.length === 0 ? <EmptyState title="No takeoff rows" hint="Accept scope candidates and run extraction to populate." /> : (
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

      {/* Quantity Inspector */}
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
                <div className="ip-kicker mb-2">1 · What This Is</div>
                <div className="ip-card p-3">
                  <div className="text-[13px] font-semibold">{sel.shape}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 font-mono">Item {sel.mark} · Bar {sel.size}</div>
                </div>
              </div>
              <div>
                <div className="ip-kicker mb-2">2 · Where It Came From</div>
                <div className="ip-card p-3 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary" />
                  <div className="flex-1 text-[12px] font-mono truncate">{sel.source}</div>
                </div>
              </div>
              <div>
                <div className="ip-kicker mb-2">3 · Calculated Total</div>
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
          <button className="w-full h-10 inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground text-[12px] font-semibold uppercase tracking-[0.14em] hover:opacity-90">
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
