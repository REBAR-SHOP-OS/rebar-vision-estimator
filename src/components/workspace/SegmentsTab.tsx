import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Layers, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { logAuditEvent } from "@/lib/audit-logger";
import { useNavigate } from "react-router-dom";

interface Segment {
  id: string;
  name: string;
  segment_type: string;
  level_label: string | null;
  zone_label: string | null;
  status: string;
  confidence: number;
  drawing_readiness: string;
  notes: string | null;
  created_at: string;
}

const SEGMENT_TYPES = [
  "footing", "slab", "wall", "beam", "column", "pier",
  "stair", "pit", "curb", "retaining_wall", "miscellaneous",
];

export default function SegmentsTab({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("miscellaneous");
  const [creating, setCreating] = useState(false);

  // Edit state
  const [editSegment, setEditSegment] = useState<Segment | null>(null);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState("");
  const [editLevel, setEditLevel] = useState("");
  const [editZone, setEditZone] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = () => {
    setLoading(true);
    supabase
      .from("segments")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        setSegments((data as Segment[]) || []);
        setLoading(false);
      });
  };

  useEffect(() => { load(); }, [projectId]);

  const handleCreate = async () => {
    if (!newName.trim() || !user) return;
    setCreating(true);
    const { error } = await supabase.from("segments").insert({
      project_id: projectId,
      user_id: user.id,
      name: newName.trim(),
      segment_type: newType,
    });
    if (error) { toast.error("Failed to create segment"); }
    else { toast.success("Segment created"); setNewName(""); setDialogOpen(false); load(); }
    setCreating(false);
  };

  const handleOpenEdit = (s: Segment, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditSegment(s);
    setEditName(s.name);
    setEditType(s.segment_type);
    setEditLevel(s.level_label || "");
    setEditZone(s.zone_label || "");
    setEditNotes(s.notes || "");
    setEditOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editSegment || !user || !editName.trim()) return;
    setEditSaving(true);
    const { error } = await supabase.from("segments").update({
      name: editName.trim(),
      segment_type: editType,
      level_label: editLevel.trim() || null,
      zone_label: editZone.trim() || null,
      notes: editNotes.trim() || null,
    }).eq("id", editSegment.id);
    if (error) toast.error("Failed to update segment");
    else {
      await logAuditEvent(user.id, "updated", "segment", editSegment.id, projectId);
      toast.success("Segment updated");
      setEditOpen(false);
      load();
    }
    setEditSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteId || !user) return;
    setDeleting(true);
    const seg = segments.find(s => s.id === deleteId);
    await logAuditEvent(user.id, "deleted", "segment", deleteId, projectId, undefined, { name: seg?.name });
    const { error } = await supabase.from("segments").delete().eq("id", deleteId);
    if (error) toast.error("Failed to delete segment");
    else { toast.success("Segment deleted"); load(); }
    setDeleteId(null);
    setDeleting(false);
  };

  const statusColor = (s: string) => {
    if (s === "approved") return "bg-[hsl(var(--status-approved))]/15 text-[hsl(var(--status-approved))]";
    if (s === "review") return "bg-[hsl(var(--status-review))]/15 text-[hsl(var(--status-review))]";
    return "bg-muted text-muted-foreground";
  };

  if (loading) {
    return <div className="flex items-center justify-center h-40"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  }

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground">Segments</h3>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5 h-8 text-xs"><Plus className="h-3.5 w-3.5" />Add Segment</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>New Segment</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Name</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Foundation F1" className="h-9 text-sm" />
              </div>
              <div>
                <Label className="text-xs">Type</Label>
                <Select value={newType} onValueChange={setNewType}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SEGMENT_TYPES.map((t) => (
                      <SelectItem key={t} value={t} className="text-sm capitalize">{t.replace(/_/g, " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleCreate} disabled={creating || !newName.trim()} className="w-full">
                {creating ? "Creating..." : "Create Segment"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {segments.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
          <Layers className="h-8 w-8" />
          <p className="text-sm">No segments yet. Add one to start estimating.</p>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/60">
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="text-left px-4 py-2.5 font-semibold">Segment</th>
                <th className="text-left px-3 py-2.5 font-semibold">Type</th>
                <th className="text-left px-3 py-2.5 font-semibold">Level</th>
                <th className="text-left px-3 py-2.5 font-semibold">Status</th>
                <th className="text-right px-3 py-2.5 font-semibold">Confidence</th>
                <th className="text-left px-3 py-2.5 font-semibold">Drawing</th>
              </tr>
            </thead>
            <tbody>
              {segments.map((s) => (
                <tr
                  key={s.id}
                  onClick={() => navigate(`/app/project/${projectId}/segments/${s.id}`)}
                  className="border-t border-border/50 hover:bg-muted/20 transition-colors cursor-pointer"
                >
                  <td className="px-4 py-2.5 font-medium text-foreground">{s.name}</td>
                  <td className="px-3 py-2.5">
                    <Badge variant="outline" className="text-[9px] capitalize">{s.segment_type.replace(/_/g, " ")}</Badge>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{s.level_label || "—"}</td>
                  <td className="px-3 py-2.5">
                    <Badge className={`text-[9px] ${statusColor(s.status)}`}>{s.status}</Badge>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">
                    {s.confidence > 0 ? `${Math.round(Number(s.confidence) * 100)}%` : "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge variant="outline" className="text-[9px]">{s.drawing_readiness.replace(/_/g, " ")}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
