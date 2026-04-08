import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Plus, Layers, Pencil, Trash2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { logAuditEvent } from "@/lib/audit-logger";
import { useNavigate } from "react-router-dom";
import { getMassKgPerM } from "@/lib/rebar-weights";

interface SegmentSuggestion {
  name: string;
  segment_type: string;
  level_label: string | null;
  zone_label: string | null;
  notes: string | null;
  selected: boolean;
}

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

  // Auto-detect state
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [suggestions, setSuggestions] = useState<SegmentSuggestion[]>([]);
  const [autoDialogOpen, setAutoDialogOpen] = useState(false);
  const [autoCreating, setAutoCreating] = useState(false);

  // Stats per segment: items count, bar count, computed weight
  const [segStats, setSegStats] = useState<Record<string, { items: number; bars: number; weightKg: number }>>({});
  // Scope coverage: does this segment type have matching files?
  const [scopeCoverage, setScopeCoverage] = useState<Record<string, "drawing" | "inferred">>({}); 

  const loadStats = async (segIds: string[]) => {
    if (segIds.length === 0) return;
    const [barRes, estRes] = await Promise.all([
      supabase.from("bar_items").select("segment_id, size, quantity, cut_length").in("segment_id", segIds),
      supabase.from("estimate_items").select("segment_id").in("segment_id", segIds),
    ]);
    const stats: Record<string, { items: number; bars: number; weightKg: number }> = {};
    for (const id of segIds) stats[id] = { items: 0, bars: 0, weightKg: 0 };
    for (const e of estRes.data || []) {
      if (stats[e.segment_id]) stats[e.segment_id].items++;
    }
    for (const b of barRes.data || []) {
      if (!stats[b.segment_id]) continue;
      stats[b.segment_id].bars++;
      const qty = Number(b.quantity) || 0;
      const cutMm = Number(b.cut_length) || 0;
      stats[b.segment_id].weightKg += qty * (cutMm / 1000) * getMassKgPerM(b.size || "");
    }
    setSegStats(stats);
  };

  const handleAutoDetect = async () => {
    if (!user) return;
    setAutoDetecting(true);
    try {
      const { data, error } = await supabase.functions.invoke("auto-segments", {
        body: { projectId },
      });
      if (error) throw error;
      const items = (data?.suggestions || []).map((s: any) => ({ ...s, selected: true }));
      if (items.length === 0) {
        toast.info("No new segments suggested. Upload blueprints or define scope items first.");
      } else {
        setSuggestions(items);
        setAutoDialogOpen(true);
      }
    } catch (err: any) {
      toast.error(err.message || "Auto-detect failed");
    }
    setAutoDetecting(false);
  };

  const toggleSuggestion = (idx: number) => {
    setSuggestions(prev => prev.map((s, i) => i === idx ? { ...s, selected: !s.selected } : s));
  };

  const handleCreateSuggestions = async () => {
    if (!user) return;
    const selected = suggestions.filter(s => s.selected);
    if (selected.length === 0) { toast.error("Select at least one segment"); return; }
    setAutoCreating(true);
    let created = 0;
    for (const s of selected) {
      const { error, data: inserted } = await supabase.from("segments").insert({
        project_id: projectId,
        user_id: user.id,
        name: s.name,
        segment_type: s.segment_type,
        level_label: s.level_label,
        zone_label: s.zone_label,
        notes: s.notes,
      }).select("id").single();
      if (!error && inserted) {
        await logAuditEvent(user.id, "created", "segment", inserted.id, projectId, undefined, { source: "auto-detect" });
        created++;
      }
    }
    toast.success(`${created} segment${created !== 1 ? "s" : ""} created`);
    setAutoDialogOpen(false);
    setSuggestions([]);
    load();
    setAutoCreating(false);
  };

  const load = () => {
    setLoading(true);
    Promise.all([
      supabase.from("segments").select("*").eq("project_id", projectId).order("created_at", { ascending: true }),
      supabase.from("project_files").select("file_name").eq("project_id", projectId).limit(50),
    ]).then(([segResult, fileResult]) => {
      const segs = (segResult.data as Segment[]) || [];
      setSegments(segs);
      setLoading(false);
      loadStats(segs.map(s => s.id));

      // Determine scope coverage per segment based on file names
      const fNames = (fileResult.data || []).map((f: any) => (f.file_name || "").toUpperCase());
      const typeFilePatterns: Record<string, RegExp> = {
        footing: /FOUND|FTG|FOOT/i, pier: /PIER|PILE/i, slab: /SLAB/i, wall: /WALL/i,
        beam: /BEAM|FRM/i, column: /COL/i, stair: /STAIR/i, retaining_wall: /RETAIN/i,
      };
      const coverage: Record<string, "drawing" | "inferred"> = {};
      for (const s of segs) {
        const pattern = typeFilePatterns[s.segment_type];
        coverage[s.id] = pattern && fNames.some((n: string) => pattern.test(n)) ? "drawing" : "inferred";
      }
      setScopeCoverage(coverage);
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
    else {
      const { data: newSeg } = await supabase.from("segments").select("id").eq("project_id", projectId).eq("name", newName.trim()).order("created_at", { ascending: false }).limit(1).single();
      if (newSeg) await logAuditEvent(user.id, "created", "segment", newSeg.id, projectId);
      toast.success("Segment created"); setNewName(""); setDialogOpen(false); load();
    }
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
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={handleAutoDetect} disabled={autoDetecting}>
            {autoDetecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Auto-detect
          </Button>
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
                <th className="text-right px-3 py-2.5 font-semibold">Items</th>
                <th className="text-right px-3 py-2.5 font-semibold">Weight (kg)</th>
                <th className="text-right px-3 py-2.5 font-semibold">Confidence</th>
                <th className="text-left px-3 py-2.5 font-semibold">Drawing</th>
                <th className="text-right px-3 py-2.5 font-semibold">Actions</th>
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
                    {(segStats[s.id]?.items || 0) + (segStats[s.id]?.bars || 0) || "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">
                    {segStats[s.id]?.weightKg > 0 ? segStats[s.id].weightKg.toFixed(1) : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">
                    {s.confidence > 0 ? `${Math.round(Number(s.confidence) * 100)}%` : "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge variant="outline" className="text-[9px]">{s.drawing_readiness.replace(/_/g, " ")}</Badge>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => handleOpenEdit(s, e)}><Pencil className="h-3 w-3" /></Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteId(s.id); }}><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="text-sm">Edit Segment</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Name</Label><Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-9 text-sm" /></div>
            <div><Label className="text-xs">Type</Label>
              <Select value={editType} onValueChange={setEditType}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{SEGMENT_TYPES.map((t) => (<SelectItem key={t} value={t} className="text-sm capitalize">{t.replace(/_/g, " ")}</SelectItem>))}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">Level</Label><Input value={editLevel} onChange={(e) => setEditLevel(e.target.value)} className="h-9 text-sm" placeholder="e.g. L1" /></div>
              <div><Label className="text-xs">Zone</Label><Input value={editZone} onChange={(e) => setEditZone(e.target.value)} className="h-9 text-sm" placeholder="e.g. Zone A" /></div>
            </div>
            <div><Label className="text-xs">Notes</Label><Input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} className="h-9 text-sm" placeholder="Optional notes" /></div>
            <Button onClick={handleSaveEdit} disabled={editSaving || !editName.trim()} className="w-full" size="sm">{editSaving ? "Saving…" : "Save Changes"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle className="text-sm">Delete Segment?</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">This will permanently delete the segment and cannot be undone.</p>
          <div className="flex gap-2 justify-end mt-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>{deleting ? "Deleting…" : "Delete"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Auto-detect Suggestions Dialog */}
      <Dialog open={autoDialogOpen} onOpenChange={setAutoDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Auto-detected Segments ({suggestions.filter(s => s.selected).length}/{suggestions.length} selected)
            </DialogTitle>
          </DialogHeader>
          <div className="overflow-auto flex-1 space-y-1.5 pr-1">
            {suggestions.map((s, idx) => (
              <label
                key={idx}
                className={`flex items-start gap-3 p-2.5 rounded-lg border transition-colors cursor-pointer ${
                  s.selected ? "border-primary/40 bg-primary/5" : "border-border bg-muted/20"
                }`}
              >
                <Checkbox
                  checked={s.selected}
                  onCheckedChange={() => toggleSuggestion(idx)}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-foreground">{s.name}</span>
                    <Badge variant="outline" className="text-[9px] capitalize">{s.segment_type.replace(/_/g, " ")}</Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                    {s.level_label && <span>Level: {s.level_label}</span>}
                    {s.zone_label && <span>Zone: {s.zone_label}</span>}
                  </div>
                  {s.notes && <p className="text-[10px] text-muted-foreground mt-0.5">{s.notes}</p>}
                </div>
              </label>
            ))}
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-border">
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => setSuggestions(prev => prev.map(s => ({ ...s, selected: !suggestions.every(x => x.selected) })))}>
              {suggestions.every(s => s.selected) ? "Deselect All" : "Select All"}
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setAutoDialogOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={handleCreateSuggestions} disabled={autoCreating || suggestions.filter(s => s.selected).length === 0} className="gap-1.5">
                {autoCreating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                Create {suggestions.filter(s => s.selected).length} Segment{suggestions.filter(s => s.selected).length !== 1 ? "s" : ""}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
