import { Outlet, useLocation } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import AppSidebar from "./AppSidebar";
import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getCanonicalProjectByLegacyId } from "@/lib/rebar-read-model";
import { Layers3, Sparkles } from "lucide-react";

const routeTitles: Record<string, string> = {
  "/app": "Estimator Dashboard",
  "/app/orders": "Orders",
  "/app/standards": "Standards",
};

export default function AppShell() {
  const location = useLocation();
  const [projectName, setProjectName] = useState<string>("");

  const activeProjectId = useMemo(() => {
    const m = location.pathname.match(/\/app\/project\/([^/]+)/);
    return m ? m[1] : null;
  }, [location.pathname]);

  const currentTitle = useMemo(() => {
    if (activeProjectId) return projectName || "Project Workspace";
    return routeTitles[location.pathname] || "RebarForge Pro";
  }, [activeProjectId, location.pathname, projectName]);

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
    <SidebarProvider defaultOpen={true}>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar activeProjectId={activeProjectId} activeProjectName={projectName} />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 border-b border-border bg-background/85 px-3 py-3 backdrop-blur-sm md:px-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <SidebarTrigger className="h-9 w-9 rounded-xl border border-border bg-card text-foreground hover:bg-muted" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1">
                      <Sparkles className="h-3.5 w-3.5 text-primary" />
                      RebarForge Pro
                    </span>
                    {activeProjectId ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1">
                        <Layers3 className="h-3.5 w-3.5 text-muted-foreground" />
                        Active project
                      </span>
                    ) : null}
                  </div>
                  <h1 className="mt-2 truncate font-['Bahnschrift','Segoe_UI',sans-serif] text-lg font-bold tracking-tight text-foreground md:text-xl">
                    {currentTitle}
                  </h1>
                </div>
              </div>
              <div className="hidden items-center gap-2 md:flex">
                <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  <span className="h-2 w-2 rounded-full bg-primary" />
                  Hosted Supabase connected
                </span>
              </div>
            </div>
          </header>
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
