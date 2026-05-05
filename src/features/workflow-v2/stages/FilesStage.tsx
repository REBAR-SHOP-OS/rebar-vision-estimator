import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Upload, FileText, AlertTriangle, CheckCircle2 } from "lucide-react";
import { StageHeader, Pill, type StageProps, EmptyState } from "./_shared";

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
      <div className="col-span-7 border-r border-border flex flex-col min-h-0">
        <StageHeader
          kicker="Stage 01"
          title="Drawing Register"
          subtitle="Files create downstream awareness, not final decisions."
          right={
            <button
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-primary text-primary hover:bg-primary/10 disabled:opacity-50"
            >
              <Upload className="w-3 h-3" /> {uploading ? "Uploading..." : "Upload Drawings"}
            </button>
          }
        />
        <div className="flex-1 overflow-auto">
          {rows.length === 0 ? (
            <EmptyState title="No drawings registered" hint="Upload PDF or image drawings to begin scope review." />
          ) : (
            <table className="w-full text-xs font-mono">
              <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 w-10">#</th>
                  <th className="text-left px-3 py-2">Sheet / File</th>
                  <th className="text-left px-3 py-2 w-16">Rev</th>
                  <th className="text-left px-3 py-2 w-24">Status</th>
                  <th className="text-left px-3 py-2 w-32">Downstream Impact</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id}
                    onClick={() => setSelectedId(r.id)}
                    className={`border-t border-border cursor-pointer ${selectedId === r.id ? "bg-primary/5" : "hover:bg-muted/30"}`}>
                    <td className="px-3 py-2 text-muted-foreground">{String(i + 1).padStart(2, "0")}</td>
                    <td className="px-3 py-2 truncate max-w-0">
                      <div className="flex items-center gap-2">
                        <FileText className="w-3 h-3 text-muted-foreground shrink-0" />
                        <span className="truncate">{r.file_name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2"><Pill tone="info">{r.revision}</Pill></td>
                    <td className="px-3 py-2">
                      {r.status === "ready" && <Pill tone="ok">Ready</Pill>}
                      {r.status === "review" && <Pill tone="warn">Review</Pill>}
                      {r.status === "blocked" && <Pill tone="bad">Blocked</Pill>}
                      {r.status === "changed" && <Pill tone="info">Changed</Pill>}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">→ Scope · Takeoff</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Detail */}
      <div className="col-span-5 flex flex-col min-h-0 bg-muted/20">
        <StageHeader kicker="Detail" title={sel ? sel.file_name : "Select a drawing"} />
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {!sel ? (
            <EmptyState title="No drawing selected" />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                <Field label="Revision" value={sel.revision} />
                <Field label="Uploaded" value={new Date(sel.created_at).toLocaleString()} />
                <Field label="Size" value={sel.file_size ? `${Math.round(sel.file_size / 1024)} KB` : "—"} />
                <Field label="Status" value={sel.status} />
              </div>
              <div className="space-y-2">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Route Action</div>
                <div className="grid grid-cols-2 gap-2">
                  <ActionBtn icon={<CheckCircle2 className="w-3 h-3" />} label="Mark Ready" onClick={() => setStatus(sel.id, "ready")} />
                  <ActionBtn icon={<AlertTriangle className="w-3 h-3" />} label="Needs Review" onClick={() => setStatus(sel.id, "review")} tone="warn" />
                  <ActionBtn label="Mark Changed" onClick={() => setStatus(sel.id, "changed")} tone="info" />
                  <ActionBtn label="Block" onClick={() => setStatus(sel.id, "blocked")} tone="bad" />
                </div>
              </div>
              <div className="border border-border bg-card p-3 text-xs">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Downstream Awareness</div>
                <ul className="space-y-1 text-muted-foreground">
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
    <div className="border border-border bg-card px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="truncate">{value}</div>
    </div>
  );
}
function ActionBtn({ label, onClick, icon, tone = "default" }: { label: string; onClick: () => void; icon?: React.ReactNode; tone?: "default" | "warn" | "bad" | "info" }) {
  const cls = {
    default: "border-border hover:bg-muted",
    warn: "border-yellow-500/40 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/10",
    bad: "border-destructive/40 text-destructive hover:bg-destructive/10",
    info: "border-blue-500/40 text-blue-600 dark:text-blue-400 hover:bg-blue-500/10",
  }[tone];
  return (
    <button onClick={onClick} className={`inline-flex items-center justify-center gap-1.5 px-2 py-1.5 text-[10px] font-mono uppercase tracking-wider border ${cls}`}>
      {icon}{label}
    </button>
  );
}