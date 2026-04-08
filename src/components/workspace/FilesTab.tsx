import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, Loader2, ExternalLink, AlertTriangle, CheckCircle2, Clock, Archive } from "lucide-react";
import { toast } from "sonner";

interface FileRow {
  id: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  created_at: string;
  // Extended fields stored via metadata approach
  discipline?: string;
  revision_label?: string;
  parse_status?: string;
  is_superseded?: boolean;
}

const DISCIPLINES = ["Structural", "Architectural", "Civil", "Mechanical", "Electrical", "Other"];
const PARSE_STATUSES = ["pending", "parsed", "review_needed", "failed"];

export default function FilesTab({ projectId }: { projectId: string }) {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [segmentCounts, setSegmentCounts] = useState<Record<string, number>>({});
  const [issueCounts, setIssueCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      supabase.from("project_files").select("id, file_name, file_type, file_size, created_at").eq("project_id", projectId).order("created_at", { ascending: false }),
      supabase.from("document_versions").select("file_id, source_system, pdf_metadata").eq("project_id", projectId),
      supabase.from("estimate_items").select("assumptions_json").eq("project_id", projectId),
      supabase.from("validation_issues").select("sheet_id, status").eq("project_id", projectId),
    ]).then(([filesRes, versionsRes, itemsRes, issuesRes]) => {
      const rawFiles = filesRes.data || [];
      const versions = versionsRes.data || [];
      const versionMap = new Map<string, any>();
      versions.forEach((v: any) => { if (v.file_id) versionMap.set(v.file_id, v); });

      // Count segments linked per file via assumptions_json.source_file_ids
      const segCounts: Record<string, number> = {};
      (itemsRes.data || []).forEach((item: any) => {
        const ids = item.assumptions_json?.source_file_ids;
        if (Array.isArray(ids)) ids.forEach((id: string) => { segCounts[id] = (segCounts[id] || 0) + 1; });
      });
      setSegmentCounts(segCounts);

      // Count issues per sheet_id (using file id as proxy)
      const issCounts: Record<string, number> = {};
      (issuesRes.data || []).forEach((iss: any) => {
        if (iss.sheet_id && iss.status === "open") issCounts[iss.sheet_id] = (issCounts[iss.sheet_id] || 0) + 1;
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
  }, [projectId]);

  if (loading) {
    return <div className="flex items-center justify-center h-40"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  }

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
        <FileText className="h-8 w-8" />
        <p className="text-sm">No files uploaded yet.</p>
        <p className="text-[10px]">Upload structural drawings to begin estimation.</p>
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
        <Badge variant="secondary" className="text-[10px]">{files.length} file{files.length !== 1 ? "s" : ""}</Badge>
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
