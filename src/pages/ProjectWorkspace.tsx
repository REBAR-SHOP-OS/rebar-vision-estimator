import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";
import ProjectOverview from "@/components/workspace/ProjectOverview";
import FilesTab from "@/components/workspace/FilesTab";
import SegmentsTab from "@/components/workspace/SegmentsTab";
import QATab from "@/components/workspace/QATab";
import OutputsTab from "@/components/workspace/OutputsTab";
import EstimateTab from "@/components/workspace/EstimateTab";
import ShopDrawingsTab from "@/components/workspace/ShopDrawingsTab";
import ProjectSettingsTab from "@/components/workspace/ProjectSettingsTab";

const TAB_SUFFIXES: Record<string, string> = {
  "": "overview",
  "/files": "files",
  "/segments": "segments",
  "/qa": "qa",
  "/estimate": "estimate",
  "/shop-drawings": "shop-drawings",
  "/outputs": "estimate",
  "/settings": "settings",
};

export default function ProjectWorkspace() {
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

  useEffect(() => {
    loadProject(true);
  }, [id]);

  // Determine active tab from URL
  const basePath = `/app/project/${id}`;
  const suffix = location.pathname.replace(basePath, "") || "";
  const activeTab = TAB_SUFFIXES[suffix] || "overview";

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

  const handleTabChange = (tab: string) => {
    const suffixMap: Record<string, string> = {
      overview: "",
      files: "/files",
      segments: "/segments",
      qa: "/qa",
      estimate: "/estimate",
      "shop-drawings": "/shop-drawings",
      settings: "/settings",
    };
    navigate(`${basePath}${suffixMap[tab] || ""}`);
  };

  return (
    <div className="flex flex-col h-full">
      <Tabs value={activeTab} onValueChange={handleTabChange} className="flex flex-col h-full">
        <div className="border-b border-border bg-muted/30 px-4">
          <TabsList className="bg-transparent h-10 gap-1">
            <TabsTrigger value="overview" className="text-xs data-[state=active]:bg-background">Overview</TabsTrigger>
            <TabsTrigger value="files" className="text-xs data-[state=active]:bg-background">Files</TabsTrigger>
            <TabsTrigger value="segments" className="text-xs data-[state=active]:bg-background">Segments</TabsTrigger>
            <TabsTrigger value="qa" className="text-xs data-[state=active]:bg-background">QA / Issues</TabsTrigger>
            <TabsTrigger value="estimate" className="text-xs data-[state=active]:bg-background">Estimate</TabsTrigger>
            <TabsTrigger value="shop-drawings" className="text-xs data-[state=active]:bg-background">Shop Drawings</TabsTrigger>
            <TabsTrigger value="settings" className="text-xs data-[state=active]:bg-background">Settings</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="flex-1 overflow-auto m-0">
          <ProjectOverview project={project} />
        </TabsContent>
        <TabsContent value="files" className="flex-1 overflow-auto m-0">
          <FilesTab projectId={project.id} onProjectRefresh={() => loadProject(false)} />
        </TabsContent>
        <TabsContent value="segments" className="flex-1 overflow-auto m-0">
          <SegmentsTab projectId={project.id} />
        </TabsContent>
        <TabsContent value="qa" className="flex-1 overflow-auto m-0">
          <QATab projectId={project.id} />
        </TabsContent>
        <TabsContent value="estimate" className="flex-1 overflow-auto m-0">
          <EstimateTab projectId={project.id} />
        </TabsContent>
        <TabsContent value="shop-drawings" className="flex-1 overflow-auto m-0">
          <ShopDrawingsTab projectId={project.id} />
        </TabsContent>
        <TabsContent value="settings" className="flex-1 overflow-auto m-0">
          <ProjectSettingsTab project={project} onUpdate={setProject} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
