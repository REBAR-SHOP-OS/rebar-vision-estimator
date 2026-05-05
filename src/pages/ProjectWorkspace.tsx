import { useParams, Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import WorkflowShell from "@/features/workflow-v2/WorkflowShell";

export default function ProjectWorkspace() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    supabase.from("projects").select("*").eq("id", id).single().then(({ data }) => {
      if (data) setProject(data);
      setLoading(false);
    });
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
      <div className="px-3 py-1 border-t border-border bg-muted/20 text-[10px] font-mono uppercase tracking-widest text-muted-foreground flex justify-end">
        <Link to={`/app/legacy/project/${project.id}`} className="hover:text-foreground">Legacy workspace →</Link>
      </div>
    </div>
  );
}
