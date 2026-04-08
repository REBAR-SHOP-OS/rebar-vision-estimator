import { Outlet, useParams } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import AppSidebar from "./AppSidebar";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export default function AppShell() {
  const { id: projectId } = useParams<{ id: string }>();
  const [projectName, setProjectName] = useState<string>("");

  // Resolve the project name from any nested route
  useEffect(() => {
    // Try to extract projectId from the URL path if not in params
    const match = window.location.pathname.match(/\/app\/project\/([^/]+)/);
    const pid = projectId || (match ? match[1] : null);
    if (!pid) { setProjectName(""); return; }

    supabase.from("projects").select("name").eq("id", pid).single().then(({ data }) => {
      setProjectName(data?.name || "");
    });
  }, [projectId, window.location.pathname]);

  const activeProjectId = projectId || (() => {
    const m = window.location.pathname.match(/\/app\/project\/([^/]+)/);
    return m ? m[1] : null;
  })();

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
