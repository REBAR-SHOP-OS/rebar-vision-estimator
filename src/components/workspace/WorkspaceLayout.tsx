import { useState, useEffect, useMemo, useCallback } from "react";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { supabase } from "@/integrations/supabase/client";
import ProjectSidebar from "./ProjectSidebar";
import EstimateSummaryCards from "./EstimateSummaryCards";
import EstimateGrid, { type EstimateLineItem } from "./EstimateGrid";
import EvidenceDrawer from "./EvidenceDrawer";
import StatusBanner from "./StatusBanner";
import ChatArea from "@/components/chat/ChatArea";
import ErrorBoundary from "@/components/ErrorBoundary";
import { toast } from "sonner";

interface WorkspaceLayoutProps {
  projectId: string;
  project: { name: string; client_name?: string; project_type?: string; workflow_status?: string };
  initialFiles: File[] | null;
  onInitialFilesConsumed: () => void;
  onProjectNameChange: (name: string) => void;
  onStepChange: (step: number | null) => void;
  onModeChange: (mode: "smart" | "step-by-step" | null) => void;
}

function mapStatus(raw: string | undefined): "approved" | "needs_review" | "blocked" {
  if (!raw) return "needs_review";
  const lower = raw.toLowerCase();
  if (lower === "approved" || lower === "ready") return "approved";
  if (lower === "blocked") return "blocked";
  return "needs_review";
}

export default function WorkspaceLayout({
  projectId, project, initialFiles, onInitialFilesConsumed,
  onProjectNameChange, onStepChange, onModeChange,
}: WorkspaceLayoutProps) {
  const [showChat, setShowChat] = useState(false);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [lineItems, setLineItems] = useState<EstimateLineItem[]>([]);
  const [fileCount, setFileCount] = useState(0);
  const [estimateVersionCount, setEstimateVersionCount] = useState(0);
  const [drawingSetCount, setDrawingSetCount] = useState(0);

  // Load project data
  useEffect(() => {
    async function load() {
      const [filesRes, estRes, dsRes] = await Promise.all([
        supabase.from("project_files").select("id", { count: "exact" }).eq("project_id", projectId),
        supabase.from("estimate_versions").select("*").eq("project_id", projectId).order("version_number", { ascending: false }),
        supabase.from("drawing_sets").select("id", { count: "exact" }).eq("project_id", projectId),
      ]);

      setFileCount(filesRes.count || 0);
      setDrawingSetCount(dsRes.count || 0);

      const versions = estRes.data || [];
      setEstimateVersionCount(versions.length);

      // Parse line items from latest version
      if (versions.length > 0) {
        const latest = versions[0];
        const raw = (latest.line_items as any[]) || [];
        const mapped: EstimateLineItem[] = raw.map((li: any, idx: number) => ({
          id: li.id || `li-${idx}`,
          elementId: li.element_id || li.elementId || `E${idx + 1}`,
          elementType: li.element_type || li.elementType || "Unknown",
          status: mapStatus(li.status),
          evidenceGrade: li.evidence_grade || li.evidenceGrade || "—",
          weightKg: Number(li.weight_kg || li.weightKg || li.weight || 0),
          costEstimate: Number(li.cost_estimate || li.costEstimate || li.cost || 0),
          issuesCount: Number(li.issues_count || li.issuesCount || 0),
          questionsCount: Number(li.questions_count || li.questionsCount || 0),
          sourceSheets: li.source_sheets || li.sourceSheets || [],
        }));
        setLineItems(mapped);
      }
    }
    load();
  }, [projectId]);

  // Compute summary
  const summary = useMemo(() => {
    let trustedTotal = 0, pendingTotal = 0, approvedCount = 0, needsReviewCount = 0, blockedCount = 0;
    for (const item of lineItems) {
      if (item.status === "approved") { trustedTotal += item.costEstimate; approvedCount++; }
      else if (item.status === "needs_review") { pendingTotal += item.costEstimate; needsReviewCount++; }
      else if (item.status === "blocked") { blockedCount++; }
    }
    const pricingAllowed = blockedCount === 0 && needsReviewCount === 0;
    const drawingGenerationAllowed = pricingAllowed;
    return { trustedTotal, pendingTotal, approvedCount, needsReviewCount, blockedCount, pricingAllowed, drawingGenerationAllowed };
  }, [lineItems]);

  const selectedItem = useMemo(() => lineItems.find((i) => i.id === selectedRowId) || null, [lineItems, selectedRowId]);

  const updateItemStatus = useCallback((id: string, status: "approved" | "needs_review" | "blocked") => {
    setLineItems((prev) => prev.map((i) => (i.id === id ? { ...i, status } : i)));
    toast.success(`Item ${status.replace("_", " ")}`);
  }, []);

  // If no line items and initial load, default to chat
  useEffect(() => {
    if (lineItems.length === 0 && initialFiles) setShowChat(true);
  }, [lineItems.length, initialFiles]);

  if (showChat) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/30">
          <button onClick={() => setShowChat(false)} className="text-xs text-primary hover:underline">← Back to Workspace</button>
          <span className="text-xs text-muted-foreground">Chat view for {project.name}</span>
        </div>
        <ErrorBoundary fallbackMessage="Estimation session crashed">
          <ChatArea
            projectId={projectId}
            initialFiles={initialFiles}
            onInitialFilesConsumed={onInitialFilesConsumed}
            onProjectNameChange={onProjectNameChange}
            onStepChange={onStepChange}
            onModeChange={onModeChange}
          />
        </ErrorBoundary>
      </div>
    );
  }

  return (
    <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
      {/* Left Sidebar */}
      <ResizablePanel defaultSize={18} minSize={14} maxSize={28}>
        <ProjectSidebar
          projectName={project.name}
          clientName={project.client_name}
          projectType={project.project_type}
          workflowStatus={project.workflow_status}
          fileCount={fileCount}
          estimateVersionCount={estimateVersionCount}
          drawingSetCount={drawingSetCount}
          onViewChat={() => setShowChat(true)}
          chatActive={false}
        />
      </ResizablePanel>

      <ResizableHandle withHandle />

      {/* Center - Estimate Grid */}
      <ResizablePanel defaultSize={55} minSize={35}>
        <div className="flex flex-col h-full p-3 gap-3 overflow-hidden">
          <StatusBanner
            blockedCount={summary.blockedCount}
            needsReviewCount={summary.needsReviewCount}
            pricingAllowed={summary.pricingAllowed}
            drawingGenerationAllowed={summary.drawingGenerationAllowed}
          />
          <EstimateSummaryCards {...summary} />
          <EstimateGrid
            items={lineItems}
            selectedId={selectedRowId}
            onSelectRow={setSelectedRowId}
          />
        </div>
      </ResizablePanel>

      <ResizableHandle withHandle />

      {/* Right - Evidence Drawer */}
      <ResizablePanel defaultSize={27} minSize={20} maxSize={40}>
        <EvidenceDrawer
          item={selectedItem}
          onApprove={(id) => updateItemStatus(id, "approved")}
          onMarkReview={(id) => updateItemStatus(id, "needs_review")}
          onBlock={(id) => updateItemStatus(id, "blocked")}
          onClarify={(id) => toast.info(`Clarification requested for ${id}`)}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
