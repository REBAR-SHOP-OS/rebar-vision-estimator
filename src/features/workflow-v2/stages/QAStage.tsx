import { Fragment, useEffect, useMemo, useState } from "react";
import { StageHeader, Pill, EmptyState, GateBanner, type StageProps } from "./_shared";
import { ArrowLeft, ArrowRight, Wand2 } from "lucide-react";
import { loadWorkflowQaIssues, type WorkflowQaIssue } from "../takeoff-data";
import { supabase } from "@/integrations/supabase/client";
import PdfRenderer from "@/components/chat/PdfRenderer";

export default function QAStage({ projectId, goToStage }: StageProps) {
  const [issues, setIssues] = useState<WorkflowQaIssue[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewKind, setPreviewKind] = useState<"pdf" | "image" | null>(null);
  const [previewName, setPreviewName] = useState<string>("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [pdfImg, setPdfImg] = useState<string | null>(null);
  const [pdfPageCount, setPdfPageCount] = useState(1);
  const [pdfPage, setPdfPage] = useState(1);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [tab, setTab] = useState<"change" | "impact" | "evidence" | "action">("change");
  const [zoomMode, setZoomMode] = useState<"tight" | "full">("tight");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const data = await loadWorkflowQaIssues(projectId);
      if (cancelled) return;
      setIssues(data);
      setSelectedId((current) => data.find((issue) => issue.id === current)?.id || data[0]?.id || null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  const sel = issues.find((i) => i.id === selectedId);

  // Auto-jump to the page that triggered the issue
  useEffect(() => {
    const p = sel?.locator?.page_number;
    if (p && p > 0) setPdfPage(p);
  }, [sel?.id, sel?.locator?.page_number]);

  // Reset zoom mode when switching issues
  useEffect(() => { setZoomMode("tight"); setTab("change"); }, [sel?.id]);

  // Resolve linked source file -> signed URL whenever the selected issue changes
  useEffect(() => {
    let cancelled = false;
    setPreviewUrl(null); setPreviewKind(null); setPdfImg(null); setPdfPage(1); setPdfPageCount(1); setPreviewName("");
    const fileId = sel?.source_file_id || sel?.linked_item?.source_file_id || null;
    if (!fileId) return;
    setPreviewLoading(true);
    (async () => {
      const { data: file } = await supabase
        .from("project_files")
        .select("file_name,file_path,file_type")
        .eq("id", fileId)
        .maybeSingle();
      if (cancelled || !file?.file_path) { setPreviewLoading(false); return; }
      const { data: signed } = await supabase.storage.from("blueprints").createSignedUrl(file.file_path, 3600);
      if (cancelled) return;
      const url = signed?.signedUrl || null;
      const isPdf = (file.file_path || "").toLowerCase().endsWith(".pdf") || (file.file_type || "").toLowerCase().includes("pdf");
      setPreviewUrl(url);
      setPreviewKind(url ? (isPdf ? "pdf" : "image") : null);
      setPreviewName(file.file_name || "");
      setPreviewLoading(false);
    })();
    return () => { cancelled = true; };
  }, [sel?.source_file_id]);

  const grouped = useMemo(() => {
    const crit = issues.filter((i) => ["critical", "error"].includes(i.severity?.toLowerCase()));
    const warn = issues.filter((i) => i.severity?.toLowerCase() === "warning");
    const rest = issues.filter((i) => !["critical", "error", "warning"].includes(i.severity?.toLowerCase()));
    return [
      { key: "critical", label: `Critical Blockers (${crit.length})`, tone: "blocked" as const, items: crit },
      { key: "warn", label: `Review Warnings (${warn.length})`, tone: "inferred" as const, items: warn },
      { key: "rest", label: `Revision Conflicts (${rest.length})`, tone: "direct" as const, items: rest },
    ];
  }, [issues]);
  const critCount = grouped[0].items.length;

  // ---- Pinpoint geometry ---------------------------------------------------
  // bbox is in source-page pixel coords. image_size is the original render size.
  // We compute a normalized center (cx,cy) in [0..1] and (when zoomed in)
  // translate+scale the rendered image so the marker sits in the panel center.
  const locator = sel?.locator || null;
  const bbox = locator?.bbox || null;
  const imgW = locator?.image_size?.w || imgSize?.w || 0;
  const imgH = locator?.image_size?.h || imgSize?.h || 0;
  const center = (() => {
    if (bbox && imgW && imgH) {
      return { cx: ((bbox[0] + bbox[2]) / 2) / imgW, cy: ((bbox[1] + bbox[3]) / 2) / imgH };
    }
    return { cx: 0.5, cy: 0.5 };
  })();
  const zoom = zoomMode === "tight" && bbox ? 2.4 : 1;
  const tx = (0.5 - center.cx) * 100 * zoom;
  const ty = (0.5 - center.cy) * 100 * zoom;
  // ------------------------------------------------------------------------

  const TABS: Array<{ k: typeof tab; label: string }> = [
    { k: "change", label: "Change" },
    { k: "impact", label: "Impact" },
    { k: "evidence", label: "Evidence" },
    { k: "action", label: "Action" },
  ];

  const jumpToTakeoff = () => {
    const linked = sel?.linked_item;
    (state as StageProps["state"]).setLocal({
      takeoffFocus: linked
        ? {
            raw_id: linked.id,
            raw_kind: "legacy",
            source_file_id: linked.source_file_id || sel?.source_file_id || null,
            segment_id: linked.segment_id || null,
            page_number: linked.page_number ?? sel?.locator?.page_number ?? null,
            issue_id: sel?.id || null,
          }
        : {
            source_file_id: sel?.source_file_id || null,
            page_number: sel?.locator?.page_number ?? null,
            issue_id: sel?.id || null,
          },
    });
    goToStage?.("takeoff");
  };

  return (
    <div className="flex flex-col h-full">
      {critCount > 0 && (
        <div className="px-4 pt-3">
          <GateBanner
            tone="blocked"
            title="Approval Gate Blocked"
            message={`${critCount} Critical Blocker${critCount === 1 ? "" : "s"} remaining. Export functionality is currently disabled.`}
            actions={
              <div className="flex gap-2">
                <button className="px-3 h-8 text-[11px] font-semibold uppercase tracking-[0.12em] bg-[hsl(var(--status-blocked))] text-white hover:opacity-90">
                  Resolve All Blockers
                </button>
                <button className="px-3 h-8 text-[11px] font-semibold uppercase tracking-[0.12em] border border-[hsl(var(--status-blocked))] text-[hsl(0_90%_88%)] hover:bg-[hsl(var(--status-blocked))]/20">
                  Request Override
                </button>
              </div>
            }
          />
        </div>
      )}
      <div className="grid grid-cols-12 flex-1 min-h-0">
        <div className="col-span-8 border-r border-border flex flex-col min-h-0">
          <StageHeader
            kicker="Stage 04"
            title="QA Issue Management"
            subtitle="Decides whether items return to takeoff or advance to confirmation."
            right={
              <button
                disabled={loading || critCount > 0}
                onClick={() => goToStage?.("confirm")}
                className="inline-flex h-8 items-center justify-center gap-1.5 border border-primary/50 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:border-border disabled:text-muted-foreground disabled:opacity-50"
              >
                Advance <ArrowRight className="w-3 h-3" />
              </button>
            }
          />
          <div className="flex-1 overflow-auto">
            {loading ? <EmptyState title="Loading QA issues..." /> :
              issues.length === 0 ? <EmptyState title="No QA issues" hint="No active blockers or warnings found. Advance to confirmation when takeoff looks correct." /> : (
                <table className="w-full text-[12px] tabular-nums">
                  <thead className="bg-muted/40 text-[10px] uppercase tracking-[0.14em] text-muted-foreground sticky top-0">
                    <tr>
                      <th className="text-left px-3 h-8 w-24">Type</th>
                      <th className="text-left px-3 h-8">Issue / Reason</th>
                      <th className="text-left px-3 h-8 w-32">Element ID</th>
                      <th className="text-left px-3 h-8 w-24">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped.map((g) => (
                      g.items.length > 0 && (
                        <Fragment key={g.key}>
                          <tr className="bg-muted/20 border-t border-border">
                            <td colSpan={4} className="px-3 h-7 text-[10px] uppercase tracking-[0.18em] font-semibold text-muted-foreground">{g.label}</td>
                          </tr>
                          {g.items.map((issue) => (
                            <tr key={issue.id} onClick={() => setSelectedId(issue.id)}
                              style={{ height: 36 }}
                              className={`border-t border-border cursor-pointer ${selectedId === issue.id ? "bg-primary/10" : "hover:bg-accent/40"}`}>
                              <td className="px-3"><Pill tone={g.tone} solid>{g.key === "critical" ? "BLOCK" : g.key === "warn" ? "WARN" : "REV"}</Pill></td>
                              <td className="px-3">
                                <div className="font-medium truncate">{issue.title}</div>
                                {issue.description && <div className="text-[11px] text-muted-foreground truncate">{issue.description}</div>}
                              </td>
                              <td className="px-3 font-mono text-[11px] text-muted-foreground">{issue.sheet_id?.slice(0, 12) || "-"}</td>
                              <td className="px-3 text-muted-foreground">{issue.status}</td>
                            </tr>
                          ))}
                        </Fragment>
                      )
                    ))}
                  </tbody>
                </table>
              )}
          </div>
        </div>
        <div className="col-span-4 flex flex-col min-h-0" style={{ background: "hsl(var(--card))" }}>
          <StageHeader kicker="Linked Source Review" title={sel ? sel.title : "Select an issue"} />
          {sel && (
            <div className="flex border-b border-border text-[10px] uppercase tracking-[0.14em] font-semibold">
              {TABS.map((t) => (
                <button
                  key={t.k}
                  onClick={() => setTab(t.k)}
                  className={`flex-1 h-8 ${tab === t.k ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex-1 overflow-auto p-4 space-y-3">
            {!sel ? <EmptyState title="No issue selected" /> : (
              <>
                {/* Pinpoint viewer — always visible above the tab content */}
                <div className="aspect-video border border-border bg-background relative overflow-hidden blueprint-bg">
                  {previewKind === "pdf" && previewUrl && (
                    <PdfRenderer
                      url={previewUrl}
                      currentPage={pdfPage}
                      onPageCount={setPdfPageCount}
                      onPageRendered={(dataUrl, w, h) => { setPdfImg(dataUrl); setImgSize({ w, h }); }}
                      scale={2}
                    />
                  )}
                  {/* zoom/pan wrapper */}
                  {(previewKind === "image" || (previewKind === "pdf" && pdfImg)) && (
                    <div
                      className="absolute inset-0"
                      style={{
                        transform: `translate(${tx}%, ${ty}%) scale(${zoom})`,
                        transformOrigin: "center center",
                        transition: "transform 0.35s ease-out",
                      }}
                    >
                      <img
                        src={previewKind === "pdf" ? (pdfImg || "") : (previewUrl || "")}
                        alt={previewName}
                        onLoad={(e) => {
                          if (previewKind === "image") {
                            const t = e.currentTarget;
                            setImgSize({ w: t.naturalWidth, h: t.naturalHeight });
                          }
                        }}
                        className="absolute inset-0 w-full h-full object-contain"
                        draggable={false}
                      />
                      {bbox && (
                        <div
                          className="absolute"
                          style={{ left: `${center.cx * 100}%`, top: `${center.cy * 100}%`, transform: "translate(-50%,-50%)" }}
                        >
                          <span className="relative flex items-center justify-center" style={{ width: 28, height: 28 }}>
                            <span className="absolute inline-flex h-full w-full rounded-full bg-[hsl(var(--status-blocked))] opacity-60 animate-ping" />
                            <span className="relative inline-flex rounded-full bg-[hsl(var(--status-blocked))]" style={{ width: 10, height: 10, boxShadow: "0 0 0 3px hsl(var(--background))" }} />
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                  {!previewUrl && !previewLoading && (
                    <div className="absolute inset-0 grid place-items-center text-[10px] uppercase tracking-widest text-muted-foreground">No linked drawing for this issue</div>
                  )}
                  {previewLoading && (
                    <div className="absolute inset-0 grid place-items-center text-[10px] uppercase tracking-widest text-muted-foreground">Loading drawing…</div>
                  )}
                  <span className="absolute top-2 left-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground bg-background/80 px-1.5 py-0.5 z-10">
                    {previewName || sel.sheet_id?.slice(0, 8) || "-"}
                    {previewKind === "pdf" && pdfPageCount > 0 && <> · p{pdfPage}/{pdfPageCount}</>}
                    {!bbox && locator?.page_number && <span className="ml-1 text-[hsl(var(--status-inferred))]">(page-linked)</span>}
                  </span>
                  <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
                    {bbox && (
                      <button
                        onClick={() => setZoomMode((m) => (m === "tight" ? "full" : "tight"))}
                        className="text-[10px] uppercase tracking-widest bg-background/80 px-1.5 py-0.5 hover:text-foreground"
                      >
                        {zoomMode === "tight" ? "Full sheet" : "Zoom in"}
                      </button>
                    )}
                    {previewUrl && (
                      <a href={previewUrl} target="_blank" rel="noreferrer" className="text-[10px] uppercase tracking-widest bg-background/80 px-1.5 py-0.5 hover:text-foreground">Open</a>
                    )}
                  </div>
                  {previewKind === "pdf" && pdfPageCount > 1 && (
                    <div className="absolute bottom-2 right-2 z-10 flex items-center gap-1 bg-background/80 px-1.5 py-0.5 text-[10px] font-mono">
                      <button className="px-1 hover:text-foreground" disabled={pdfPage <= 1} onClick={() => setPdfPage((p) => Math.max(1, p - 1))}>◀</button>
                      <span>{pdfPage}/{pdfPageCount}</span>
                      <button className="px-1 hover:text-foreground" disabled={pdfPage >= pdfPageCount} onClick={() => setPdfPage((p) => Math.min(pdfPageCount, p + 1))}>▶</button>
                    </div>
                  )}
                </div>
                {!bbox && locator?.page_number && (
                  <div className="text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--status-inferred))] border border-[hsl(var(--status-inferred))]/30 bg-[hsl(var(--status-inferred))]/10 px-2 py-1">
                    Drawing linked to page {locator.page_number}. Exact element region is not available yet — use the recommended fix to jump to the blocked takeoff row.
                  </div>
                )}

                {/* Tab content */}
                {tab === "change" && (
                  <>
                    <div className="ip-card p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="ip-kicker">Issue Focus</span>
                        <Pill tone={["critical", "error"].includes(sel.severity?.toLowerCase()) ? "blocked" : "inferred"} solid>
                          {sel.severity?.toUpperCase() || "-"}
                        </Pill>
                      </div>
                      <div className="text-[12px] font-mono mb-1.5">{sel.id.slice(0, 16).toUpperCase()}</div>
                      <div className="text-[12px] text-muted-foreground leading-relaxed">{sel.description || "No description provided."}</div>
                      {sel.linked_item?.missing_refs && sel.linked_item.missing_refs.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {sel.linked_item.missing_refs.map((m, i) => (
                            <span key={i} className="text-[10px] uppercase tracking-[0.1em] px-1.5 py-0.5 bg-[hsl(var(--status-blocked))]/15 text-[hsl(var(--status-blocked))] border border-[hsl(var(--status-blocked))]/30">
                              missing: {m}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
                {tab === "impact" && (
                  <div className="ip-card p-3 text-[12px]">
                    <div className="ip-kicker mb-2">Affected Estimate Row</div>
                    {sel.linked_item ? (
                      <div className="space-y-1.5 tabular-nums">
                        <div className="font-medium truncate">{sel.linked_item.description || "—"}</div>
                        <div className="grid grid-cols-2 gap-2 text-[11px]">
                          <div><span className="text-muted-foreground">Size</span> <span className="font-mono">{sel.linked_item.bar_size || "—"}</span></div>
                          <div><span className="text-muted-foreground">Qty</span> <span className="font-mono">{sel.linked_item.quantity_count || "—"}</span></div>
                          <div><span className="text-muted-foreground">Length</span> <span className="font-mono">{sel.linked_item.total_length || "—"}</span></div>
                          <div><span className="text-muted-foreground">Weight</span> <span className="font-mono">{sel.linked_item.total_weight || "—"}</span></div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-[11px] text-muted-foreground italic">No estimate row linked.</div>
                    )}
                  </div>
                )}
                {tab === "evidence" && (
                  <div className="ip-card p-3 text-[11px]">
                    <div className="ip-kicker mb-2">Source References</div>
                    <pre className="whitespace-pre-wrap break-all text-[10px] font-mono text-muted-foreground max-h-48 overflow-auto">
{JSON.stringify(sel.source_refs ?? null, null, 2)}
                    </pre>
                  </div>
                )}
                {tab === "action" && (
                  <>
                    <div className="ip-card p-3">
                      <div className="ip-kicker mb-1.5 flex items-center gap-1.5"><Wand2 className="w-3 h-3" /> Recommended Fix</div>
                      <div className="text-[12px] italic text-muted-foreground">Review element source and apply standard correction per project spec.</div>
                    </div>
                    <button onClick={jumpToTakeoff} className="w-full h-9 inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground text-[11px] font-semibold uppercase tracking-[0.14em] hover:opacity-90">
                      <Wand2 className="w-3.5 h-3.5" /> Apply Recommended Fix
                    </button>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={jumpToTakeoff}
                        className="h-8 inline-flex items-center justify-center gap-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] border border-[hsl(var(--status-inferred))]/50 text-[hsl(var(--status-inferred))] hover:bg-[hsl(var(--status-inferred))]/10"
                      >
                        <ArrowLeft className="w-3 h-3" /> Return to Takeoff
                      </button>
                      <button
                        disabled={critCount > 0}
                        onClick={() => goToStage?.("confirm")}
                        className="h-8 inline-flex items-center justify-center gap-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] border border-primary/50 text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:border-border disabled:text-muted-foreground disabled:opacity-50"
                      >
                        Advance <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
