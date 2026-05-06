import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Upload, FileText, AlertTriangle, CheckCircle2, ImageIcon } from "lucide-react";
import { StageHeader, Pill, type StageProps, EmptyState, GateBanner } from "./_shared";

interface Row {
  id: string;
  file_name: string;
  file_path: string;
  created_at: string;
  file_size?: number | null;
  revision: string;
  status: "ready" | "review" | "blocked" | "changed";
}

function inferRevision(name: string): string {
  const m = name.match(/[_\s\-](rev|r|v)[_\-\s]?([0-9]+)/i);
  return m ? `R${m[2]}` : "R0";
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
    for (const file of Array.from(fl)) {
      const path = `${user.id}/${projectId}/${Date.now()}_${file.name}`;
      const up = await supabase.storage.from("blueprints").upload(path, file);
      if (up.error) { toast.error(`Upload failed: ${file.name}`); continue; }
      await supabase.from("project_files").insert({
        project_id: projectId, user_id: user.id,
        file_name: file.name, file_path: path, file_type: file.type || null, file_size: file.size,
      });
      ok++;
    }
    setUploading(false);
    if (ok) toast.success(`${ok} file${ok > 1 ? "s" : ""} uploaded`);
    if (inputRef.current) inputRef.current.value = "";
    state.refresh();
  };

  const setStatus = (id: string, status: Row["status"]) => {
    const cur = state.local.fileStatus || {};
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
              <Upload className="w-3.5 h-3.5" /> {uploading ? "Uploading…" : "Upload New Sheets"}
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
              <div className="aspect-video border border-border bg-background grid place-items-center text-muted-foreground">
                <ImageIcon className="w-8 h-8 opacity-40" />
              </div>
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