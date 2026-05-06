import { useParams, useNavigate, useLocation, Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";
import ProjectOverview from "@/components/workspace/ProjectOverview";
import FilesTab from "@/components/workspace/FilesTab";
import SegmentsTab from "@/components/workspace/SegmentsTab";
import QATab from "@/components/workspace/QATab";
import EstimateTab from "@/components/workspace/EstimateTab";
import ShopDrawingsTab from "@/components/workspace/ShopDrawingsTab";
import ProjectSettingsTab from "@/components/workspace/ProjectSettingsTab";

const TAB_SUFFIXES: Record<string, string> = {
  "": "overview", "/files": "files", "/segments": "segments", "/qa": "qa",
  "/estimate": "estimate", "/shop-drawings": "shop-drawings", "/outputs": "estimate", "/settings": "settings",
};

/**
 * LEGACY WORKSPACE — archived. Reachable only via /app/legacy/project/:id.
 * The active estimator product is Rebar Vision Estimator V2 in src/features/workflow-v2.
 */
export default function LegacyProjectWorkspace() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [project, setProject] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const loadProject = (withLoading = false) => {
    if (!id) return;
    if (withLoading) setLoading(true);
    supabase.from("projects").select("*").eq("id", id).single().then(({ data }) => {
      if (data) setProject(data);
      if (withLoading) setLoading(false);
    });
  };

  useEffect(() => { loadProject(true); }, [id]);

  const basePath = `/app/legacy/project/${id}`;
  const suffix = location.pathname.replace(basePath, "") || "";
  const activeTab = TAB_SUFFIXES[suffix] || "overview";

  if (loading) return <div className="flex items-center justify-center h-full"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (!project) return <div className="flex items-center justify-center h-full text-muted-foreground">Project not found.</div>;

  const handleTabChange = (tab: string) => {
    const m: Record<string, string> = { overview: "", files: "/files", segments: "/segments", qa: "/qa", estimate: "/estimate", "shop-drawings": "/shop-drawings", settings: "/settings" };
    navigate(`${basePath}${m[tab] || ""}`);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2 border-b border-border bg-yellow-500/10 text-xs font-mono uppercase tracking-widest text-yellow-700 dark:text-yellow-400 flex items-center justify-between">
        <span>⚠ Legacy Workspace · archived flow</span>
        <Link to={`/app/project/${id}`} className="underline hover:text-foreground">← Back to V2 Workspace</Link>
      </div>
      <Tabs value={activeTab} onValueChange={handleTabChange} className="flex flex-col h-full">
        <div className="border-b border-border bg-muted/30 px-4">
          <TabsList className="bg-transparent h-10 gap-1">
            <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
            <TabsTrigger value="files" className="text-xs">Files</TabsTrigger>
            <TabsTrigger value="segments" className="text-xs">Segments</TabsTrigger>
            <TabsTrigger value="qa" className="text-xs">QA / Issues</TabsTrigger>
            <TabsTrigger value="estimate" className="text-xs">Estimate</TabsTrigger>
            <TabsTrigger value="shop-drawings" className="text-xs">Shop Drawings</TabsTrigger>
            <TabsTrigger value="settings" className="text-xs">Settings</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="overview" className="flex-1 overflow-auto m-0"><ProjectOverview project={project} /></TabsContent>
        <TabsContent value="files" className="flex-1 overflow-auto m-0"><FilesTab projectId={project.id} onProjectRefresh={() => loadProject(false)} /></TabsContent>
        <TabsContent value="segments" className="flex-1 overflow-auto m-0"><SegmentsTab projectId={project.id} /></TabsContent>
        <TabsContent value="qa" className="flex-1 overflow-auto m-0"><QATab projectId={project.id} /></TabsContent>
        <TabsContent value="estimate" className="flex-1 overflow-auto m-0"><EstimateTab projectId={project.id} /></TabsContent>
        <TabsContent value="shop-drawings" className="flex-1 overflow-auto m-0"><ShopDrawingsTab projectId={project.id} /></TabsContent>
        <TabsContent value="settings" className="flex-1 overflow-auto m-0"><ProjectSettingsTab project={project} onUpdate={setProject} /></TabsContent>
      </Tabs>
    </div>
  );
}