import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FolderOpen, Layers, AlertTriangle, CheckCircle, FileText, ShieldAlert } from "lucide-react";
import ApprovalPanel from "@/components/workspace/ApprovalPanel";

interface ProjectOverviewProps {
  project: {
    id: string;
    name: string;
    client_name?: string;
    project_type?: string;
    workflow_status?: string;
    status?: string;
    address?: string;
    scope_items?: string[];
    intake_complete?: boolean;
    linkage_score?: string;
    description?: string;
    created_at?: string;
    updated_at?: string;
  };
}

const WORKFLOW_STEPS = ["intake", "files_uploaded", "parsing", "review_needed", "estimating", "draft_ready", "approved", "archived"];
const WORKFLOW_STEP_MAP: Record<string, string> = {
  intake: "intake",
  files_uploaded: "files_uploaded",
  parsing: "parsing",
  drawings_indexed: "parsing",
  scope_detected: "review_needed",
  estimated: "estimating",
  draft_ready: "draft_ready",
  approved: "approved",
  archived: "archived",
};
  const [counts, setCounts] = useState({ files: 0, segments: 0, issues: 0, approvals: 0, estimates: 0, blockers: 0 });

  useEffect(() => {
    Promise.all([
      supabase.from("project_files").select("id", { count: "exact" }).eq("project_id", project.id),
      supabase.from("segments").select("id", { count: "exact" }).eq("project_id", project.id),
      supabase.from("validation_issues").select("id", { count: "exact" }).eq("project_id", project.id).eq("status", "open"),
      supabase.from("approvals").select("id", { count: "exact" }).eq("project_id", project.id).eq("status", "pending"),
      supabase.from("estimate_versions").select("id", { count: "exact" }).eq("project_id", project.id),
      supabase.from("validation_issues").select("id", { count: "exact" }).eq("project_id", project.id).eq("status", "open").in("severity", ["error", "critical"]),
    ]).then(([f, s, i, a, e, b]) => {
      setCounts({
        files: f.count || 0,
        segments: s.count || 0,
        issues: i.count || 0,
        approvals: a.count || 0,
        estimates: e.count || 0,
        blockers: b.count || 0,
      });
    });
  }, [project.id]);

  const currentStepIdx = WORKFLOW_STEPS.indexOf(WORKFLOW_STEP_MAP[project.workflow_status || "intake"] || "intake");

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl">
      {/* Blocker Banner */}
      {counts.blockers > 0 && (
        <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
          <ShieldAlert className="h-4 w-4 text-destructive flex-shrink-0" />
          <span className="text-xs text-destructive font-medium">{counts.blockers} critical issue(s) blocking project progress.</span>
        </div>
      )}

      {/* Project Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-foreground">{project.name}</h2>
          {project.linkage_score && <Badge variant="secondary" className="text-[10px]">{project.linkage_score}</Badge>}
          <Badge variant={project.intake_complete ? "default" : "outline"} className="text-[10px]">
            {project.intake_complete ? "Intake Complete" : "Intake Pending"}
          </Badge>
        </div>
        {project.client_name && <p className="text-sm text-muted-foreground">{project.client_name}</p>}
        {project.address && <p className="text-xs text-muted-foreground">{project.address}</p>}
        {project.description && <p className="text-xs text-muted-foreground mt-1">{project.description}</p>}
      </div>

      {/* Workflow Stepper */}
      <div className="flex items-center gap-1 overflow-x-auto pb-2">
        {WORKFLOW_STEPS.map((step, idx) => (
          <div key={step} className="flex items-center gap-1">
            <div className={`px-2.5 py-1 rounded-full text-[10px] font-medium whitespace-nowrap ${
              idx < currentStepIdx ? "bg-primary/15 text-primary"
                : idx === currentStepIdx ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
            }`}>
              {step.replace(/_/g, " ")}
            </div>
            {idx < WORKFLOW_STEPS.length - 1 && <div className={`w-4 h-px ${idx < currentStepIdx ? "bg-primary" : "bg-border"}`} />}
          </div>
        ))}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryCard icon={FolderOpen} label="Files" value={counts.files} />
        <SummaryCard icon={Layers} label="Segments" value={counts.segments} />
        <SummaryCard icon={AlertTriangle} label="Open Issues" value={counts.issues} color={counts.issues > 0 ? "text-[hsl(var(--status-review))]" : undefined} />
        <SummaryCard icon={CheckCircle} label="Pending Approvals" value={counts.approvals} color={counts.approvals > 0 ? "text-[hsl(var(--status-review))]" : undefined} />
        <SummaryCard icon={FileText} label="Estimate Versions" value={counts.estimates} />
      </div>

      {/* Metadata */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Project Details</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4 text-xs">
          <Detail label="Type" value={project.project_type} />
          <Detail label="Status" value={project.status} />
          <Detail label="Workflow" value={project.workflow_status} />
          <Detail label="Created" value={project.created_at ? new Date(project.created_at).toLocaleDateString() : undefined} />
          <Detail label="Updated" value={project.updated_at ? new Date(project.updated_at).toLocaleDateString() : undefined} />
          <Detail label="Scope Items" value={project.scope_items?.length ? `${project.scope_items.length} items` : undefined} />
        </CardContent>
      </Card>

      {/* Scope Items */}
      {project.scope_items && project.scope_items.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Scope Items</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            {project.scope_items.map((item, idx) => (
              <Badge key={idx} variant="outline" className="text-[10px]">{item}</Badge>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Approval Panel */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Approval Status</CardTitle></CardHeader>
        <CardContent>
          <ApprovalPanel projectId={project.id} />
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color?: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <Icon className={`h-5 w-5 ${color || "text-muted-foreground"}`} />
        <div>
          <p className={`text-xl font-bold ${color || "text-foreground"}`}>{value}</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-muted-foreground text-[10px] uppercase tracking-wider">{label}</p>
      <p className="text-foreground font-medium">{value || "—"}</p>
    </div>
  );
}
