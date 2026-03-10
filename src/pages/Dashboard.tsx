import React, { useState, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useLanguage, LANGUAGES, type Language } from "@/contexts/LanguageContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Plus, MessageSquare, LogOut, Sun, Moon, Menu, Trash2, Pencil, Check, X, RefreshCw, Globe, Building2, BarChart3, Search, Loader2 } from "lucide-react";
import CrmSyncPanel, { type LeadAttachment } from "@/components/crm/CrmSyncPanel";
import BrainKnowledgeDialog from "@/components/chat/BrainKnowledgeDialog";
import { toast } from "sonner";
import OutcomeCapture from "@/components/audit/OutcomeCapture";
import DrawingSearchPanel from "@/components/search/DrawingSearchPanel";
import ChatArea from "@/components/chat/ChatArea";
import ErrorBoundary from "@/components/ErrorBoundary";
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
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<number | null>(null);
  const isMobile = useIsMobile();
  const [calculationMode, setCalculationMode] = useState<"smart" | "step-by-step" | null>(null);
  const [showCrm, setShowCrm] = useState(false);
  const [showOutcomes, setShowOutcomes] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [processingPhase, setProcessingPhase] = useState<string | null>(null);
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
      if (error.message?.includes("JWT expired") || error.message?.includes("Invalid Refresh Token")) {
        toast.error("Session expired. Please sign in again.");
        signOut();
        return;
      }
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
      if (error.message?.includes("JWT expired") || error.message?.includes("Invalid Refresh Token")) {
        toast.error("Session expired. Please sign in again.");
        signOut();
        return;
      }
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
    if (deletingProjectId === id) return;
    setDeletingProjectId(id);
    const { error } = await supabase.from("projects").delete().eq("id", id);
    setDeletingProjectId(null);
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
      {/* Blueprint background pattern */}
      <div
        className="pointer-events-none fixed inset-0 z-0 blueprint-bg"
        aria-hidden="true"
      />

      {/* Mobile backdrop */}
      {isMobile && sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`${
          isMobile
            ? `fixed inset-y-0 left-0 z-30 w-64 transform transition-transform duration-300 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`
            : `${sidebarOpen ? "w-64" : "w-0"} relative z-10 transition-all duration-300 overflow-hidden`
        } flex flex-col border-r border-sidebar-border bg-sidebar flex-shrink-0`}
      >
        {/* Branded Header */}
        <div className="flex items-center gap-2 px-3 pt-3 pb-2">
          <img src={logoBg} alt="Logo" className="h-7 w-7 rounded-lg" />
          <span className="text-sm font-bold text-sidebar-foreground truncate">Rebar Estimator</span>
        </div>

        {/* New Project Button */}
        <div className="px-3 pb-2">
          <input
            ref={newProjectFileInputRef}
            type="file"
            multiple
            accept="*"
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
            <StepProgress currentStep={currentStep} mode={calculationMode} processingPhase={processingPhase} />
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
                if (isMobile) setSidebarOpen(false);
              }}
              className={`group flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors cursor-pointer ${
                activeProjectId === project.id
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50"
              }`}
            >
              <div className={`h-2 w-2 rounded-full flex-shrink-0 ${
                project.status === "complete" ? "bg-primary" : project.status === "in_progress" ? "bg-amber-500" : "bg-muted-foreground/30"
              }`} />
              <MessageSquare className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
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
                      disabled={deletingProjectId === project.id}
                    >
                      {deletingProjectId === project.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
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
      {showSearch ? (
          <DrawingSearchPanel
            onClose={() => setShowSearch(false)}
            onSelectProject={(projectId) => {
              setShowSearch(false);
              setActiveProjectId(projectId);
              setCurrentStep(null);
              setCalculationMode(null);
            }}
          />
        ) : showOutcomes ? (
          <OutcomeCapture projects={projects.map(p => ({ id: p.id, name: p.name }))} />
        ) : showCrm ? (
          <CrmSyncPanel
            projects={projects.map(p => ({ id: p.id, name: p.name }))}
            onClose={() => setShowCrm(false)}
            onStartEstimation={(newProjectId) => {
              loadProjects();
              setActiveProjectId(newProjectId);
              setShowCrm(false);
              setCurrentStep(null);
              setCalculationMode(null);
            }}
            onStartEstimationWithFiles={async (newProjectId, attachments) => {
              loadProjects();
              setShowCrm(false);
              setCurrentStep(null);
              setCalculationMode(null);

              // Download CRM files as File objects
              toast.info(`Fetching ${attachments.length} file(s) from CRM...`);
              const downloadedFiles: File[] = [];
              for (const att of attachments) {
                try {
                  const body: Record<string, string> = {};
                  if ((att as any).odooId) {
                    body.odoo_id = (att as any).odooId;
                  } else if (att.url) {
                    body.url = att.url;
                  } else {
                    continue;
                  }
                  const { data, error } = await supabase.functions.invoke("proxy-crm-file", { body });
                  if (error || !data) {
                    console.error(`Proxy error for ${att.name}:`, error);
                    continue;
                  }
                  const blob = data instanceof Blob ? data : new Blob([data]);
                  downloadedFiles.push(new File([blob], att.name, { type: att.mimeType }));
                } catch (err) {
                  console.error(`Failed to download ${att.name}:`, err);
                }
              }

              if (downloadedFiles.length > 0) {
                setInitialFiles(downloadedFiles);
                toast.success(`${downloadedFiles.length} file(s) fetched from CRM — starting auto-estimation`);
              } else {
                toast.warning("Could not download CRM files. Upload blueprints manually.");
              }
              setActiveProjectId(newProjectId);
            }}
          />
        ) : activeProjectId ? (
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
          <div className="flex flex-1 items-center justify-center blueprint-bg-major">
            <div className="max-w-xl mx-auto text-center space-y-8 px-4">
              <div className="space-y-3">
                <img src={logoBg} alt="Logo" className="h-16 w-16 rounded-2xl mx-auto" />
                <h2 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">
                  {t("welcomeMessage")}
                </h2>
                <p className="text-muted-foreground text-sm max-w-md mx-auto">
                  {t("uploadBlueprints")}
                </p>
              </div>

              {/* 4-Step Visual Guide */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { num: 1, icon: "📄", title: "Upload Plans", desc: "PDF or image files" },
                  { num: 2, icon: "🎯", title: "Set Scope", desc: "Define element types" },
                  { num: 3, icon: "⚡", title: "AI Takeoff", desc: "Automated estimation" },
                  { num: 4, icon: "📊", title: "Get Results", desc: "Export & review" },
                ].map((step) => (
                  <div key={step.num} className="glass-card rounded-xl p-4 text-center space-y-2">
                    <div className="flex items-center justify-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold">{step.num}</span>
                    </div>
                    <p className="text-lg">{step.icon}</p>
                    <p className="text-xs font-semibold text-foreground">{step.title}</p>
                    <p className="text-[10px] text-muted-foreground">{step.desc}</p>
                  </div>
                ))}
              </div>

              <div className="flex gap-3 justify-center flex-wrap">
                <Button onClick={handleNewEstimationClick} disabled={creatingProject} size="lg" className="gap-2 h-12 px-8 rounded-xl font-bold text-base">
                  <Plus className="h-5 w-5" />
                  {t("startNewEstimation")}
                </Button>
                <Button onClick={() => setShowCrm(true)} variant="outline" size="lg" className="gap-2 h-12 px-6 rounded-xl">
                  <Building2 className="h-5 w-5" />
                  CRM Deals
                </Button>
                <Button onClick={() => setShowOutcomes(true)} variant="outline" size="lg" className="gap-2 h-12 px-6 rounded-xl">
                  <BarChart3 className="h-5 w-5" />
                  Outcomes
                </Button>
                <Button onClick={() => setShowSearch(true)} variant="outline" size="lg" className="gap-2 h-12 px-6 rounded-xl">
                  <Search className="h-5 w-5" />
                  Search Drawings
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
