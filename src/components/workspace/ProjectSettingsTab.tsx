import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { logAuditEvent } from "@/lib/audit-logger";

interface Props {
  project: any;
  onUpdate: (updated: any) => void;
}

export default function ProjectSettingsTab({ project, onUpdate }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState(project.name || "");
  const [clientName, setClientName] = useState(project.client_name || "");
  const [address, setAddress] = useState(project.address || "");
  const [projectType, setProjectType] = useState(project.project_type || "");
  const [description, setDescription] = useState(project.description || "");
  const [status, setStatus] = useState(project.status || "in_progress");
  const [workflowStatus, setWorkflowStatus] = useState(project.workflow_status || "intake");
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleSave = async () => {
    if (!user || !name.trim()) return;
    setSaving(true);

    const legacyPayload = {
      name: name.trim(),
      client_name: clientName.trim() || null,
      address: address.trim() || null,
      project_type: projectType || null,
      description: description.trim() || null,
      status,
      workflow_status: workflowStatus,
    };

    const { data, error } = await supabase.from("projects").update(legacyPayload).eq("id", project.id).select("*").single();

    if (error) {
      toast.error("Failed to save");
      setSaving(false);
      return;
    }

    let updatedCanonicalProject = project.canonicalProject || null;
    let canonicalSyncSucceeded = false;

    if (project.rebar_project_id) {
      const { data: canonicalData, error: canonicalError } = await supabase
        .schema("rebar")
        .from("projects")
        .update({
          project_name: legacyPayload.name,
          customer_name: legacyPayload.client_name,
          location: legacyPayload.address,
          status: legacyPayload.status,
        })
        .eq("id", project.rebar_project_id)
        .select("id, project_name, customer_name, status, created_at, updated_at, project_number, location, tender_due_at, concrete_grade, rebar_grade, bid_notes")
        .single();

      if (canonicalError) {
        console.warn("Failed to sync canonical project fields:", canonicalError);
        toast.warning("Saved project details, but the canonical project record did not sync.");
      } else if (canonicalData) {
        canonicalSyncSucceeded = true;
        updatedCanonicalProject = {
          legacyProjectId: project.id,
          rebarProjectId: canonicalData.id,
          projectName: canonicalData.project_name,
          customerName: canonicalData.customer_name || null,
          status: canonicalData.status,
          createdAt: canonicalData.created_at,
          updatedAt: canonicalData.updated_at,
          projectNumber: canonicalData.project_number || null,
          location: canonicalData.location || null,
          tenderDueAt: canonicalData.tender_due_at || null,
          concreteGrade: canonicalData.concrete_grade || null,
          rebarGrade: canonicalData.rebar_grade || null,
          bidNotes: canonicalData.bid_notes || null,
        };
      }
    }

    await logAuditEvent(user.id, "updated", "project", project.id, project.id);
    toast.success("Project saved");

    const nextProject = {
      ...data,
      canonicalProject: updatedCanonicalProject,
      rebar_project_id: project.rebar_project_id || updatedCanonicalProject?.rebarProjectId || null,
      project_name: canonicalSyncSucceeded ? updatedCanonicalProject?.projectName || data.name : data.name,
      customer_name: canonicalSyncSucceeded ? updatedCanonicalProject?.customerName ?? data.client_name : data.client_name,
      location: canonicalSyncSucceeded ? updatedCanonicalProject?.location ?? data.address ?? null : data.address ?? null,
      status: canonicalSyncSucceeded ? updatedCanonicalProject?.status || data.status : data.status,
    };

    onUpdate(nextProject);
    window.dispatchEvent(new CustomEvent("project-updated", {
      detail: {
        projectId: project.id,
        projectName: nextProject.project_name || nextProject.name,
      },
    }));

    setSaving(false);
  };

  const handleDelete = async () => {
    if (!user) return;
    setDeleting(true);
    await logAuditEvent(user.id, "deleted", "project", project.id, project.id, undefined, { name: project.name });
    const { error } = await supabase.from("projects").delete().eq("id", project.id);
    if (error) { toast.error("Failed to delete project"); setDeleting(false); }
    else { toast.success("Project deleted"); navigate("/app"); }
  };

  return (
    <div className="p-4 md:p-6 max-w-2xl space-y-6">
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Project Details</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div><Label className="text-xs">Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} className="h-9 text-sm" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Client</Label><Input value={clientName} onChange={(e) => setClientName(e.target.value)} className="h-9 text-sm" placeholder="Client name" /></div>
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={projectType} onValueChange={setProjectType}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="commercial">Commercial</SelectItem>
                  <SelectItem value="residential">Residential</SelectItem>
                  <SelectItem value="industrial">Industrial</SelectItem>
                  <SelectItem value="infrastructure">Infrastructure</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div><Label className="text-xs">Address</Label><Input value={address} onChange={(e) => setAddress(e.target.value)} className="h-9 text-sm" placeholder="Project address" /></div>
          <div><Label className="text-xs">Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="text-sm min-h-[60px]" placeholder="Project description" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="on_hold">On Hold</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Workflow</Label>
              <Select value={workflowStatus} onValueChange={setWorkflowStatus}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="intake">Intake</SelectItem>
                  <SelectItem value="estimating">Estimating</SelectItem>
                  <SelectItem value="review">Review</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="issued">Issued</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={handleSave} disabled={saving || !name.trim()} size="sm" className="w-full">
            {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Saving...</> : "Save Changes"}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader className="pb-3"><CardTitle className="text-sm text-destructive">Danger Zone</CardTitle></CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">Deleting a project permanently removes all files, segments, estimates, and issues.</p>
          <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <DialogTrigger asChild>
              <Button variant="destructive" size="sm" className="gap-1.5"><Trash2 className="h-3.5 w-3.5" />Delete Project</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader><DialogTitle className="text-sm">Delete "{project.name}"?</DialogTitle></DialogHeader>
              <p className="text-xs text-muted-foreground">This action cannot be undone.</p>
              <div className="flex gap-2 justify-end mt-2">
                <Button variant="outline" size="sm" onClick={() => setDeleteOpen(false)}>Cancel</Button>
                <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
                  {deleting ? "Deleting..." : "Delete"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    </div>
  );
}
