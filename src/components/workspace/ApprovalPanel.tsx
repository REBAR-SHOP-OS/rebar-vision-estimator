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
import { CheckCircle2, XCircle, Clock, ShieldAlert, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Approval {
  id: string;
  approval_type: string;
  status: string;
  reviewer_name: string | null;
  reviewer_email: string | null;
  notes: string | null;
  created_at: string;
  resolved_at: string | null;
}

const STATUS_CONFIG: Record<string, { icon: any; color: string; label: string }> = {
  pending: { icon: Clock, color: "text-[hsl(var(--status-review))]", label: "Pending" },
  approved: { icon: CheckCircle2, color: "text-[hsl(var(--status-approved))]", label: "Approved" },
  rejected: { icon: XCircle, color: "text-destructive", label: "Rejected" },
  blocked: { icon: ShieldAlert, color: "text-destructive", label: "Blocked" },
};

export default function ApprovalPanel({ projectId, segmentId }: { projectId: string; segmentId?: string }) {
  const { user } = useAuth();
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [openIssueCount, setOpenIssueCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newType, setNewType] = useState("estimate");
  const [newReviewer, setNewReviewer] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    let q = supabase.from("approvals").select("*").eq("project_id", projectId).order("created_at", { ascending: false });
    if (segmentId) q = q.eq("segment_id", segmentId);

    const issueQ = supabase.from("validation_issues").select("id", { count: "exact" }).eq("project_id", projectId).eq("status", "open");

    const [appRes, issRes] = await Promise.all([q, issueQ]);
    setApprovals((appRes.data as Approval[]) || []);
    setOpenIssueCount(issRes.count || 0);
    setLoading(false);
  };

  useEffect(() => { load(); }, [projectId, segmentId]);

  const handleCreate = async () => {
    if (!user) return;
    setCreating(true);
    const status = openIssueCount > 0 ? "blocked" : "pending";
    const { error } = await supabase.from("approvals").insert({
      project_id: projectId,
      segment_id: segmentId || null,
      user_id: user.id,
      approval_type: newType,
      status,
      reviewer_name: newReviewer || null,
      reviewer_email: newEmail || null,
      notes: openIssueCount > 0 ? `Blocked: ${openIssueCount} open issue(s) must be resolved first.` : null,
    });
    if (error) toast.error("Failed to create approval");
    else { toast.success("Approval request created"); setDialogOpen(false); setNewReviewer(""); setNewEmail(""); load(); }
    setCreating(false);
  };

  const handleResolve = async (id: string, newStatus: "approved" | "rejected") => {
    const { error } = await supabase.from("approvals").update({ status: newStatus, resolved_at: new Date().toISOString() }).eq("id", id);
    if (error) toast.error("Failed to update");
    else { toast.success(`Approval ${newStatus}`); load(); }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-32"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">Approvals</h4>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs"><Plus className="h-3 w-3" />Request Approval</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle className="text-sm">Request Approval</DialogTitle></DialogHeader>
            {openIssueCount > 0 && (
              <div className="flex items-center gap-2 p-2.5 bg-destructive/10 rounded-md text-xs text-destructive">
                <ShieldAlert className="h-3.5 w-3.5 flex-shrink-0" />
                <span>{openIssueCount} open issue(s) — approval will be blocked until resolved.</span>
              </div>
            )}
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Type</Label>
                <Select value={newType} onValueChange={setNewType}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="estimate">Estimation Review</SelectItem>
                    <SelectItem value="quote">Quote Approval</SelectItem>
                    <SelectItem value="customer">Customer Delivery</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Reviewer Name</Label><Input value={newReviewer} onChange={(e) => setNewReviewer(e.target.value)} className="h-9 text-sm" placeholder="e.g. Ben S." /></div>
              <div><Label className="text-xs">Reviewer Email</Label><Input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className="h-9 text-sm" placeholder="reviewer@company.com" /></div>
              <Button onClick={handleCreate} disabled={creating} className="w-full" size="sm">{creating ? "Creating…" : "Submit Request"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {approvals.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-28 text-muted-foreground gap-1.5 border border-dashed border-border rounded-lg">
          <CheckCircle2 className="h-6 w-6" />
          <p className="text-xs">No approval requests yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {approvals.map((a) => {
            const cfg = STATUS_CONFIG[a.status] || STATUS_CONFIG.pending;
            const Icon = cfg.icon;
            return (
              <div key={a.id} className="border border-border rounded-lg p-3 hover:bg-muted/20 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-2">
                    <Icon className={`h-4 w-4 mt-0.5 ${cfg.color}`} />
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-foreground capitalize">{a.approval_type.replace(/_/g, " ")}</span>
                        <Badge className={`text-[9px] ${a.status === "approved" ? "bg-[hsl(var(--status-approved))]/15 text-[hsl(var(--status-approved))]" : a.status === "rejected" || a.status === "blocked" ? "bg-destructive/15 text-destructive" : "bg-[hsl(var(--status-review))]/15 text-[hsl(var(--status-review))]"}`}>
                          {cfg.label}
                        </Badge>
                      </div>
                      {a.reviewer_name && <p className="text-[10px] text-muted-foreground mt-0.5">Reviewer: {a.reviewer_name}</p>}
                      {a.notes && <p className="text-xs text-muted-foreground mt-1">{a.notes}</p>}
                      <p className="text-[10px] text-muted-foreground mt-1">{new Date(a.created_at).toLocaleDateString()}</p>
                    </div>
                  </div>
                  {a.status === "pending" && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-7 text-[10px] text-[hsl(var(--status-approved))]" onClick={() => handleResolve(a.id, "approved")}>Approve</Button>
                      <Button size="sm" variant="ghost" className="h-7 text-[10px] text-destructive" onClick={() => handleResolve(a.id, "rejected")}>Reject</Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
