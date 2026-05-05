import { useMemo, useState } from "react";
import { StageHeader, Pill, EmptyState, type StageProps } from "./_shared";
import { Check, Pause, Shuffle } from "lucide-react";

type Decision = "accept" | "hold" | "reroute";

interface Candidate {
  id: string;
  label: string;
  source: string;
  confidence: number;
  evidence: string;
}

export default function ScopeStage({ state }: StageProps) {
  const candidates: Candidate[] = useMemo(() => {
    if (state.files.length === 0) return [];
    const archetypes = [
      { label: "Footings — Strip & Pad", evidence: "Foundation plan dimensions + schedule" },
      { label: "Walls — Foundation/Retaining", evidence: "Wall sections, elevation marks" },
      { label: "Slabs on Grade", evidence: "Plan hatching + slab schedule" },
      { label: "Suspended Slabs / Decks", evidence: "Floor framing plans" },
      { label: "Columns & Piers", evidence: "Column schedule + section detail" },
      { label: "Grade Beams", evidence: "Foundation plan + beam schedule" },
      { label: "Stairs", evidence: "Architectural stair details" },
    ];
    return state.files.flatMap((f, i) =>
      archetypes.slice(0, 3 + (i % 3)).map((a, j) => ({
        id: `${f.id}::${j}`,
        label: a.label,
        source: f.file_name,
        confidence: Math.max(0.55, Math.min(0.97, 0.7 + ((j + i) % 5) * 0.05)),
        evidence: a.evidence,
      }))
    );
  }, [state.files]);

  const decisions = (state.local.scope || {}) as Record<string, Decision>;
  const [selectedId, setSelectedId] = useState<string | null>(candidates[0]?.id || null);
  const sel = candidates.find((c) => c.id === selectedId) || null;

  const setDecision = (id: string, d: Decision) => {
    state.setLocal({ scope: { ...decisions, [id]: d } });
  };

  return (
    <div className="grid grid-cols-12 h-full">
      <div className="col-span-8 border-r border-border flex flex-col min-h-0">
        <StageHeader
          kicker="Stage 02"
          title="Scope Review"
          subtitle="Evidence-first review. Unclear scope stays here — never contaminates takeoff."
        />
        {candidates.length === 0 ? (
          <EmptyState title="No scope candidates yet" hint="Upload drawings in Stage 01 to surface scope candidates here." />
        ) : (
          <div className="flex-1 overflow-auto">
            <table className="w-full text-xs font-mono">
              <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2">Candidate Scope</th>
                  <th className="text-left px-3 py-2 w-20">Conf</th>
                  <th className="text-left px-3 py-2 w-24">Decision</th>
                  <th className="text-left px-3 py-2 w-56">Source</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => {
                  const d = decisions[c.id];
                  return (
                    <tr key={c.id} onClick={() => setSelectedId(c.id)}
                      className={`border-t border-border cursor-pointer ${selectedId === c.id ? "bg-primary/5" : "hover:bg-muted/30"}`}>
                      <td className="px-3 py-2">{c.label}</td>
                      <td className="px-3 py-2">
                        <Pill tone={c.confidence > 0.85 ? "ok" : c.confidence > 0.7 ? "warn" : "bad"}>
                          {Math.round(c.confidence * 100)}%
                        </Pill>
                      </td>
                      <td className="px-3 py-2">
                        {d === "accept" && <Pill tone="ok">Accepted</Pill>}
                        {d === "hold" && <Pill tone="warn">Hold</Pill>}
                        {d === "reroute" && <Pill tone="info">Rerouted</Pill>}
                        {!d && <Pill>Pending</Pill>}
                      </td>
                      <td className="px-3 py-2 truncate text-muted-foreground max-w-0">{c.source}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="col-span-4 flex flex-col min-h-0 bg-muted/20">
        <StageHeader kicker="Evidence" title={sel ? sel.label : "Select a candidate"} />
        <div className="flex-1 overflow-auto p-4 space-y-3">
          {!sel ? (
            <EmptyState title="No candidate selected" />
          ) : (
            <>
              <div className="border border-border bg-card p-3">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Evidence</div>
                <div className="text-xs">{sel.evidence}</div>
              </div>
              <div className="border border-border bg-card p-3">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Source File</div>
                <div className="text-xs font-mono truncate">{sel.source}</div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Btn icon={<Check className="w-3 h-3" />} label="Accept" onClick={() => setDecision(sel.id, "accept")} tone="ok" />
                <Btn icon={<Pause className="w-3 h-3" />} label="Hold" onClick={() => setDecision(sel.id, "hold")} tone="warn" />
                <Btn icon={<Shuffle className="w-3 h-3" />} label="Reroute" onClick={() => setDecision(sel.id, "reroute")} tone="info" />
              </div>
              <div className="text-[10px] text-muted-foreground font-mono">
                Only Accepted scope flows into Takeoff Workspace.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Btn({ label, onClick, icon, tone }: { label: string; onClick: () => void; icon: React.ReactNode; tone: "ok" | "warn" | "info" }) {
  const cls = {
    ok: "border-primary/50 text-primary hover:bg-primary/10",
    warn: "border-yellow-500/40 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/10",
    info: "border-blue-500/40 text-blue-600 dark:text-blue-400 hover:bg-blue-500/10",
  }[tone];
  return (
    <button onClick={onClick} className={`inline-flex items-center justify-center gap-1.5 px-2 py-2 text-[10px] font-mono uppercase tracking-wider border ${cls}`}>
      {icon}{label}
    </button>
  );
}