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

interface Row {
  id: string;
  legacy_file_id?: string | null;
  file_name: string;
  file_path: string;
  created_at: string;
  file_size?: number | null;
  revision: string;
  status: "ready" | "review" | "blocked" | "changed";
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

  const rows: Row[] = state.files.map((f) => ({
    ...f,
    revision: inferRevision(f.file_name),
    status: (state.local.fileStatus?.[f.id] as Row["status"]) || "review",
  }));

  useEffect(() => { if (!selectedId && rows[0]) setSelectedId(rows[0].id); }, [rows, selectedId]);
  const sel = rows.find((r) => r.id === selectedId) || null;

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fl = e.target.files; if (!fl || !user) return;
    setUploading(true);
    let ok = 0;

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
    if (inputRef.current) inputRef.current.value = "";
    state.refresh();
  };

  const setStatus = (id: string, status: Row["status"]) => {
    const cur = (state.local.fileStatus as any) || {};
    state.setLocal({ fileStatus: { ...cur, [id]: status } });
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
            <button
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-2 px-3 h-8 text-[11px] font-semibold uppercase tracking-[0.12em] border border-primary text-primary hover:bg-primary/10 disabled:opacity-50"
            >
              <Upload className="w-3.5 h-3.5" /> {uploading ? "Uploading..." : "Upload New Sheets"}
            </button>
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
                    <td className="px-3 text-[hsl(var(--status-supported))] flex items-center gap-1.5 h-[32px]">
                      <CheckCircle2 className="w-3 h-3" /> Complete
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
                  <Field label="Size" value={sel.file_size ? `${Math.round(sel.file_size / 1024)} KB` : "—"} />
                  <Field label="Uploaded" value={new Date(sel.created_at).toLocaleDateString()} />
                </div>
              </div>
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
