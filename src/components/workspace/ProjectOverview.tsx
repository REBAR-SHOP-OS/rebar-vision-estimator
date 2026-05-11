import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FolderOpen, Layers, AlertTriangle, CheckCircle, FileText, ShieldAlert } from "lucide-react";
import ApprovalPanel from "@/components/workspace/ApprovalPanel";
import {
  getCanonicalProjectFiles,
  getCanonicalProjectSummary,
  type CanonicalProjectView,
} from "@/lib/rebar-read-model";

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
    project_name?: string;
    customer_name?: string;
    location?: string;
    canonicalProject?: CanonicalProjectView | null;
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

function getMergedVisibleFileCount(
  legacyFileCount: number,
  canonicalFiles: Awaited<ReturnType<typeof getCanonicalProjectFiles>>,
): number {
  if (canonicalFiles.length === 0) return legacyFileCount;

  const linkedLegacyIds = new Set(
    canonicalFiles
      .map((file) => file.legacyFileId)
      .filter((legacyFileId): legacyFileId is string => Boolean(legacyFileId)),
  );

  const legacyOnlyCount = Math.max(legacyFileCount - linkedLegacyIds.size, 0);
  return canonicalFiles.length + legacyOnlyCount;
}

export default function ProjectOverview({ project }: ProjectOverviewProps) {
  const [counts, setCounts] = useState({ files: 0, segments: 0, issues: 0, approvals: 0, estimates: 0, blockers: 0 });

  useEffect(() => {
    let cancelled = false;

    const loadCounts = async () => {
      const legacyCountsPromise = Promise.all([
        supabase.from("project_files").select("id", { count: "exact" }).eq("project_id", project.id),
        supabase.from("segments").select("id", { count: "exact" }).eq("project_id", project.id),
        supabase.from("validation_issues").select("id", { count: "exact" }).eq("project_id", project.id).eq("status", "open"),
        supabase.from("approvals").select("id", { count: "exact" }).eq("project_id", project.id).eq("status", "pending"),
        supabase.from("estimate_versions").select("id", { count: "exact" }).eq("project_id", project.id),
        supabase.from("validation_issues").select("id", { count: "exact" }).eq("project_id", project.id).eq("status", "open").in("severity", ["error", "critical"]),
      ]);

      const canonicalSummaryPromise = getCanonicalProjectSummary(supabase, project.id).catch((error) => {
        console.warn("Failed to load canonical project summary:", error);
        return null;
      });
      const canonicalFilesPromise = getCanonicalProjectFiles(supabase, project.id).catch((error) => {
        console.warn("Failed to load canonical project files for overview count:", error);
        return [];
      });

      const [canonicalSummary, canonicalFiles, [f, s, i, a, e, b]] = await Promise.all([
        canonicalSummaryPromise,
        canonicalFilesPromise,
        legacyCountsPromise,
      ]);

      if (cancelled) return;

      const legacyFileCount = f.count || 0;
      const legacyEstimateCount = e.count || 0;
      const mergedFileCount = getMergedVisibleFileCount(legacyFileCount, canonicalFiles);

      setCounts({
        files: mergedFileCount,
        segments: s.count || 0,
        issues: i.count || 0,
        approvals: a.count || 0,
        estimates: Math.max(canonicalSummary?.estimateVersionCount || 0, legacyEstimateCount),
        blockers: b.count || 0,
      });
    };

    loadCounts();

    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const displayProjectName = project.project_name || project.canonicalProject?.projectName || project.name;
  const displayCustomerName = project.customer_name || project.canonicalProject?.customerName || project.client_name;
  const displayLocation = project.location || project.canonicalProject?.location || project.address;
  const displayStatus = project.canonicalProject?.status || project.status;
  const displayCreatedAt = project.canonicalProject?.createdAt || project.created_at;
  const displayUpdatedAt = project.canonicalProject?.updatedAt || project.updated_at;
  const currentStepIdx = WORKFLOW_STEPS.indexOf(WORKFLOW_STEP_MAP[project.workflow_status || "intake"] || "intake");

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl">
      {counts.blockers > 0 && (
        <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
          <ShieldAlert className="h-4 w-4 text-destructive flex-shrink-0" />
          <span className="text-xs text-destructive font-medium">{counts.blockers} critical issue(s) blocking project progress.</span>
        </div>
      )}

      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-foreground">{displayProjectName}</h2>
          {project.linkage_score && <Badge variant="secondary" className="text-[10px]">{project.linkage_score}</Badge>}
          <Badge variant={project.intake_complete ? "default" : "outline"} className="text-[10px]">
            {project.intake_complete ? "Intake Complete" : "Intake Pending"}
          </Badge>
        </div>
        {displayCustomerName && <p className="text-sm text-muted-foreground">{displayCustomerName}</p>}
        {displayLocation && <p className="text-xs text-muted-foreground">{displayLocation}</p>}
        {project.description && <p className="text-xs text-muted-foreground mt-1">{project.description}</p>}
      </div>

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

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryCard icon={FolderOpen} label="Files" value={counts.files} />
        <SummaryCard icon={Layers} label="Segments" value={counts.segments} />
        <SummaryCard icon={AlertTriangle} label="Open Issues" value={counts.issues} color={counts.issues > 0 ? "text-[hsl(var(--status-review))]" : undefined} />
        <SummaryCard icon={CheckCircle} label="Pending Approvals" value={counts.approvals} color={counts.approvals > 0 ? "text-[hsl(var(--status-review))]" : undefined} />
        <SummaryCard icon={FileText} label="Estimate Versions" value={counts.estimates} />
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Project Details</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4 text-xs">
          <Detail label="Type" value={project.project_type} />
          <Detail label="Status" value={displayStatus} />
          <Detail label="Workflow" value={project.workflow_status} />
          <Detail label="Created" value={displayCreatedAt ? new Date(displayCreatedAt).toLocaleDateString() : undefined} />
          <Detail label="Updated" value={displayUpdatedAt ? new Date(displayUpdatedAt).toLocaleDateString() : undefined} />
          <Detail label="Scope Items" value={project.scope_items?.length ? `${project.scope_items.length} items` : undefined} />
        </CardContent>
      </Card>

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

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Approval Status</CardTitle></CardHeader>
        <CardContent>
          <ApprovalPanel projectId={project.id} />
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: number; color?: string }) {
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
