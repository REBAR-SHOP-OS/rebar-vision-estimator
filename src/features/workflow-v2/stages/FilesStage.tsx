import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Upload, FileText, AlertTriangle, CheckCircle2, ImageIcon, Loader2 } from "lucide-react";
import { StageHeader, Pill, type StageProps, EmptyState } from "./_shared";
import PdfRenderer from "@/components/chat/PdfRenderer";
import {
  createProjectFileWithCanonicalBridge,
  detectDiscipline,
  ensureCurrentProjectRebarBridge,
  inferRebarFileKind,
} from "@/lib/rebar-intake";
import { parseAndIndexFile } from "@/lib/parse-file";
import type { IndexingDiagnostics } from "@/lib/indexing-pipeline";

interface Row {
  id: string;
  legacy_file_id?: string | null;
  file_name: string;
  file_path: string;
  created_at: string;
  file_size?: number | null;
  revision: string;
  status: "ready" | "review" | "blocked" | "changed";
  parse_status: "pending" | "parsing" | "indexed" | "failed";
  parse_error?: string | null;
  indexed_rows: number;
  page_count: number;
}

function inferRevision(name: string): string {
  const m = name.match(/[_\s-](rev|r|v)[_\-\s]?([0-9]+)/i);
  return m ? `R${m[2]}` : "R0";
}

function isPdfFile(file: Row) {
  return /\.pdf$/i.test(file.file_name) || /\.pdf($|\?)/i.test(file.file_path);
}

function isImageFile(file: Row) {
  return /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.file_name) || /\.(png|jpe?g|webp|gif|bmp)($|\?)/i.test(file.file_path);
}

export default function FilesStage({ projectId, state }: StageProps) {
  const { user } = useAuth();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [parseMeta, setParseMeta] = useState<Record<string, { parse_status: Row["parse_status"]; parse_error?: string | null; indexed_rows: number; page_count: number }>>({});

  const rows: Row[] = state.files.map((f) => ({
    ...f,
    revision: inferRevision(f.file_name),
    status: (state.local.fileStatus?.[f.id] as Row["status"]) || "review",
    parse_status: parseMeta[f.legacy_file_id || f.id]?.parse_status || "pending",
    parse_error: parseMeta[f.legacy_file_id || f.id]?.parse_error || null,
    indexed_rows: parseMeta[f.legacy_file_id || f.id]?.indexed_rows || 0,
    page_count: parseMeta[f.legacy_file_id || f.id]?.page_count || 0,
  }));

  useEffect(() => {
    let cancelled = false;
    const legacyIds = state.files.map((file) => file.legacy_file_id || file.id).filter(Boolean) as string[];
    if (legacyIds.length === 0) {
      setParseMeta({});
      return;
    }

    supabase
      .from("document_versions")
      .select("file_id, parse_status, parse_error, page_count, pdf_metadata")
      .eq("project_id", projectId)
      .in("file_id", legacyIds)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.warn("FilesStage parse status load failed:", error);
          return;
        }
        const next: Record<string, { parse_status: Row["parse_status"]; parse_error?: string | null; indexed_rows: number; page_count: number }> = {};
        for (const row of data || []) {
          const diagnostics = ((row.pdf_metadata as Record<string, unknown> | null)?.indexing_diagnostics || null) as IndexingDiagnostics | null;
          const status = row.parse_status === "indexed" || row.parse_status === "parsing" || row.parse_status === "failed"
            ? row.parse_status
            : "pending";
          next[row.file_id] = {
            parse_status: status,
            parse_error: row.parse_error,
            indexed_rows: Number(diagnostics?.indexed_rows_verified || 0),
            page_count: Number(row.page_count || 0),
          };
        }
        setParseMeta(next);
      });

    return () => { cancelled = true; };
  }, [projectId, state.files]);

  useEffect(() => { if (!selectedId && rows[0]) setSelectedId(rows[0].id); }, [rows, selectedId]);
  const sel = rows.find((r) => r.id === selectedId) || null;
  const failedRows = rows.filter((row) => row.parse_status === "failed" || (row.parse_status === "indexed" && row.indexed_rows === 0));
  const indexedRows = rows.filter((row) => row.parse_status === "indexed" && row.indexed_rows > 0);
  const parsingRows = rows.filter((row) => row.parse_status === "parsing");

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fl = e.target.files; if (!fl || !user) return;
    setUploading(true);
    let ok = 0;
    const ocrCachePatch: Record<string, { pages: any[]; indexed_at: string; file_name: string }> = {};

    try {
      await ensureCurrentProjectRebarBridge(supabase, projectId);
    } catch (bridgeErr) {
      console.warn("Canonical project bridge check failed before V2 upload:", bridgeErr);
      toast.error("Upload blocked until the canonical rebar project bridge is healthy.");
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    for (const file of Array.from(fl)) {
      const path = `${user.id}/${projectId}/${Date.now()}_${file.name}`;
      const up = await supabase.storage.from("blueprints").upload(path, file);
      if (up.error) {
        toast.error(`Upload failed: ${file.name}`);
        continue;
      }

      try {
        const fileRow = await createProjectFileWithCanonicalBridge(supabase, {
          projectId,
          userId: user.id,
          fileName: file.name,
          filePath: path,
          fileType: file.type || null,
          fileSize: file.size,
          fileKind: inferRebarFileKind(file.name, file.type || null),
        });

        const { error: docVersionErr } = await supabase.from("document_versions").insert({
            project_id: projectId,
            user_id: user.id,
            file_id: fileRow.id,
            file_name: file.name,
            file_path: path,
            sha256: `pending_${Date.now()}_${fileRow.id}`,
            source_system: "upload",
            pdf_metadata: detectDiscipline(file.name) ? { discipline: detectDiscipline(file.name) } : {},
          });
        if (docVersionErr) {
          console.warn(`document_versions insert failed for ${file.name}:`, docVersionErr);
          toast.error(`Uploaded ${file.name}, but indexing setup failed. Re-upload this file from the workspace Files tab.`);
          continue;
        }

        // Trigger parse + index so downstream estimation has drawing text.
        try {
          const res = await parseAndIndexFile(projectId, {
            id: fileRow.id,
            legacy_file_id: fileRow.id,
            file_name: file.name,
            file_path: path,
          }, (msg) => toast.message(`${file.name}: ${msg}`));
          if (res.status === "failed") {
            toast.error(`Indexing failed for ${file.name}: ${res.error || "unknown error"}`);
          } else if (res.status === "indexed") {
            toast.success(`${file.name} indexed (${res.pages_indexed} pages)`);
            if (res.pages && res.pages.length) {
              ocrCachePatch[fileRow.id] = {
                pages: res.pages,
                indexed_at: new Date().toISOString(),
                file_name: file.name,
              };
            }
          }
        } catch (parseErr: any) {
          console.warn(`parseAndIndexFile failed for ${file.name}:`, parseErr);
          toast.error(`Indexing failed for ${file.name}: ${parseErr?.message || parseErr}`);
        }

        ok++;
      } catch (saveErr) {
        console.warn(`Canonical V2 upload failed for ${file.name}:`, saveErr);
        toast.error(`Upload failed during canonical intake: ${file.name}`);
      }
    }

    setUploading(false);
    if (ok) toast.success(`${ok} file${ok > 1 ? "s" : ""} uploaded`);
    if (Object.keys(ocrCachePatch).length) {
      const prev = (state.local.ocrCache as Record<string, any>) || {};
      state.setLocal({ ocrCache: { ...prev, ...ocrCachePatch } });
      // Pre-arm dimensions for takeoff/estimate (fire-and-forget).
      toast.message("Pre-computing dimensions for takeoff…");
      supabase.functions.invoke("extract-dimensions", { body: { project_id: projectId } })
        .then(({ data, error }) => {
          if (error) {
            console.warn("extract-dimensions pre-warm failed:", error);
            return;
          }
          const segments = (data as any)?.segments || [];
          state.setLocal({ dimensionsCache: { resolved_at: new Date().toISOString(), segments } });
          if (segments.length) toast.success(`Dimensions cached for ${segments.length} segment${segments.length > 1 ? "s" : ""}`);
        })
        .catch((err) => console.warn("extract-dimensions pre-warm error:", err));
    }
    if (inputRef.current) inputRef.current.value = "";
    state.refresh();
    const { error: pipelineErr } = await supabase.functions.invoke("process-pipeline", { body: { project_id: projectId } });
    if (pipelineErr) {
      console.warn("process-pipeline failed after Stage 01 upload:", pipelineErr);
      toast.warning("Files uploaded, but the project index status needs attention in Stage 01.");
    }
  };

  const setStatus = (id: string, status: Row["status"]) => {
    const cur = (state.local.fileStatus as any) || {};
    state.setLocal({ fileStatus: { ...cur, [id]: status } });
  };

  const handleReindex = async (targetRows: Row[]) => {
    if (!user || targetRows.length === 0) return;
    setReindexing(true);
    let ok = 0;
    const ocrCachePatch: Record<string, { pages: any[]; indexed_at: string; file_name: string }> = {};
    for (const r of targetRows) {
      try {
        const res = await parseAndIndexFile(projectId, {
          id: r.id,
          legacy_file_id: (r as any).legacy_file_id || r.id,
          file_name: r.file_name,
          file_path: r.file_path,
        }, (msg) => toast.message(`${r.file_name}: ${msg}`), { force: true });
        if (res.status === "indexed") {
          ok++;
          if (res.pages && res.pages.length) {
            ocrCachePatch[r.id] = { pages: res.pages, indexed_at: new Date().toISOString(), file_name: r.file_name };
          }
        } else if (res.status === "failed") {
          toast.error(`Re-index failed: ${r.file_name} — ${res.error || "unknown"}`);
        }
      } catch (e: any) {
        toast.error(`Re-index error: ${r.file_name} — ${e?.message || e}`);
      }
    }
    setReindexing(false);
    if (ok) toast.success(`Re-indexed ${ok} file${ok > 1 ? "s" : ""}`);
    if (Object.keys(ocrCachePatch).length) {
      state.setLocal({ ocrCache: ocrCachePatch });
      toast.message("Re-computing dimensions for takeoff…");
      supabase.functions.invoke("extract-dimensions", { body: { project_id: projectId } })
        .then(({ data, error }) => {
          if (error) { console.warn("extract-dimensions re-warm failed:", error); return; }
          const segments = (data as any)?.segments || [];
          state.setLocal({ dimensionsCache: { resolved_at: new Date().toISOString(), segments } });
        })
        .catch((err) => console.warn("extract-dimensions re-warm error:", err));
    }
    state.refresh();
    const { error: pipelineErr } = await supabase.functions.invoke("process-pipeline", { body: { project_id: projectId } });
    if (pipelineErr) console.warn("process-pipeline failed after re-index:", pipelineErr);
  };

  return (
    <div className="grid grid-cols-12 h-full">
      <input ref={inputRef} type="file" multiple accept="*" onChange={handleUpload} className="hidden" />
      {/* Register */}
      <div className="col-span-8 border-r border-border flex flex-col min-h-0">
        <StageHeader
          kicker="Stage 01"
          title="Document Register"
          subtitle="Files create downstream awareness, not final decisions."
          right={
            <div className="flex items-center gap-2">
              {rows.length > 0 && (
                <button
                  onClick={() => handleReindex(rows)}
                  disabled={reindexing || uploading}
                  className="inline-flex items-center gap-2 px-3 h-8 text-[11px] font-semibold uppercase tracking-[0.12em] border border-border text-muted-foreground hover:bg-accent/40 disabled:opacity-50"
                >
                  {reindexing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  {reindexing ? "Re-indexing..." : "Re-index All"}
                </button>
              )}
              {failedRows.length > 0 && (
                <button
                  onClick={() => handleReindex(failedRows)}
                  disabled={reindexing || uploading}
                  className="inline-flex items-center gap-2 px-3 h-8 text-[11px] font-semibold uppercase tracking-[0.12em] border border-[hsl(var(--status-inferred))]/50 text-[hsl(var(--status-inferred))] hover:bg-[hsl(var(--status-inferred))]/10 disabled:opacity-50"
                >
                  {reindexing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  {reindexing ? "Retrying..." : `Retry Failed (${failedRows.length})`}
                </button>
              )}
              <button
                onClick={() => inputRef.current?.click()}
                disabled={uploading || reindexing}
                className="inline-flex items-center gap-2 px-3 h-8 text-[11px] font-semibold uppercase tracking-[0.12em] border border-primary text-primary hover:bg-primary/10 disabled:opacity-50"
              >
                <Upload className="w-3.5 h-3.5" /> {uploading ? "Uploading..." : "Upload New Sheets"}
              </button>
            </div>
          }
        />
        {rows.length > 0 && (
          <div className="px-4 py-2.5 border-b border-border space-y-1.5 bg-card/40">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-[hsl(var(--status-inferred))] font-semibold">
              <AlertTriangle className="w-3.5 h-3.5" /> Sheet Completeness Warnings
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="text-[11px] px-2 py-1 border border-[hsl(var(--status-inferred))]/40 text-[hsl(var(--status-inferred))] bg-[hsl(var(--status-inferred))]/5">
                {rows.length} document{rows.length !== 1 && "s"} registered · awaiting routing decisions
              </span>
              <span className="text-[11px] px-2 py-1 border border-[hsl(var(--status-supported))]/40 text-[hsl(var(--status-supported))] bg-[hsl(var(--status-supported))]/5">
                {indexedRows.length} indexed with visible sheets
              </span>
              {parsingRows.length > 0 && (
                <span className="text-[11px] px-2 py-1 border border-border text-muted-foreground bg-background">
                  {parsingRows.length} parsing/indexing
                </span>
              )}
              {failedRows.length > 0 && (
                <span className="text-[11px] px-2 py-1 border border-[hsl(var(--status-blocked))]/40 text-[hsl(var(--status-blocked))] bg-[hsl(var(--status-blocked))]/5">
                  {failedRows.length} require retry
                </span>
              )}
            </div>
          </div>
        )}
        <div className="flex-1 overflow-auto">
          {rows.length === 0 ? (
            <EmptyState title="No drawings registered" hint="Upload PDF or image drawings to begin scope review." />
          ) : (
            <table className="w-full text-[12px] tabular-nums">
              <thead className="bg-muted/40 text-[10px] uppercase tracking-[0.14em] text-muted-foreground sticky top-0">
                <tr>
                  <th className="text-left px-3 h-8 w-10">#</th>
                  <th className="text-left px-3 h-8">File Name</th>
                  <th className="text-left px-3 h-8 w-24">Discipline</th>
                  <th className="text-left px-3 h-8 w-16">Rev</th>
                  <th className="text-left px-3 h-8 w-24">Status</th>
                  <th className="text-left px-3 h-8 w-28">Parse</th>
                  <th className="text-left px-3 h-8 w-32">Uploaded</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id}
                    onClick={() => setSelectedId(r.id)}
                    style={{ height: 32 }}
                    className={`border-t border-border cursor-pointer ${selectedId === r.id ? "bg-primary/10" : i % 2 ? "bg-card/30 hover:bg-accent/40" : "hover:bg-accent/40"}`}>
                    <td className="px-3 text-muted-foreground">{String(i + 1).padStart(2, "0")}</td>
                    <td className="px-3 truncate max-w-0">
                      <div className="flex items-center gap-2">
                        <FileText className="w-3 h-3 text-muted-foreground shrink-0" />
                        <span className="truncate text-[hsl(var(--status-direct))]">{r.file_name}</span>
                      </div>
                    </td>
                    <td className="px-3 text-muted-foreground">Structural</td>
                    <td className="px-3"><Pill tone="info">{r.revision}</Pill></td>
                    <td className="px-3">
                      {r.status === "ready" && <Pill tone="ok">Active</Pill>}
                      {r.status === "review" && <Pill tone="warn">Review</Pill>}
                      {r.status === "blocked" && <Pill tone="bad">Blocked</Pill>}
                      {r.status === "changed" && <Pill tone="info">Changed</Pill>}
                    </td>
                      <td className="px-3 h-[32px]">
                        {r.parse_status === "indexed" && r.indexed_rows > 0 ? (
                          <div className="text-[hsl(var(--status-supported))] flex items-center gap-1.5">
                            <CheckCircle2 className="w-3 h-3" /> {r.indexed_rows} indexed
                          </div>
                        ) : r.parse_status === "parsing" ? (
                          <div className="text-muted-foreground flex items-center gap-1.5">
                            <Loader2 className="w-3 h-3 animate-spin" /> Parsing…
                          </div>
                        ) : r.parse_status === "failed" || (r.parse_status === "indexed" && r.indexed_rows === 0) ? (
                          <div className="text-[hsl(var(--status-blocked))] flex items-center gap-1.5" title={r.parse_error || "Indexing produced zero rows for this file."}>
                            <AlertTriangle className="w-3 h-3" /> {r.parse_status === "failed" ? "Failed" : "0 rows"}
                          </div>
                        ) : (
                          <div className="text-muted-foreground flex items-center gap-1.5">
                            <FileText className="w-3 h-3" /> Pending
                          </div>
                        )}
                      </td>
                    <td className="px-3 text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Detail */}
      <div className="col-span-4 flex flex-col min-h-0" style={{ background: "hsl(var(--card))" }}>
        <StageHeader kicker={sel ? `Preview · ${sel.revision}` : "Preview"} title={sel ? sel.file_name : "Select a drawing"} />
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {!sel ? (
            <EmptyState title="No drawing selected" />
          ) : (
            <>
              <DrawingPreview file={sel} />
              <div>
                <div className="ip-kicker mb-2">Metadata</div>
                <div className="grid grid-cols-2 gap-2 text-[12px]">
                  <Field label="Revision" value={sel.revision} />
                  <Field label="Status" value={sel.status} />
                  <Field
                    label="Parse"
                    value={
                      sel.parse_status === "indexed" && sel.indexed_rows > 0
                        ? `${sel.indexed_rows} indexed row${sel.indexed_rows === 1 ? "" : "s"}`
                        : sel.parse_status === "failed"
                          ? "Failed"
                          : sel.parse_status === "parsing"
                            ? "Parsing…"
                            : sel.indexed_rows === 0 && sel.parse_status === "indexed"
                              ? "0 indexed rows"
                              : "Pending"
                    }
                  />
                  <Field label="Size" value={sel.file_size ? `${Math.round(sel.file_size / 1024)} KB` : "—"} />
                  <Field label="Uploaded" value={new Date(sel.created_at).toLocaleDateString()} />
                </div>
              </div>
              {sel.parse_error && (
                <div className="border border-[hsl(var(--status-blocked))]/40 bg-[hsl(var(--status-blocked))]/5 px-3 py-2 text-[11px] text-[hsl(var(--status-blocked))]">
                  {sel.parse_error}
                </div>
              )}
              <div className="space-y-2">
                <div className="ip-kicker">Route Action</div>
                <div className="grid grid-cols-2 gap-2">
                  <ActionBtn icon={<CheckCircle2 className="w-3 h-3" />} label="Mark Ready" onClick={() => setStatus(sel.id, "ready")} />
                  <ActionBtn icon={<AlertTriangle className="w-3 h-3" />} label="Needs Review" onClick={() => setStatus(sel.id, "review")} tone="warn" />
                  <ActionBtn label="Mark Changed" onClick={() => setStatus(sel.id, "changed")} tone="info" />
                  <ActionBtn label="Block" onClick={() => setStatus(sel.id, "blocked")} tone="bad" />
                </div>
              </div>
              <div className="ip-card p-3 text-[12px]">
                <div className="ip-kicker mb-2">Revisions History</div>
                <div className="space-y-1.5 tabular-nums">
                  <div className="flex justify-between"><span className="text-foreground">{sel.revision} (Active)</span><span className="text-muted-foreground">{new Date(sel.created_at).toLocaleDateString()}</span></div>
                  <div className="flex justify-between text-muted-foreground"><span>R0 (Initial)</span><span>—</span></div>
                </div>
              </div>
              <div className="ip-card p-3 text-[12px]">
                <div className="ip-kicker mb-2">Downstream Awareness</div>
                <ul className="space-y-1 text-muted-foreground text-[11px]">
                  <li>→ Feeds Scope Review candidates</li>
                  <li>→ Linked to Takeoff evidence</li>
                  <li>→ Revision changes flag QA Gate</li>
                </ul>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DrawingPreview({ file }: { file: Row }) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canPreview = isPdfFile(file) || isImageFile(file);

  useEffect(() => {
    let cancelled = false;
    setSignedUrl(null);
    setPreviewUrl(null);
    setPageCount(0);
    setCurrentPage(1);
    setError(null);
    setLoading(true);

    if (!canPreview) {
      setLoading(false);
      return () => { cancelled = true; };
    }

    supabase.storage
      .from("blueprints")
      .createSignedUrl(file.file_path, 3600)
      .then(({ data, error: urlError }) => {
        if (cancelled) return;
        if (urlError || !data?.signedUrl) {
          console.warn("Drawing preview signed URL failed:", urlError);
          setError("Preview unavailable");
          setLoading(false);
          return;
        }

        setSignedUrl(data.signedUrl);
        if (isImageFile(file)) {
          setPreviewUrl(data.signedUrl);
        }
      });

    return () => { cancelled = true; };
  }, [file.id, file.file_path, canPreview]);

  const isPdf = isPdfFile(file);

  const goToPage = (next: number) => {
    if (next < 1 || next > pageCount || next === currentPage) return;
    setPreviewUrl(null);
    setLoading(true);
    setCurrentPage(next);
  };

  return (
    <div className="relative min-h-[480px] overflow-hidden border border-border bg-background">
      {signedUrl && isPdf && (
        <PdfRenderer
          url={signedUrl}
          currentPage={currentPage}
          scale={1.5}
          onPageCount={setPageCount}
          onPageRendered={(imageDataUrl) => {
            setPreviewUrl(imageDataUrl);
            setLoading(false);
          }}
        />
      )}

      {previewUrl ? (
        <img
          src={previewUrl}
          alt={file.file_name}
          className="block w-full h-auto max-h-[70vh] object-contain mx-auto"
          onLoad={() => setLoading(false)}
          onError={() => {
            setError("Preview unavailable");
            setLoading(false);
          }}
        />
      ) : (
        <div className="grid min-h-[480px] place-items-center text-muted-foreground">
          {loading ? <Loader2 className="h-7 w-7 animate-spin opacity-70" /> : <ImageIcon className="h-8 w-8 opacity-40" />}
        </div>
      )}

      {error && (
        <div className="absolute inset-x-3 bottom-3 border border-border bg-card/95 px-3 py-2 text-[11px] text-muted-foreground">
          {error}
        </div>
      )}

      {isPdf && pageCount > 1 && (
        <>
          <button
            type="button"
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage <= 1 || loading}
            className="absolute left-2 top-1/2 -translate-y-1/2 h-8 w-8 grid place-items-center border border-border bg-card/95 text-foreground disabled:opacity-30 hover:bg-card"
            aria-label="Previous page"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage >= pageCount || loading}
            className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 grid place-items-center border border-border bg-card/95 text-foreground disabled:opacity-30 hover:bg-card"
            aria-label="Next page"
          >
            ›
          </button>
          <div className="absolute right-2 top-2 border border-border bg-card/95 px-2 py-1 text-[10px] text-muted-foreground tabular-nums">
            {currentPage} / {pageCount}
          </div>
        </>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border bg-background px-2 py-1.5">
      <div className="ip-kicker">{label}</div>
      <div className="truncate text-[12px] mt-0.5">{value}</div>
    </div>
  );
}
function ActionBtn({ label, onClick, icon, tone = "default" }: { label: string; onClick: () => void; icon?: React.ReactNode; tone?: "default" | "warn" | "bad" | "info" }) {
  const cls = {
    default: "border-primary/40 text-primary hover:bg-primary/10",
    warn: "border-[hsl(var(--status-inferred))]/50 text-[hsl(var(--status-inferred))] hover:bg-[hsl(var(--status-inferred))]/10",
    bad: "border-[hsl(var(--status-blocked))]/50 text-[hsl(var(--status-blocked))] hover:bg-[hsl(var(--status-blocked))]/10",
    info: "border-[hsl(var(--status-direct))]/50 text-[hsl(var(--status-direct))] hover:bg-[hsl(var(--status-direct))]/10",
  }[tone];
  return (
    <button onClick={onClick} className={`inline-flex items-center justify-center gap-1.5 px-2 h-8 text-[10px] font-semibold uppercase tracking-[0.12em] border ${cls}`}>
      {icon}{label}
    </button>
  );
}
