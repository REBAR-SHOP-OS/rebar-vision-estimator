import React, { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Plus, MessageSquare, Settings, LogOut, Sun, Moon, Menu, Trash2 } from "lucide-react";
import { toast } from "sonner";
import ChatArea from "@/components/chat/ChatArea";

interface Project {
  id: string;
  name: string;
  status: string;
  created_at: string;
}

const Dashboard: React.FC = () => {
  const { user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [creatingProject, setCreatingProject] = useState(false);

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) {
      toast.error("Failed to load projects");
      return;
    }
    setProjects(data || []);
  };

  const createProject = async () => {
    if (!user) return;
    setCreatingProject(true);

    const { data, error } = await supabase
      .from("projects")
      .insert({ user_id: user.id, name: "New Estimation" })
      .select()
      .single();

    if (error) {
      toast.error("Failed to create project");
      setCreatingProject(false);
      return;
    }

    setProjects((prev) => [data, ...prev]);
    setActiveProjectId(data.id);
    setCreatingProject(false);
  };

  const deleteProject = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const { error } = await supabase.from("projects").delete().eq("id", id);
    if (error) {
      toast.error("Failed to delete project");
      return;
    }
    setProjects((prev) => prev.filter((p) => p.id !== id));
    if (activeProjectId === id) setActiveProjectId(null);
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? "w-64" : "w-0"
        } flex flex-col border-r border-border bg-sidebar transition-all duration-200 overflow-hidden flex-shrink-0`}
      >
        {/* New Project Button */}
        <div className="p-3">
          <Button
            onClick={createProject}
            disabled={creatingProject}
            variant="outline"
            className="w-full justify-start gap-2 border-border text-sidebar-foreground hover:bg-sidebar-accent"
          >
            <Plus className="h-4 w-4" />
            New Estimation
          </Button>
        </div>

        {/* Project List */}
        <div className="flex-1 overflow-y-auto px-2">
          {projects.map((project) => (
            <button
              key={project.id}
              onClick={() => setActiveProjectId(project.id)}
              className={`group flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                activeProjectId === project.id
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50"
              }`}
            >
              <MessageSquare className="h-4 w-4 flex-shrink-0" />
              <span className="truncate flex-1">{project.name}</span>
              <button
                onClick={(e) => deleteProject(project.id, e)}
                className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </button>
          ))}
        </div>

        {/* Bottom section */}
        <div className="border-t border-border p-3 space-y-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleTheme}
            className="w-full justify-start gap-2 text-sidebar-foreground"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {theme === "dark" ? "Light Mode" : "Dark Mode"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={signOut}
            className="w-full justify-start gap-2 text-sidebar-foreground hover:text-destructive"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Main Area */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Header */}
        <header className="flex h-12 items-center border-b border-border px-3 bg-background flex-shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="h-8 w-8 text-muted-foreground"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <h1 className="ml-3 text-sm font-medium text-foreground truncate">
            {activeProjectId
              ? projects.find((p) => p.id === activeProjectId)?.name || "Estimation"
              : "Rebar Estimator Pro"}
          </h1>
        </header>

        {/* Chat or Welcome */}
        {activeProjectId ? (
          <ChatArea
            projectId={activeProjectId}
            onProjectNameChange={(name) => {
              setProjects((prev) =>
                prev.map((p) => (p.id === activeProjectId ? { ...p, name } : p))
              );
            }}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center space-y-4">
              <h2 className="text-2xl font-semibold text-foreground">
                Rebar Estimator Pro
              </h2>
              <p className="text-muted-foreground max-w-md">
                Upload your construction blueprints and get accurate rebar weight and wire mesh estimates powered by AI.
              </p>
              <Button onClick={createProject} disabled={creatingProject} className="gap-2">
                <Plus className="h-4 w-4" />
                Start New Estimation
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
