import { Outlet, useLocation } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import AppSidebar from "./AppSidebar";
import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getCanonicalProjectByLegacyId } from "@/lib/rebar-read-model";

export default function AppShell() {
  const location = useLocation();
  const [projectName, setProjectName] = useState<string>("");

  const activeProjectId = useMemo(() => {
    const m = location.pathname.match(/\/app\/project\/([^/]+)/);
    return m ? m[1] : null;
  }, [location.pathname]);

  useEffect(() => {
    if (!activeProjectId) {
      setProjectName("");
      return;
    }

    let cancelled = false;

    const loadProjectName = async () => {
      try {
        const canonicalProject = await getCanonicalProjectByLegacyId(supabase, activeProjectId);
        if (!cancelled && canonicalProject?.projectName) {
          setProjectName(canonicalProject.projectName);
          return;
        }
      } catch (error) {
        console.warn("Failed to load canonical project name:", error);
      }

      const { data: legacyProject, error: legacyError } = await supabase
        .from("projects")
        .select("name")
        .eq("id", activeProjectId)
        .single();

      if (legacyError) {
        console.warn("Failed to load legacy project name:", legacyError);
      }

      if (!cancelled) {
        setProjectName(legacyProject?.name || "");
      }
    };

    loadProjectName();

    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  useEffect(() => {
    const handleProjectUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string; projectName?: string }>).detail;
      if (detail?.projectId === activeProjectId && detail.projectName) {
        setProjectName(detail.projectName);
      }
    };

    window.addEventListener("project-updated", handleProjectUpdated as EventListener);
    return () => {
      window.removeEventListener("project-updated", handleProjectUpdated as EventListener);
    };
  }, [activeProjectId]);

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar activeProjectId={activeProjectId} activeProjectName={projectName} />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-12 flex items-center border-b border-border bg-background/80 backdrop-blur-sm px-3 gap-2 flex-shrink-0">
            <SidebarTrigger className="h-8 w-8" />
            <h1 className="text-sm font-medium text-foreground truncate">
              {projectName || "Rebar Vision Estimator"}
            </h1>
          </header>
          <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
