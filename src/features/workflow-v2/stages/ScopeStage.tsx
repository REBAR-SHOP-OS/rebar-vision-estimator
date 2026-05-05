import { useMemo, useState } from "react";
import { StageHeader, Pill, EmptyState, type StageProps } from "./_shared";
import { Check, X, GitMerge, Split, Layers } from "lucide-react";

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

  const accepted = candidates.filter((c) => decisions[c.id] === "accept");
  // Group accepted by archetype label for "Approved Scope" buckets
  const buckets = useMemo(() => {
    const m = new Map<string, Candidate[]>();
    accepted.forEach((c) => {
      const k = c.label.split("—")[0].split("/")[0].trim();
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(c);
    });
    return Array.from(m.entries());
  }, [accepted]);
  const newCount = candidates.filter((c) => !decisions[c.id]).length;

  return (
    <div className="grid h-full" style={{ gridTemplateColumns: "360px 64px 1fr" }}>
      {/* Candidate column */}
      <div className="border-r border-border flex flex-col min-h-0" style={{ background: "hsl(var(--card))" }}>
        <StageHeader
          kicker="Stage 02 · Candidates"
          title="Candidate Scope"
          right={<Pill tone="info">{newCount} New</Pill>}
        />
        {candidates.length === 0 ? (
          <EmptyState title="No scope candidates" hint="Upload drawings to surface candidates." />
        ) : (
          <div className="flex-1 overflow-auto p-3 space-y-2">
            {candidates.map((c) => {
              const d = decisions[c.id];
              const isSel = selectedId === c.id;
              return (
                <button key={c.id} onClick={() => setSelectedId(c.id)}
                  className={`w-full text-left ip-card p-3 transition-colors ${isSel ? "border-primary bg-primary/5" : "hover:bg-accent/30"}`}>
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <span className="text-[10px] font-mono tracking-widest text-primary">{c.id.slice(0, 8).toUpperCase()}</span>
                    <span className="text-[10px] text-muted-foreground">{Math.round(c.confidence * 100)}% Confidence</span>
                  </div>
                  <div className="text-[13px] font-medium leading-tight">{c.label}</div>
                  <div className="text-[10px] text-muted-foreground mt-1.5 font-mono truncate">Source: {c.source}</div>
                  {d && (
                    <div className="mt-2">
                      {d === "accept" && <Pill tone="supported" solid>Approved</Pill>}
                      {d === "hold" && <Pill tone="inferred">On Hold</Pill>}
                      {d === "reroute" && <Pill tone="direct">Rerouted</Pill>}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Action rail */}
      <div className="border-r border-border flex flex-col items-center justify-start py-4 gap-2" style={{ background: "hsl(var(--background))" }}>
        <RailBtn title="Approve" tone="primary" onClick={() => sel && setDecision(sel.id, "accept")} disabled={!sel}>
          <Check className="w-4 h-4" />
        </RailBtn>
        <RailBtn title="Reject" tone="muted" onClick={() => sel && setDecision(sel.id, "hold")} disabled={!sel}>
          <X className="w-4 h-4" />
        </RailBtn>
        <div className="h-2" />
        <RailBtn title="Merge" tone="muted" onClick={() => sel && setDecision(sel.id, "reroute")} disabled={!sel}>
          <GitMerge className="w-4 h-4" />
        </RailBtn>
        <RailBtn title="Split" tone="muted" onClick={() => sel && setDecision(sel.id, "reroute")} disabled={!sel}>
          <Split className="w-4 h-4" />
        </RailBtn>
        <RailBtn title="Bucket" tone="muted" onClick={() => sel && setDecision(sel.id, "reroute")} disabled={!sel}>
          <Layers className="w-4 h-4" />
        </RailBtn>
      </div>

      {/* Approved buckets */}
      <div className="flex flex-col min-h-0">
        <StageHeader
          kicker="Approved Scope"
          title="Construction Buckets"
          right={
            <div className="flex gap-4 text-[11px] uppercase tracking-[0.14em] text-muted-foreground tabular-nums">
              <span>Total Tonnage <span className="text-foreground font-semibold ml-1">{(accepted.length * 14.2).toFixed(1)} TN</span></span>
              <span>Items <span className="text-foreground font-semibold ml-1">{accepted.length}</span></span>
            </div>
          }
        />
        <div className="flex-1 overflow-auto p-4">
          {accepted.length === 0 ? (
            <EmptyState title="No approved scope yet" hint="Review candidates on the left and approve them to populate buckets." />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {buckets.map(([name, items]) => (
                <div key={name} className="ip-card p-3">
                  <div className="flex items-baseline justify-between mb-2">
                    <div className="text-[11px] uppercase tracking-[0.14em] font-semibold">{name}</div>
                    <div className="text-[10px] text-muted-foreground tabular-nums">{items.length} Units</div>
                  </div>
                  <div className="space-y-1.5">
                    {items.map((it, i) => (
                      <div key={it.id} className="flex justify-between text-[12px] tabular-nums">
                        <span className="text-foreground">{name.charAt(0)}{i + 1}</span>
                        <span className="text-muted-foreground">{(2.5 + (i * 0.7)).toFixed(1)} TN</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RailBtn({ children, title, onClick, tone, disabled }: { children: React.ReactNode; title: string; onClick: () => void; tone: "primary" | "muted"; disabled?: boolean }) {
  const cls = tone === "primary"
    ? "border-primary bg-primary/15 text-primary hover:bg-primary/25"
    : "border-border bg-card text-muted-foreground hover:bg-accent/40 hover:text-foreground";
  return (
    <button title={title} disabled={disabled} onClick={onClick}
      className={`w-10 h-10 grid place-items-center border ${cls} disabled:opacity-30 disabled:cursor-not-allowed transition-colors`}>
      {children}
    </button>
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