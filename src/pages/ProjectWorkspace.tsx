import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import WorkflowShell from "@/features/workflow-v2/WorkflowShell";
import { getCanonicalProjectByLegacyId } from "@/lib/rebar-read-model";

export default function ProjectWorkspace() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;

    let cancelled = false;

    const loadProject = async (withLoading = true) => {
      if (withLoading) setLoading(true);

      const { data: legacyProject, error: legacyError } = await supabase
        .from("projects")
        .select("*")
        .eq("id", id)
        .single();

      if (legacyError) {
        console.warn("Failed to load legacy project:", legacyError);
      }

      let canonicalProject = null;
      if (legacyProject) {
        try {
          canonicalProject = await getCanonicalProjectByLegacyId(supabase, id);
        } catch (error) {
          console.warn("Failed to load canonical project:", error);
        }
      }

      if (cancelled) return;

      if (legacyProject) {
        setProject({
          ...legacyProject,
          canonicalProject,
          project_name: canonicalProject?.projectName || legacyProject.name,
          customer_name: canonicalProject?.customerName ?? legacyProject.client_name,
          location: canonicalProject?.location ?? legacyProject.address ?? null,
          rebar_project_id: canonicalProject?.rebarProjectId || null,
          status: canonicalProject?.status || legacyProject.status,
        });
      } else if (withLoading) {
        setProject(null);
      }

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
