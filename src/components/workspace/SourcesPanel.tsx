import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, Link2, Plus, Loader2, Unlink, ExternalLink } from "lucide-react";
import { toast } from "sonner";

interface SourceLink {
  id: string;
  file_id: string;
  file_name: string;
  file_type: string | null;
  linked_at: string;
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
    // Get segment source links from estimate_items that have source references
    const [filesRes, itemsRes] = await Promise.all([
      supabase.from("project_files").select("id, file_name, file_type").eq("project_id", projectId),
      supabase.from("estimate_items").select("id, description, assumptions_json").eq("segment_id", segmentId),
    ]);

    const files = filesRes.data || [];
    setAvailableFiles(files);

    // Extract linked file IDs from estimate items' assumptions_json.source_file_ids
    const linkedFileIds = new Set<string>();
    (itemsRes.data || []).forEach((item: any) => {
      const srcIds = item.assumptions_json?.source_file_ids;
      if (Array.isArray(srcIds)) srcIds.forEach((id: string) => linkedFileIds.add(id));
    });

    const linked: SourceLink[] = files
      .filter((f) => linkedFileIds.has(f.id))
      .map((f) => ({ id: f.id, file_id: f.id, file_name: f.file_name, file_type: f.file_type, linked_at: "" }));

    setSources(linked);
    setLoading(false);
  };

  useEffect(() => { load(); }, [segmentId, projectId]);

  const handleLink = async () => {
    if (!selectedFileId || !user) return;
    setLinking(true);
    // Store source link in an estimate_items assumptions_json entry for this segment
    // Create a placeholder estimate item to hold the source link
    const { error } = await supabase.from("estimate_items").insert({
      segment_id: segmentId,
      project_id: projectId,
      user_id: user.id,
      description: `Source: ${availableFiles.find(f => f.id === selectedFileId)?.file_name || "file"}`,
      item_type: "source_link",
      assumptions_json: { source_file_ids: [selectedFileId] },
    });
    if (error) toast.error("Failed to link source");
    else { toast.success("Source linked"); setDialogOpen(false); setSelectedFileId(""); load(); }
    setLinking(false);
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
                  {s.file_type && <Badge variant="outline" className="text-[9px] mt-0.5">{s.file_type}</Badge>}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" title="View file">
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
