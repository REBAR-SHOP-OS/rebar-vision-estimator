import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { FileText, Loader2 } from "lucide-react";

interface FileRow {
  id: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  created_at: string;
}

export default function FilesTab({ projectId }: { projectId: string }) {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    supabase
      .from("project_files")
      .select("id, file_name, file_type, file_size, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setFiles(data || []);
        setLoading(false);
      });
  }, [projectId]);

  if (loading) {
    return <div className="flex items-center justify-center h-40"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  }

  if (files.length === 0) {
    return <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">No files uploaded yet.</div>;
  }

  const fmtSize = (bytes: number | null) => {
    if (!bytes) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  return (
    <div className="p-4 md:p-6">
      <h3 className="text-sm font-semibold text-foreground mb-3">Files & Revisions</h3>
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/60">
            <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="text-left px-4 py-2.5 font-semibold">File</th>
              <th className="text-left px-3 py-2.5 font-semibold">Type</th>
              <th className="text-right px-3 py-2.5 font-semibold">Size</th>
              <th className="text-right px-3 py-2.5 font-semibold">Uploaded</th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.id} className="border-t border-border/50 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-2.5 flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="font-medium text-foreground truncate max-w-[300px]">{f.file_name}</span>
                </td>
                <td className="px-3 py-2.5">
                  {f.file_type ? <Badge variant="outline" className="text-[9px]">{f.file_type}</Badge> : "—"}
                </td>
                <td className="px-3 py-2.5 text-right text-muted-foreground">{fmtSize(f.file_size)}</td>
                <td className="px-3 py-2.5 text-right text-muted-foreground">{new Date(f.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
