import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import WorkflowShell from "@/features/workflow-v2/WorkflowShell";
import { loadWorkspaceProject } from "./project-workspace-loader";

export default function ProjectWorkspace() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;

    let cancelled = false;

    const loadProject = async (withLoading = true) => {
      if (withLoading) setLoading(true);
      const project = await loadWorkspaceProject(supabase, id);

      if (cancelled) return;
      setProject(project);

      if (withLoading && !cancelled) {
        setLoading(false);
      }
    };

    loadProject(true);

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (!project) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Project not found.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <WorkflowShell projectId={project.id} project={project} />
    </div>
  );
}
