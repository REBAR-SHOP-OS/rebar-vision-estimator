import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Loader2, AlertTriangle, CheckCircle2, ShieldAlert, User, MessageSquare, Plus } from "lucide-react";
import { toast } from "sonner";
import { logAuditEvent } from "@/lib/audit-logger";

interface Issue {
  id: string;
  issue_type: string;
  severity: string;
  title: string;
  description: string | null;
  status: string;
  assigned_to: string | null;
  resolution_note: string | null;
  source_file_id: string | null;
  created_at: string;
}

export default function QATab({ projectId, segmentId }: { projectId: string; segmentId?: string }) {
  const { user } = useAuth();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "open" | "resolved">("all");
  const [editIssue, setEditIssue] = useState<Issue | null>(null);
  const [editStatus, setEditStatus] = useState("");
  const [editAssignee, setEditAssignee] = useState("");
  const [editResolution, setEditResolution] = useState("");
  const [saving, setSaving] = useState(false);

  // Create issue state
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState("missing_dimension");
  const [newSeverity, setNewSeverity] = useState("warning");
  const [newDescription, setNewDescription] = useState("");
  const [creating, setCreating] = useState(false);

  const load = () => {
    setLoading(true);
    let query = supabase
      .from("validation_issues")
      .select("id, issue_type, severity, title, description, status, assigned_to, resolution_note, source_file_id, created_at")
      .eq("project_id", projectId);
    if (segmentId) query = query.eq("segment_id", segmentId);
    query.order("created_at", { ascending: false })
      .then(({ data }) => {
        setIssues((data as Issue[]) || []);
        setLoading(false);
      });
  };

  useEffect(() => { load(); }, [projectId, segmentId]);

  const filtered = filter === "all" ? issues : issues.filter((i) => filter === "open" ? i.status === "open" : i.status === "resolved");
  const openCount = issues.filter(i => i.status === "open").length;
  const blockerCount = issues.filter(i => i.status === "open" && (i.severity === "error" || i.severity === "critical")).length;

  const severityColor = (s: string) => {
    if (s === "error" || s === "critical") return "bg-destructive/15 text-destructive";
    if (s === "warning") return "bg-[hsl(var(--status-review))]/15 text-[hsl(var(--status-review))]";
    return "bg-muted text-muted-foreground";
  };

  const handleOpenEdit = (issue: Issue) => {
    setEditIssue(issue);
    setEditStatus(issue.status);
    setEditAssignee(issue.assigned_to || "");
    setEditResolution(issue.resolution_note || "");
  };

  const handleSaveEdit = async () => {
    if (!editIssue || !user) return;
    // Require resolution note when resolving
    if (editStatus === "resolved" && !editResolution.trim()) {
      toast.error("Resolution note is required when resolving an issue.");
      return;
    }
    setSaving(true);
    const prevStatus = editIssue.status;
    const { error } = await supabase.from("validation_issues").update({
      status: editStatus,
      assigned_to: editAssignee || null,
      resolution_note: editResolution || null,
    }).eq("id", editIssue.id);
    if (error) toast.error("Failed to update issue");
    else {
      const action = editStatus !== prevStatus ? (editStatus === "resolved" ? "resolved" : editStatus === "open" && prevStatus === "resolved" ? "reopened" : "updated") : "updated";
      await logAuditEvent(user.id, action, "issue", editIssue.id, projectId, undefined, {
        title: editIssue.title,
        prev_status: prevStatus,
        new_status: editStatus,
      });
      toast.success("Issue updated");
      setEditIssue(null);
      load();
    }
    setSaving(false);
  };

  const handleCreate = async () => {
    if (!user || !newTitle.trim()) return;
    setCreating(true);
    const { data, error } = await supabase.from("validation_issues").insert({
      project_id: projectId,
      user_id: user.id,
      title: newTitle.trim(),
      issue_type: newType,
      severity: newSeverity,
      description: newDescription.trim() || null,
      ...(segmentId ? { segment_id: segmentId } : {}),
    }).select("id").single();
    if (error) toast.error("Failed to create issue");
    else {
      await logAuditEvent(user.id, "created", "issue", data?.id, projectId, undefined, {
        title: newTitle,
        severity: newSeverity,
      });
      toast.success("Issue created");
      setCreateOpen(false);
      setNewTitle("");
      setNewDescription("");
      load();
    }
    setCreating(false);
  };

  if (loading) {
    return <div className="flex items-center justify-center h-40"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  }

  return (
    <div className="p-4 md:p-6">
      {blockerCount > 0 && (
        <div className="flex items-center gap-2 p-3 mb-4 bg-destructive/10 border border-destructive/20 rounded-lg">
          <ShieldAlert className="h-4 w-4 text-destructive flex-shrink-0" />
          <span className="text-xs text-destructive font-medium">{blockerCount} critical/error issue{blockerCount !== 1 ? "s" : ""} blocking approvals and outputs.</span>
        </div>
      )}

      <div className="flex items-center gap-3 mb-3">
        <h3 className="text-sm font-semibold text-foreground">QA / Issues</h3>
        <div className="flex gap-1">
          {(["all", "open", "resolved"] as const).map((f) => (
            <Button key={f} variant={filter === f ? "default" : "ghost"} size="sm" className="text-[10px] h-7 px-2" onClick={() => setFilter(f)}>
              {f === "all" ? `All (${issues.length})` : f === "open" ? `Open (${openCount})` : `Resolved (${issues.filter(i => i.status === "resolved").length})`}
            </Button>
          ))}
        </div>
        <div className="ml-auto">
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs"><Plus className="h-3 w-3" />New Issue</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader><DialogTitle className="text-sm">Create Issue</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label className="text-xs">Title</Label><Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} className="h-9 text-sm" placeholder="Issue title" /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Type</Label>
                    <Select value={newType} onValueChange={setNewType}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="missing_dimension">Missing Dimension</SelectItem>
                        <SelectItem value="extraction_conflict">Extraction Conflict</SelectItem>
                        <SelectItem value="review_required">Review Required</SelectItem>
                        <SelectItem value="data_quality">Data Quality</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Severity</Label>
                    <Select value={newSeverity} onValueChange={setNewSeverity}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="info">Info</SelectItem>
                        <SelectItem value="warning">Warning</SelectItem>
                        <SelectItem value="error">Error</SelectItem>
                        <SelectItem value="critical">Critical</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div><Label className="text-xs">Description</Label><Textarea value={newDescription} onChange={(e) => setNewDescription(e.target.value)} className="text-sm min-h-[60px]" placeholder="Describe the issue…" /></div>
                <Button onClick={handleCreate} disabled={creating || !newTitle.trim()} className="w-full" size="sm">{creating ? "Creating…" : "Create Issue"}</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
          <CheckCircle2 className="h-8 w-8 text-primary" />
          <p className="text-sm">{issues.length === 0 ? "No issues found." : "No issues match this filter."}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((issue) => (
            <div key={issue.id} className="border border-border rounded-lg p-3 hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => handleOpenEdit(issue)}>
              <div className="flex items-start gap-2">
                <AlertTriangle className={`h-4 w-4 mt-0.5 flex-shrink-0 ${issue.severity === "error" || issue.severity === "critical" ? "text-destructive" : "text-[hsl(var(--status-review))]"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground">{issue.title}</span>
                    <Badge className={`text-[9px] ${severityColor(issue.severity)}`}>{issue.severity}</Badge>
                    <Badge variant="outline" className="text-[9px]">{issue.issue_type.replace(/_/g, " ")}</Badge>
                    <Badge variant={issue.status === "open" ? "destructive" : "default"} className="text-[9px]">{issue.status}</Badge>
                  </div>
                  {issue.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{issue.description}</p>}
                  <div className="flex items-center gap-3 mt-1.5">
                    <p className="text-[10px] text-muted-foreground">{new Date(issue.created_at).toLocaleDateString()}</p>
                    {issue.assigned_to && (
                      <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                        <User className="h-2.5 w-2.5" />{issue.assigned_to}
                      </span>
                    )}
                    {issue.resolution_note && (
                      <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                        <MessageSquare className="h-2.5 w-2.5" />Has resolution note
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={!!editIssue} onOpenChange={(open) => !open && setEditIssue(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="text-sm">Edit Issue: {editIssue?.title}</DialogTitle></DialogHeader>
          {editIssue && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <Badge className={`text-[9px] ${severityColor(editIssue.severity)}`}>{editIssue.severity}</Badge>
                <Badge variant="outline" className="text-[9px]">{editIssue.issue_type.replace(/_/g, " ")}</Badge>
              </div>
              {editIssue.description && <p className="text-xs text-muted-foreground">{editIssue.description}</p>}
              <div>
                <Label className="text-xs">Status</Label>
                <Select value={editStatus} onValueChange={setEditStatus}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                    <SelectItem value="wont_fix">Won't Fix</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Assigned To</Label>
                <Input value={editAssignee} onChange={(e) => setEditAssignee(e.target.value)} className="h-9 text-sm" placeholder="e.g. estimator@company.com" />
              </div>
              <div>
                <Label className="text-xs">Resolution Note {editStatus === "resolved" && <span className="text-destructive">*</span>}</Label>
                <Textarea value={editResolution} onChange={(e) => setEditResolution(e.target.value)} className="text-sm min-h-[60px]" placeholder="Describe how this issue was resolved…" />
                {editStatus === "resolved" && !editResolution.trim() && (
                  <p className="text-[10px] text-destructive mt-1">Required when resolving an issue.</p>
                )}
              </div>
              <Button onClick={handleSaveEdit} disabled={saving} className="w-full" size="sm">
                {saving ? "Saving…" : "Save Changes"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
