import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Loader2, AlertTriangle, CheckCircle2, Clock, Archive, Upload, Eye } from "lucide-react";
import { computeSHA256 } from "@/lib/file-hash";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { logAuditEvent } from "@/lib/audit-logger";

interface FileRow {
  id: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  file_path: string;
  created_at: string;
  discipline?: string;
  revision_label?: string;
  parse_status?: string;
  is_superseded?: boolean;
}

export default function FilesTab({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const [files, setFiles] = useState<FileRow[]>([]);
  const [segmentCounts, setSegmentCounts] = useState<Record<string, number>>({});
  const [issueCounts, setIssueCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");

  useEffect(() => { loadFiles(); }, [projectId]);

  const detectDiscipline = (name: string): string | null => {
    const n = name.toUpperCase();
    if (/\bS[-_]?\d|STRUCTURAL|STR[-_]/i.test(n)) return "Structural";
    if (/\bA[-_]?\d|ARCHITECTURAL|ARCH[-_]/i.test(n)) return "Architectural";
    if (/\bC[-_]?\d|CIVIL/i.test(n)) return "Civil";
    if (/\bM[-_]?\d|MECHANICAL/i.test(n)) return "Mechanical";
    if (/\bE[-_]?\d|ELECTRICAL/i.test(n)) return "Electrical";
    if (/\bP[-_]?\d|PLUMBING/i.test(n)) return "Plumbing";
    if (/\bL[-_]?\d|LANDSCAPE/i.test(n)) return "Landscape";
    return null;
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0 || !user) return;
    const files = Array.from(fileList);
    setUploading(true);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setUploadProgress(`${i + 1}/${files.length}`);
      const path = `${user.id}/${projectId}/${Date.now()}_${file.name}`;
      const { error: storageErr } = await supabase.storage.from("blueprints").upload(path, file);
      if (storageErr) { toast.error(`Upload failed: ${file.name}`); continue; }
      const { data, error: dbErr } = await supabase.from("project_files").insert({
        project_id: projectId,
        user_id: user.id,
        file_name: file.name,
        file_path: path,
        file_type: file.type || null,
        file_size: file.size,
      }).select("id").single();
      if (dbErr) { toast.error(`Failed to save: ${file.name}`); continue; }

      // Create document_version with discipline tag
      const discipline = detectDiscipline(file.name);
      try {
        const hash = await computeSHA256(file);
        await supabase.from("document_versions").insert({
          project_id: projectId,
          user_id: user.id,
          file_id: data.id,
          file_name: file.name,
          file_path: path,
          sha256: hash,
          source_system: "upload",
          pdf_metadata: discipline ? { discipline } : {},
        });
      } catch (_) { /* hash/version insert is best-effort */ }

      await logAuditEvent(user.id, "uploaded", "project_file", data.id, projectId);
    }
    toast.success(`${files.length} file${files.length > 1 ? "s" : ""} uploaded`);
    loadFiles();
    // Trigger automatic processing pipeline
    supabase.functions.invoke("process-pipeline", { body: { project_id: projectId } }).catch(console.warn);
    setUploading(false);
    setUploadProgress("");
    e.target.value = "";
  };

  const handleViewFile = async (filePath: string) => {
    const { data } = await supabase.storage.from("blueprints").createSignedUrl(filePath, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
    else toast.error("Could not generate file URL");
  };

  const loadFiles = () => {
    setLoading(true);
    Promise.all([
      supabase.from("project_files").select("id, file_name, file_type, file_size, file_path, created_at").eq("project_id", projectId).order("created_at", { ascending: false }),
      supabase.from("document_versions").select("file_id, source_system, pdf_metadata").eq("project_id", projectId),
      supabase.from("segment_source_links").select("file_id"),
      supabase.from("validation_issues").select("source_file_id, status").eq("project_id", projectId),
    ]).then(([filesRes, versionsRes, linksRes, issuesRes]) => {
      const rawFiles = filesRes.data || [];
      const versions = versionsRes.data || [];
      const versionMap = new Map<string, any>();
      versions.forEach((v: any) => { if (v.file_id) versionMap.set(v.file_id, v); });
      const segCounts: Record<string, number> = {};
      (linksRes.data || []).forEach((link: any) => {
        if (link.file_id) segCounts[link.file_id] = (segCounts[link.file_id] || 0) + 1;
      });
      setSegmentCounts(segCounts);
      const issCounts: Record<string, number> = {};
      (issuesRes.data || []).forEach((iss: any) => {
        if (iss.source_file_id && iss.status === "open") issCounts[iss.source_file_id] = (issCounts[iss.source_file_id] || 0) + 1;
      });
      setIssueCounts(issCounts);
      const enriched: FileRow[] = rawFiles.map((f: any) => {
        const ver = versionMap.get(f.id);
        return {
          ...f,
          discipline: ver?.pdf_metadata?.discipline || undefined,
          revision_label: ver?.pdf_metadata?.revision_label || undefined,
          parse_status: ver ? "parsed" : "pending",
          is_superseded: ver?.pdf_metadata?.is_superseded || false,
        };
      });
      setFiles(enriched);
      setLoading(false);
    });
  };

  if (loading) {
    return <div className="flex items-center justify-center h-40"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  }

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-3">
        <FileText className="h-8 w-8" />
        <p className="text-sm">No files uploaded yet.</p>
        <p className="text-[10px]">Upload structural drawings to begin estimation.</p>
        <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs relative" disabled={uploading}>
          {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
          {uploading ? `Uploading ${uploadProgress}…` : "Upload Files"}
          <input type="file" multiple className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleUpload} accept="*" />
        </Button>
      </div>
    );
  }

  const fmtSize = (bytes: number | null) => {
    if (!bytes) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  const parseIcon = (status: string) => {
    if (status === "parsed") return <CheckCircle2 className="h-3 w-3 text-[hsl(var(--status-approved))]" />;
    if (status === "review_needed") return <AlertTriangle className="h-3 w-3 text-[hsl(var(--status-review))]" />;
    if (status === "failed") return <AlertTriangle className="h-3 w-3 text-destructive" />;
    return <Clock className="h-3 w-3 text-muted-foreground" />;
  };

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground">Files & Revisions</h3>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-[10px]">{files.length} file{files.length !== 1 ? "s" : ""}</Badge>
          {files.some(f => f.parse_status === "pending") && (
            <Button size="sm" variant="default" className="gap-1.5 h-7 text-xs" disabled={parsing} onClick={handleParseAll}>
              {parsing ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
              {parsing ? "Parsing…" : "Parse All"}
            </Button>
          )}
          <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs relative" disabled={uploading}>
            {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
            {uploading ? `Uploading ${uploadProgress}…` : "Upload"}
            <input type="file" multiple className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleUpload} accept=".pdf,.dwg,.dxf,.xlsx,.csv,.png,.jpg" />
          </Button>
        </div>
      </div>
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/60">
            <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="text-left px-4 py-2.5 font-semibold">File</th>
              <th className="text-left px-3 py-2.5 font-semibold">Discipline</th>
              <th className="text-left px-3 py-2.5 font-semibold">Rev</th>
              <th className="text-center px-3 py-2.5 font-semibold">Parse</th>
              <th className="text-right px-3 py-2.5 font-semibold">Size</th>
              <th className="text-center px-3 py-2.5 font-semibold">Links</th>
              <th className="text-center px-3 py-2.5 font-semibold">Issues</th>
              <th className="text-right px-3 py-2.5 font-semibold">Uploaded</th>
              <th className="text-center px-3 py-2.5 font-semibold">View</th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.id} className={`border-t border-border/50 hover:bg-muted/20 transition-colors ${f.is_superseded ? "opacity-50" : ""}`}>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="font-medium text-foreground truncate max-w-[250px]">{f.file_name}</span>
                    {f.is_superseded && <Badge variant="outline" className="text-[8px] border-destructive/30 text-destructive flex-shrink-0"><Archive className="h-2.5 w-2.5 mr-0.5" />Superseded</Badge>}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  {f.discipline ? <Badge variant="outline" className="text-[9px]">{f.discipline}</Badge> : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-3 py-2.5 text-muted-foreground font-mono">{f.revision_label || "—"}</td>
                <td className="px-3 py-2.5 text-center">
                  <div className="flex items-center justify-center gap-1">
                    {parseIcon(f.parse_status || "pending")}
                    <span className="text-[9px] text-muted-foreground capitalize">{f.parse_status || "pending"}</span>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right text-muted-foreground">{fmtSize(f.file_size)}</td>
                <td className="px-3 py-2.5 text-center">
                  {(segmentCounts[f.id] || 0) > 0 ? (
                    <Badge variant="secondary" className="text-[9px]">{segmentCounts[f.id]} seg</Badge>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-3 py-2.5 text-center">
                  {(issueCounts[f.id] || 0) > 0 ? (
                    <Badge variant="destructive" className="text-[9px]">{issueCounts[f.id]}</Badge>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-3 py-2.5 text-right text-muted-foreground">{new Date(f.created_at).toLocaleDateString()}</td>
                <td className="px-3 py-2.5 text-center">
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleViewFile(f.file_path)} title="View file">
                    <Eye className="h-3 w-3" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
