import { FileText, Layers, GitBranch, Activity, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";

interface ProjectSidebarProps {
  projectName: string;
  clientName?: string;
  projectType?: string;
  workflowStatus?: string;
  fileCount: number;
  estimateVersionCount: number;
  drawingSetCount: number;
  onViewChat: () => void;
  chatActive: boolean;
}

function SidebarSection({ title, icon: Icon, children, defaultOpen = true }: { title: string; icon: React.ElementType; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold hover:bg-muted/30"
      >
        <Icon className="h-3.5 w-3.5" />
        <span className="flex-1 text-left">{title}</span>
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </button>
      {open && <div className="pb-2 px-3">{children}</div>}
    </div>
  );
}

const WORKFLOW_LABELS: Record<string, string> = {
  intake: "Intake",
  files_uploaded: "Files Uploaded",
  drawings_indexed: "Indexed",
  scope_detected: "Scope Detected",
  estimated: "Estimated",
  reviewed: "Reviewed",
  quoted: "Quoted",
};

export default function ProjectSidebar({
  projectName, clientName, projectType, workflowStatus,
  fileCount, estimateVersionCount, drawingSetCount,
  onViewChat, chatActive,
}: ProjectSidebarProps) {
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Project header */}
      <div className="px-3 py-3 border-b border-border">
        <h3 className="text-sm font-bold text-foreground truncate">{projectName}</h3>
        {clientName && <p className="text-[11px] text-muted-foreground mt-0.5">{clientName}</p>}
        <div className="flex items-center gap-1.5 mt-2">
          {projectType && <Badge variant="secondary" className="text-[9px]">{projectType}</Badge>}
          {workflowStatus && (
            <Badge variant="outline" className="text-[9px]">
              {WORKFLOW_LABELS[workflowStatus] || workflowStatus}
            </Badge>
          )}
        </div>
      </div>

      <SidebarSection title="Files" icon={FileText}>
        <p className="text-xs text-muted-foreground">{fileCount} file(s) uploaded</p>
      </SidebarSection>

      <SidebarSection title="Estimate Versions" icon={Layers}>
        <p className="text-xs text-muted-foreground">{estimateVersionCount} version(s)</p>
      </SidebarSection>

      <SidebarSection title="Drawing Sets" icon={GitBranch}>
        <p className="text-xs text-muted-foreground">{drawingSetCount} set(s)</p>
      </SidebarSection>

      <SidebarSection title="Workflow" icon={Activity}>
        <p className="text-xs text-muted-foreground">
          Stage: {WORKFLOW_LABELS[workflowStatus || "intake"] || workflowStatus || "intake"}
        </p>
      </SidebarSection>

      {/* View Chat toggle */}
      <div className="mt-auto border-t border-border p-3">
        <button
          onClick={onViewChat}
          className={`w-full text-left text-xs px-3 py-2 rounded-md transition-colors ${
            chatActive ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted/50"
          }`}
        >
          💬 {chatActive ? "Viewing Chat" : "Open Chat View"}
        </button>
      </div>
    </div>
  );
}
