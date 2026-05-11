import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { StageHeader, Pill, EmptyState, type StageProps } from "./_shared";
import { ArrowRight, Check, X, GitMerge, Split, Layers, Loader2, RefreshCcw } from "lucide-react";
import TakeoffCanvas, { type TakeoffCanvasLayer } from "@/components/takeoff-canvas/TakeoffCanvas";
import { inferSegmentType, methodologyStep, METHODOLOGY_STEP_LABELS } from "@/lib/segment-type";

type Decision = "accept" | "hold" | "reroute";

interface Candidate {
  id: string;
  label: string;
  source: string;
  confidence: number;
  evidence: string;
}

export default function ScopeStage({ projectId, state, goToStage }: StageProps) {
  const { user } = useAuth();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectFailed, setDetectFailed] = useState(false);
  const [searchPages, setSearchPages] = useState<Array<{ page_number: number | null; raw_text: string }>>([]);
  const detectedRef = useRef<string | null>(null);
  const cached = (state.local.scopeCandidates as Candidate[] | undefined) || [];
  const approvedLabels = state.approvedScopeItems;
  // De-dup by label so we never show the same archetype twice (e.g. once per uploaded PDF).
  const candidates: Candidate[] = useMemo(() => {
    const seen = new Map<string, Candidate>();
    const sourceList: Candidate[] = cached.length > 0
      ? cached
      : approvedLabels.map((label, i) => ({
          id: `approved-${i}-${label}`,
          label,
          source: "approved scope",
          confidence: 1,
          evidence: "Previously approved scope item",
        }));
    for (const c of sourceList) {
      const key = c.label.trim().toLowerCase();
      const prev = seen.get(key);
      if (!prev || (c.confidence || 0) > (prev.confidence || 0)) seen.set(key, c);
    }
    // Bottom-to-Top: Foundation → Verticals → Flatwork → Transitions → Site Misc.
    return Array.from(seen.values()).sort((a, b) => {
      const sa = methodologyStep(a.label);
      const sb = methodologyStep(b.label);
      if (sa !== sb) return sa - sb;
      return a.label.localeCompare(b.label);
    });
  }, [cached, approvedLabels]);

  // Run real OCR-driven scope detection once per project (and re-run on file count change).
  const runDetection = async () => {
    setDetecting(true);
    setDetectFailed(false);
    const timeout = new Promise<{ timedOut: true }>((res) => setTimeout(() => res({ timedOut: true }), 30_000));
    try {
      const work = supabase.functions.invoke("auto-segments", { body: { projectId } });
      const result = await Promise.race([work, timeout]);
      if ((result as { timedOut?: boolean }).timedOut) {
        setDetectFailed(true);
        return;
      }
      const { data, error } = result as Awaited<typeof work>;
      if (error || !data?.suggestions || data.suggestions.length === 0) {
        // Only treat as a true failure when there's nothing approved yet either.
        if (approvedLabels.length === 0) setDetectFailed(true);
        return;
      }
      const next: Candidate[] = (data.suggestions as Array<{
        name: string; segment_type?: string; notes?: string | null;
      }>).map((s, i) => ({
        id: `${s.name}-${i}`,
        label: s.name,
        source: s.notes || s.segment_type || "OCR",
        confidence: 0.75,
        evidence: s.notes || `Detected ${s.segment_type || "element"} from drawings`,
      }));
      state.setLocal({ scopeCandidates: next });
    } catch (e) {
      console.warn("auto-segments invoke failed:", e);
      setDetectFailed(true);
    } finally {
      setDetecting(false);
    }
  };

  useEffect(() => {
    if (state.files.length === 0) return;
    const sig = `${projectId}:${state.files.length}`;
    if (detectedRef.current === sig) return;
    if (cached.length > 0 && detectedRef.current === null) {
      detectedRef.current = sig;
      return;
    }
    detectedRef.current = sig;
    runDetection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, state.files.length]);

  // Pull OCR pages once so we can locate which page each candidate appears on
  // (used by the right-pane SELECTION overlay).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("drawing_search_index")
        .select("page_number, raw_text")
        .eq("project_id", projectId)
        .order("page_number", { ascending: true })
        .limit(200);
      if (cancelled) return;
      setSearchPages((data || []).map((r: any) => ({
        page_number: r.page_number,
        raw_text: String(r.raw_text || "").slice(0, 8192),
      })));
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  const decisions = (state.local.scope || {}) as Record<string, Decision>;
  const [selectedId, setSelectedId] = useState<string | null>(candidates[0]?.id || null);
  const sel = candidates.find((c) => c.id === selectedId) || null;

  useEffect(() => {
    if (candidates.length === 0) {
      if (selectedId) setSelectedId(null);
      return;
    }
    if (!selectedId || !candidates.some((candidate) => candidate.id === selectedId)) {
      setSelectedId(candidates[0].id);
    }
  }, [candidates, selectedId]);

  const setDecision = async (id: string, d: Decision) => {
    const candidate = candidates.find((c) => c.id === id);
    state.setLocal({ scope: { ...decisions, [id]: d } });
    if (!candidate) return;

    setSavingId(id);
    try {
      const { data, error } = await supabase
        .from("projects")
        .select("scope_items")
        .eq("id", projectId)
        .maybeSingle();
      if (error) throw error;

      const current = Array.isArray(data?.scope_items)
        ? data.scope_items.map((item: unknown) => String(item)).filter(Boolean)
        : [];
      const nextScopeItems = d === "accept"
        ? Array.from(new Set([...current, candidate.label]))
        : current.filter((item) => item !== candidate.label);

      const update: Record<string, unknown> = {
        scope_items: nextScopeItems,
      };
      if (nextScopeItems.length > 0) {
        update.workflow_status = "scope_detected";
        update.intake_complete = true;
      }

      const { error: updateError } = await supabase
        .from("projects")
        .update(update)
        .eq("id", projectId);
      if (updateError) throw updateError;

      // Materialize a segment so Stage 3 (Takeoff) has something to estimate against.
      if (d === "accept" && user) {
        try {
          const { data: existingSeg } = await supabase
            .from("segments")
            .select("id")
            .eq("project_id", projectId)
            .eq("name", candidate.label)
            .maybeSingle();
          const nextType = inferSegmentType(candidate.label);
          if (!existingSeg?.id) {
            await supabase.from("segments").insert({
              project_id: projectId,
              user_id: user.id,
              name: candidate.label,
              segment_type: nextType,
              status: "draft",
              confidence: candidate.confidence,
            });
          } else {
            await supabase
              .from("segments")
              .update({ segment_type: nextType, confidence: candidate.confidence })
              .eq("id", existingSeg.id);
          }
        } catch (segErr) {
          console.warn("Failed to upsert segment for approved scope:", segErr);
        }
      }

      state.refresh();
    } catch (error) {
      console.warn("Failed to persist V2 scope decision:", error);
    } finally {
      setSavingId(null);
    }
  };

  const serverApprovedLabels = useMemo(() => new Set(state.approvedScopeItems), [state.approvedScopeItems]);
  const getDecision = (candidate: Candidate) =>
    decisions[candidate.id] || (serverApprovedLabels.has(candidate.label) ? "accept" : undefined);

  const accepted = candidates.filter((c) => getDecision(c) === "accept");
  const newCount = candidates.filter((c) => !getDecision(c)).length;

  // Final Summary Checklist — derived from approved candidates by methodology step.
  const checklist = useMemo(() => {
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    for (const c of accepted) counts[methodologyStep(c.label)] += 1;
    return counts;
  }, [accepted]);

  // Build canvas layers from approved buckets (one layer per archetype label).
  const canvasLayers: TakeoffCanvasLayer[] = useMemo(() => {
    const m = new Map<string, { name: string; type: string; count: number }>();
    accepted.forEach((c) => {
      const k = c.label.split("—")[0].split("/")[0].trim();
      const existing = m.get(k);
      if (existing) existing.count += 1;
      else m.set(k, { name: k, type: inferSegmentType(k), count: 1 });
    });
    return Array.from(m.entries()).map(([k, v]) => ({
      id: `synthetic-${k}`,
      name: v.name,
      segment_type: v.type,
      count: v.count,
      unit: "items",
    }));
  }, [accepted]);

  const firstFile = state.files[0];

  // Best-effort page lookup for the selected candidate.
  const selectedPage = useMemo(() => {
    if (!sel || searchPages.length === 0) return undefined;
    const tokens = sel.label
      .toLowerCase()
      .split(/[^a-z0-9#]+/i)
      .filter((t) => t.length >= 3);
    if (tokens.length === 0) return undefined;
    let best: { page: number; score: number } | null = null;
    for (const row of searchPages) {
      const text = row.raw_text.toLowerCase();
      let score = 0;
      for (const t of tokens) if (text.includes(t)) score += 1;
      if (score > 0 && (!best || score > best.score)) {
        best = { page: row.page_number || 1, score };
      }
    }
    return best?.page;
  }, [sel, searchPages]);

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
          <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
            {detecting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                <div className="text-[12px] font-mono uppercase tracking-widest text-muted-foreground">Detecting scope…</div>
                <div className="text-[11px] text-muted-foreground">Reading OCR from structural &amp; architectural sheets.</div>
              </>
            ) : (
              <>
                <div className="text-[12px] font-mono uppercase tracking-widest text-muted-foreground">
                  {approvedLabels.length > 0
                    ? "Scope already approved"
                    : detectFailed ? "No candidates detected" : "No scope candidates"}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {approvedLabels.length > 0
                    ? "All scope items are approved. Continue to calibration or retry detection for more."
                    : detectFailed
                      ? "OCR did not surface a usable scope. Retry or upload more sheets."
                      : "Upload drawings, then run scope detection."}
                </div>
                {state.files.length > 0 && (
                  <button
                    onClick={runDetection}
                    className="inline-flex h-7 items-center gap-1.5 border border-primary/60 bg-primary/15 px-3 text-[10px] font-mono uppercase tracking-wider text-primary hover:bg-primary/25"
                  >
                    <RefreshCcw className="w-3 h-3" /> Retry detection
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-auto p-3 space-y-2">
            {candidates.map((c) => {
              const d = getDecision(c);
              const isSel = selectedId === c.id;
              return (
                <button key={c.id} onClick={() => setSelectedId(c.id)}
                  onDoubleClick={() => { setSelectedId(c.id); setDecision(c.id, "accept"); }}
                  title="Double-click to approve"
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
        <RailBtn title="Approve" tone="primary" onClick={() => sel && setDecision(sel.id, "accept")} disabled={!sel || savingId === sel?.id}>
          {savingId === sel?.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
        </RailBtn>
        <RailBtn title="Reject" tone="muted" onClick={() => sel && setDecision(sel.id, "hold")} disabled={!sel || savingId === sel?.id}>
          <X className="w-4 h-4" />
        </RailBtn>
        <div className="h-2" />
        <RailBtn title="Merge" tone="muted" onClick={() => sel && setDecision(sel.id, "reroute")} disabled={!sel || savingId === sel?.id}>
          <GitMerge className="w-4 h-4" />
        </RailBtn>
        <RailBtn title="Split" tone="muted" onClick={() => sel && setDecision(sel.id, "reroute")} disabled={!sel || savingId === sel?.id}>
          <Split className="w-4 h-4" />
        </RailBtn>
        <RailBtn title="Bucket" tone="muted" onClick={() => sel && setDecision(sel.id, "reroute")} disabled={!sel || savingId === sel?.id}>
          <Layers className="w-4 h-4" />
        </RailBtn>
      </div>

      {/* Approved buckets */}
      <div className="flex flex-col min-h-0">
        <StageHeader
          kicker="Approved Scope"
          title="Takeoff Canvas"
          right={
            <div className="flex items-center gap-3">
              <div className="hidden md:flex items-center gap-1" title="Bottom-to-Top methodology coverage">
                {[1, 2, 3, 4, 5].map((step) => {
                  const n = checklist[step] || 0;
                  const cls = n > 0
                    ? "border-primary/60 bg-primary/15 text-primary"
                    : "border-border bg-card text-muted-foreground/70";
                  return (
                    <span
                      key={step}
                      title={`Step ${step}: ${METHODOLOGY_STEP_LABELS[step]} — ${n} approved`}
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 border text-[9px] font-mono uppercase tracking-wider ${cls}`}
                    >
                      {n > 0 ? "✓" : "—"} {step}·{METHODOLOGY_STEP_LABELS[step].slice(0, 4)}
                    </span>
                  );
                })}
              </div>
              <div className="flex gap-4 text-[11px] uppercase tracking-[0.14em] text-muted-foreground tabular-nums">
                <span>Total Tonnage <span className="text-foreground font-semibold ml-1">— TN</span></span>
                <span>Items <span className="text-foreground font-semibold ml-1">{accepted.length}</span></span>
              </div>
              <button
                disabled={candidates.length === 0}
                onClick={() => goToStage?.("calibration")}
                className="inline-flex h-8 items-center justify-center gap-1.5 border border-primary/60 bg-primary/15 px-3 text-[10px] font-mono uppercase tracking-wider text-primary transition-colors hover:bg-primary/25 disabled:cursor-not-allowed disabled:border-border disabled:bg-transparent disabled:text-muted-foreground"
              >
                Continue <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          }
        />
        <div className="flex-1 min-h-0">
          <TakeoffCanvas
            projectId={projectId}
            layers={canvasLayers}
            filePath={firstFile?.file_path}
            fileName={firstFile?.file_name}
            emptyHint={accepted.length === 0 ? "Approve candidates on the left to add layers." : "Upload a drawing to see the canvas."}
            highlight={sel ? { label: sel.label, pageNumber: selectedPage, color: "hsl(24 95% 55%)" } : null}
          />
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
