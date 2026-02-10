import React, { useState, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useLanguage, LANGUAGES, type Language } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Plus, MessageSquare, LogOut, Sun, Moon, Menu, Trash2, Pencil, Check, X, RefreshCw, Globe } from "lucide-react";
import BrainKnowledgeDialog from "@/components/chat/BrainKnowledgeDialog";
import { toast } from "sonner";
import ChatArea from "@/components/chat/ChatArea";
import StepProgress from "@/components/chat/StepProgress";
import logoBg from "@/assets/logo.png";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Project {
  id: string;
  name: string;
  status: string;
  created_at: string;
}

const Dashboard: React.FC = () => {
  const { user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { t, language, setLanguage, dir, currentLanguageInfo } = useLanguage();
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [creatingProject, setCreatingProject] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [currentStep, setCurrentStep] = useState<number | null>(null);
  const [calculationMode, setCalculationMode] = useState<"smart" | "step-by-step" | null>(null);
  const [initialFiles, setInitialFiles] = useState<File[] | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const newProjectFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    if (editingProjectId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingProjectId]);

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

  const handleNewEstimationClick = () => {
    newProjectFileInputRef.current?.click();
  };

  const handleNewProjectFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !user) return;

    setCreatingProject(true);
    const projectName = files[0].name.replace(/\.[^/.]+$/, "");

    const { data, error } = await supabase
      .from("projects")
      .insert({ user_id: user.id, name: projectName })
      .select()
      .single();

    if (error) {
      toast.error("Failed to create project");
      setCreatingProject(false);
      return;
    }

    setProjects((prev) => [data, ...prev]);
    setActiveProjectId(data.id);
    setInitialFiles(Array.from(files));
    setCreatingProject(false);
    setCurrentStep(null);
    setCalculationMode(null);

    // Reset file input
    if (newProjectFileInputRef.current) newProjectFileInputRef.current.value = "";
  };

  const deleteProject = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const { error } = await supabase.from("projects").delete().eq("id", id);
    if (error) {
      toast.error("Failed to delete project");
      return;
    }
    setProjects((prev) => prev.filter((p) => p.id !== id));
    if (activeProjectId === id) {
      setActiveProjectId(null);
      setCurrentStep(null);
      setCalculationMode(null);
    }
  };

  const startEditing = (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingProjectId(id);
    setEditName(name);
  };

  const saveProjectName = async () => {
    if (!editingProjectId || !editName.trim()) {
      setEditingProjectId(null);
      return;
    }
    const { error } = await supabase
      .from("projects")
      .update({ name: editName.trim() })
      .eq("id", editingProjectId);

    if (!error) {
      setProjects((prev) =>
        prev.map((p) => (p.id === editingProjectId ? { ...p, name: editName.trim() } : p))
      );
    }
    setEditingProjectId(null);
  };

  const cancelEditing = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingProjectId(null);
  };

  return (
    <div className="relative flex h-screen w-full overflow-hidden bg-background" dir={dir}>
      {/* Blurred background logo */}
      <div
        className="pointer-events-none fixed inset-0 z-0 flex items-center justify-center opacity-[0.07]"
        aria-hidden="true"
      >
        <img
          src={logoBg}
          alt=""
          className="w-[600px] h-[600px] object-contain blur-3xl"
        />
      </div>
      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? "w-64" : "w-0"
        } relative z-10 flex flex-col border-r border-border bg-sidebar transition-all duration-200 overflow-hidden flex-shrink-0`}
      >
        {/* New Project Button */}
        <div className="p-3">
          <input
            ref={newProjectFileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.dwg,.dxf"
            onChange={handleNewProjectFileSelect}
            className="hidden"
          />
          <Button
            onClick={handleNewEstimationClick}
            disabled={creatingProject}
            variant="outline"
            className="w-full justify-start gap-2 border-border text-sidebar-foreground hover:bg-sidebar-accent"
          >
            <Plus className="h-4 w-4" />
            {t("newEstimation")}
          </Button>
        </div>

        {/* Step Progress - shown when a project is active */}
        {activeProjectId && (
          <div className="border-b border-border">
            <StepProgress currentStep={currentStep} mode={calculationMode} />
          </div>
        )}

        {/* Project List */}
        <div className="flex-1 overflow-y-auto px-2 pt-1">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1 px-3 pt-2">
            {t("projects")}
          </p>
          {projects.map((project) => (
            <div
              key={project.id}
              onClick={() => {
                setActiveProjectId(project.id);
                setCurrentStep(null);
                setCalculationMode(null);
              }}
              className={`group flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors cursor-pointer ${
                activeProjectId === project.id
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50"
              }`}
            >
              <MessageSquare className="h-4 w-4 flex-shrink-0" />
              {editingProjectId === project.id ? (
                <div className="flex items-center gap-1 flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                  <input
                    ref={editInputRef}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveProjectName();
                      if (e.key === "Escape") setEditingProjectId(null);
                    }}
                    className="flex-1 min-w-0 bg-background border border-border rounded px-1.5 py-0.5 text-xs text-foreground outline-none"
                  />
                  <button onClick={() => saveProjectName()} className="text-primary">
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={cancelEditing} className="text-muted-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <>
                  <span className="truncate flex-1">{project.name}</span>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => startEditing(project.id, project.name, e)}
                      className="hover:text-primary"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      onClick={(e) => deleteProject(project.id, e)}
                      className="hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        {/* Bottom section */}
        <div className="border-t border-border p-3 space-y-1">
          {/* Language Switcher */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2 text-sidebar-foreground"
              >
                <Globe className="h-4 w-4" />
                {currentLanguageInfo.nativeName}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
              {LANGUAGES.map((lang) => (
                <DropdownMenuItem
                  key={lang.code}
                  onClick={() => setLanguage(lang.code)}
                  className={language === lang.code ? "bg-accent" : ""}
                >
                  <span className="mr-2">{lang.nativeName}</span>
                  <span className="text-muted-foreground text-xs">({lang.name})</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleTheme}
            className="w-full justify-start gap-2 text-sidebar-foreground"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {theme === "dark" ? t("lightMode") : t("darkMode")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={signOut}
            className="w-full justify-start gap-2 text-sidebar-foreground hover:text-destructive"
          >
            <LogOut className="h-4 w-4" />
            {t("signOut")}
          </Button>
        </div>
      </aside>

      {/* Main Area */}
      <div className="relative z-10 flex flex-1 flex-col min-w-0">
        {/* Header */}
        <header className="flex h-12 items-center border-b border-border px-3 bg-background/80 backdrop-blur-sm flex-shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="h-8 w-8 text-muted-foreground"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <img src={logoBg} alt="Logo" className="h-7 w-7 rounded-full object-contain ml-2" />
          <h1 className="ml-2 text-sm font-medium text-foreground truncate flex-1">
            {activeProjectId
              ? projects.find((p) => p.id === activeProjectId)?.name || t("estimation")
              : t("appTitle")}
          </h1>
          {/* Brain Knowledge Button */}
          <BrainKnowledgeDialog />
          {/* Refresh Button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => window.location.reload()}
            className="h-8 w-8 text-muted-foreground"
            title={t("refresh")}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </header>

        {/* Chat or Welcome */}
        {activeProjectId ? (
          <ChatArea
            projectId={activeProjectId}
            initialFiles={initialFiles}
            onInitialFilesConsumed={() => setInitialFiles(null)}
            onProjectNameChange={(name) => {
              setProjects((prev) =>
                prev.map((p) => (p.id === activeProjectId ? { ...p, name } : p))
              );
            }}
            onStepChange={(step) => setCurrentStep(step)}
            onModeChange={(mode) => setCalculationMode(mode)}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center bg-background/50">
            <div className="text-center space-y-4">
              <h2 className="text-2xl font-semibold text-foreground">
                {t("welcomeMessage")}
              </h2>
              <p className="text-muted-foreground max-w-md">
                {t("uploadBlueprints")}
              </p>
              <Button onClick={handleNewEstimationClick} disabled={creatingProject} className="gap-2">
                <Plus className="h-4 w-4" />
                {t("startNewEstimation")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
