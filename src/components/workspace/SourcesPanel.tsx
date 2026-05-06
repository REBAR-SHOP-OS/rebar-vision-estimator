import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, Link2, Plus, Loader2, Unlink, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { logAuditEvent } from "@/lib/audit-logger";

interface SourceLink {
  id: string;
  file_id: string;
  file_name: string;
  file_type: string | null;
  linked_at: string;
  file_path: string;
}

interface ProjectFile {
  id: string;
  file_name: string;
  file_type: string | null;
}

export default function SourcesPanel({ segmentId, projectId }: { segmentId: string; projectId: string }) {
  const { user } = useAuth();
  const [sources, setSources] = useState<SourceLink[]>([]);
  const [availableFiles, setAvailableFiles] = useState<ProjectFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedFileId, setSelectedFileId] = useState("");
  const [linking, setLinking] = useState(false);

  const load = async () => {
    setLoading(true);
    const [filesRes, linksRes] = await Promise.all([
      supabase.from("project_files").select("id, file_name, file_type, file_path").eq("project_id", projectId),
      supabase.from("segment_source_links").select("id, file_id, linked_at").eq("segment_id", segmentId),
    ]);

    const files = filesRes.data || [];
    const links = linksRes.data || [];
    setAvailableFiles(files);

    const linked: SourceLink[] = links.map((link: any) => {
      const file = files.find((f) => f.id === link.file_id);
      return {
        id: link.id,
        file_id: link.file_id,
        file_name: file?.file_name || "Unknown file",
        file_type: file?.file_type || null,
        linked_at: link.linked_at || "",
        file_path: (file as any)?.file_path || "",
      };
    });

    setSources(linked);
    setLoading(false);
  };

  useEffect(() => { load(); }, [segmentId, projectId]);

  const handleLink = async () => {
    if (!selectedFileId || !user) return;
    setLinking(true);
    const { error } = await supabase.from("segment_source_links").insert({
      segment_id: segmentId,
      file_id: selectedFileId,
      user_id: user.id,
    });
    if (error) {
      toast.error(error.code === "23505" ? "File already linked" : "Failed to link source");
    } else {
      await logAuditEvent(user.id, "linked", "source_link", selectedFileId, projectId, segmentId, {
        file_name: availableFiles.find(f => f.id === selectedFileId)?.file_name,
      });
      toast.success("Source linked");
      setDialogOpen(false);
      setSelectedFileId("");
      load();
    }
    setLinking(false);
  };

  const handleUnlink = async (linkId: string, fileId: string, fileName: string) => {
    if (!user) return;
    const { error } = await supabase.from("segment_source_links").delete().eq("id", linkId);
    if (error) toast.error("Failed to unlink");
    else {
      await logAuditEvent(user.id, "unlinked", "source_link", fileId, projectId, segmentId, { file_name: fileName });
      toast.success("Source unlinked");
      load();
    }
  };

  const unlinkedFiles = availableFiles.filter((f) => !sources.find((s) => s.file_id === f.id));

  if (loading) {
    return <div className="flex items-center justify-center h-40"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Link2 className="h-4 w-4 text-muted-foreground" />
          Linked Source Files
        </h4>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs" disabled={unlinkedFiles.length === 0}>
              <Plus className="h-3 w-3" />Link File
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle className="text-sm">Link Source File to Segment</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Select value={selectedFileId} onValueChange={setSelectedFileId}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select a project file…" /></SelectTrigger>
                <SelectContent>
                  {unlinkedFiles.map((f) => (
                    <SelectItem key={f.id} value={f.id} className="text-sm">{f.file_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={handleLink} disabled={linking || !selectedFileId} className="w-full" size="sm">
                {linking ? "Linking…" : "Link Source"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {sources.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2 border border-dashed border-border rounded-lg">
          <FileText className="h-6 w-6" />
          <p className="text-xs">No source files linked to this segment yet.</p>
          <p className="text-[10px]">Link project files to establish traceability.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sources.map((s) => (
            <div key={s.id} className="flex items-center justify-between border border-border rounded-lg p-3 hover:bg-muted/20 transition-colors">
              <div className="flex items-center gap-2.5 min-w-0">
                <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{s.file_name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {s.file_type && <Badge variant="outline" className="text-[9px]">{s.file_type}</Badge>}
                    {s.linked_at && <span className="text-[9px] text-muted-foreground">{new Date(s.linked_at).toLocaleDateString()}</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" title="View file" onClick={async () => {
                  if (!s.file_path) { toast.error("No file path available"); return; }
                  const { data } = await supabase.storage.from("blueprints").createSignedUrl(s.file_path, 3600);
                  if (data?.signedUrl) window.open(data.signedUrl, "_blank");
                  else toast.error("Could not generate file URL");
                }}>
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" title="Unlink" onClick={() => handleUnlink(s.id, s.file_id, s.file_name)}>
                  <Unlink className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
