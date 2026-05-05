import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { StageHeader, Pill, EmptyState, type StageProps } from "./_shared";

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
      const mapped: Row[] = (data || []).map((d: any, i: number) => ({
        id: d.id,
        mark: `M${String(i + 1).padStart(3, "0")}`,
        size: d.bar_size || "—",
        shape: (d.description || "Straight").slice(0, 18),
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
    <div className="grid grid-cols-12 h-full">
      <div className="col-span-8 border-r border-border flex flex-col min-h-0">
        <StageHeader
          kicker="Stage 03"
          title="Takeoff Workspace"
          subtitle="Traceable quantity rows. Edit and verify here. Every row links to drawing evidence."
          right={<div className="flex gap-2">
            <Pill tone="info">{totals.rows} rows</Pill>
            <Pill tone="ok">{totals.weight.toFixed(0)} kg</Pill>
            {totals.blocked > 0 && <Pill tone="bad">{totals.blocked} blocked</Pill>}
          </div>}
        />
        <div className="flex-1 overflow-auto">
          {loading ? <EmptyState title="Loading takeoff..." /> :
            rows.length === 0 ? <EmptyState title="No takeoff rows" hint="Accept scope candidates and run extraction to populate." /> : (
            <table className="w-full text-xs font-mono">
              <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground sticky top-0">
                <tr>
                  <th className="text-left px-2 py-2 w-16">Mark</th>
                  <th className="text-left px-2 py-2 w-14">Size</th>
                  <th className="text-left px-2 py-2">Shape</th>
                  <th className="text-right px-2 py-2 w-14">Qty</th>
                  <th className="text-right px-2 py-2 w-20">Length (m)</th>
                  <th className="text-right px-2 py-2 w-20">Wt (kg)</th>
                  <th className="text-left px-2 py-2 w-20">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} onClick={() => setSelectedId(r.id)}
                    className={`border-t border-border cursor-pointer ${selectedId === r.id ? "bg-primary/5" : "hover:bg-muted/30"}`}>
                    <td className="px-2 py-1.5">{r.mark}</td>
                    <td className="px-2 py-1.5">{r.size}</td>
                    <td className="px-2 py-1.5 truncate max-w-0">{r.shape}</td>
                    <td className="px-2 py-1.5 text-right">{r.count}</td>
                    <td className="px-2 py-1.5 text-right">{r.length.toFixed(2)}</td>
                    <td className="px-2 py-1.5 text-right">{r.weight.toFixed(1)}</td>
                    <td className="px-2 py-1.5">
                      {r.status === "ready" && <Pill tone="ok">Ready</Pill>}
                      {r.status === "review" && <Pill tone="warn">Review</Pill>}
                      {r.status === "blocked" && <Pill tone="bad">Blocked</Pill>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="col-span-4 flex flex-col min-h-0 bg-muted/20">
        <StageHeader kicker="Inspector" title={sel ? `Row ${sel.mark}` : "Select a row"} />
        <div className="flex-1 overflow-auto p-4 space-y-3">
          {!sel ? <EmptyState title="No row selected" /> : (
            <>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <Field label="Mark" value={sel.mark} />
                <Field label="Size" value={sel.size} />
                <Field label="Shape" value={sel.shape} />
                <Field label="Count" value={String(sel.count)} />
                <Field label="Length (m)" value={sel.length.toFixed(2)} />
                <Field label="Weight (kg)" value={sel.weight.toFixed(1)} />
              </div>
              <div className="border border-border bg-card p-3">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Drawing Evidence</div>
                <div className="text-xs font-mono truncate">{sel.source}</div>
              </div>
              <div className="border border-border bg-card p-3">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Pending Changes</div>
                <div className="text-xs text-muted-foreground">No pending changes</div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border bg-card px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="truncate">{value}</div>
    </div>
  );
}