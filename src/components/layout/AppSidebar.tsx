import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useLanguage, LANGUAGES } from "@/contexts/LanguageContext";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { NavLink } from "@/components/NavLink";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Brain,
  CheckCircle2,
  AlertTriangle,
  Lock,
  FileSpreadsheet,
  FolderOpen,
  Globe,
  LayoutDashboard,
  Layers,
  LogOut,
  MessageSquareText,
  Moon,
  Package,
  Ruler,
  ShieldCheck,
  Stamp,
  Sun,
  Trash2,
} from "lucide-react";
import type { ComponentType } from "react";
import logoBg from "@/assets/logo.png";
import BrainKnowledgeDialog from "@/components/chat/BrainKnowledgeDialog";
import { STAGES, type StageKey } from "@/features/workflow-v2/types";
import { useActiveStage, useStageStatus } from "@/features/workflow-v2/active-stage";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

interface AppSidebarProps {
  activeProjectId?: string | null;
  activeProjectName?: string;
}

const mainNav = [
  { title: "Dashboard", url: "/app", icon: LayoutDashboard, end: true },
  { title: "Orders", url: "/app/orders", icon: Package },
  { title: "Standards", url: "/app/standards", icon: Ruler },
];

const STAGE_ICONS: Record<StageKey, ComponentType<{ className?: string }>> = {
  files: FolderOpen,
  scope: Layers,
  calibration: Ruler,
  takeoff: Ruler,
  qa: ShieldCheck,
  assistant: MessageSquareText,
  confirm: Stamp,
  outputs: FileSpreadsheet,
};

export default function AppSidebar({ activeProjectId, activeProjectName }: AppSidebarProps) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { language, setLanguage, currentLanguageInfo } = useLanguage();
  const navigate = useNavigate();
  const [active, setActive] = useActiveStage();
  const status = useStageStatus();

  const projectBase = activeProjectId ? `/app/project/${activeProjectId}` : null;

  const handleDeleteProject = async () => {
    if (!activeProjectId) return;
    const { error } = await supabase.from("projects").delete().eq("id", activeProjectId);
    if (error) {
      toast.error(`Could not delete project: ${error.message}`);
      return;
    }
    toast.success("Project deleted");
    navigate("/app");
  };

  return (
    <Sidebar collapsible="offcanvas" className="border-r border-sidebar-border">
      <SidebarContent className="bg-sidebar text-sidebar-foreground">
        <div className="flex items-center gap-3 px-3 pb-3 pt-4">
          <img src={logoBg} alt="Logo" className="h-9 w-9 rounded-xl border border-sidebar-border object-cover" />
          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate font-['Bahnschrift','Segoe_UI',sans-serif] text-base font-bold tracking-tight text-sidebar-foreground">
                RebarForge Pro
              </div>
              <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-sidebar-foreground/60">
                Estimator OS
              </div>
            </div>
          )}
        </div>

        <SidebarGroup className="px-2">
          <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.16em] text-sidebar-foreground/60">Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNav.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild className="rounded-xl text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-primary">
                    <NavLink to={item.url} end={item.end} className="hover:bg-transparent" activeClassName="bg-sidebar-accent text-sidebar-primary font-medium">
                      <item.icon className="mr-2 h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {projectBase && (
          <SidebarGroup className="px-2">
            <SidebarGroupLabel className="flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-sidebar-foreground/60">
              <span className="truncate">{collapsed ? "Proj" : activeProjectName || "Project"}</span>
              {!collapsed && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button
                      title="Delete project"
                      className="grid h-5 w-5 place-items-center rounded text-sidebar-foreground/50 hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this project?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This permanently removes "{activeProjectName || "this project"}" and all of its segments, takeoff rows, overlays, QA issues, and outputs. Uploaded files in storage are kept. This cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleDeleteProject}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete project
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild className="rounded-xl text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-primary">
                    <NavLink to={projectBase} end className="hover:bg-transparent" activeClassName="bg-sidebar-accent text-sidebar-primary font-medium">
                      <FolderOpen className="mr-2 h-4 w-4" />
                      {!collapsed && <span>Workspace</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                {STAGES.map((s) => {
                  const Icon = STAGE_ICONS[s.key];
                  const st = status[s.key];
                  const locked = st === "locked";
                  const blocked = st === "blocked";
                  const complete = st === "complete";
                  const isActive = active === s.key;
                  return (
                    <SidebarMenuItem key={s.key}>
                      <SidebarMenuButton
                        onClick={() => { if (!locked) { setActive(s.key); navigate(projectBase); } }}
                        disabled={locked}
                        title={locked ? `${s.short} — locked` : s.label}
                        className={[
                          "rounded-xl text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                          isActive ? "bg-sidebar-accent text-sidebar-primary font-medium" : "",
                          locked ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
                        ].join(" ")}
                      >
                        <Icon className="mr-2 h-4 w-4" />
                        {!collapsed && (
                          <>
                            <span className="flex-1 truncate">{s.short}</span>
                            {blocked && <AlertTriangle className="h-3 w-3 text-destructive" />}
                            {complete && <CheckCircle2 className="h-3 w-3 text-primary/70" />}
                            {locked && <Lock className="h-3 w-3" />}
                          </>
                        )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border bg-sidebar p-2 space-y-1">
        <BrainKnowledgeDialog />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-start gap-2 rounded-xl text-xs text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
              <Globe className="h-4 w-4" />
              {!collapsed && currentLanguageInfo.nativeName}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
            {LANGUAGES.map((lang) => (
              <DropdownMenuItem key={lang.code} onClick={() => setLanguage(lang.code)} className={language === lang.code ? "bg-accent" : ""}>
                <span className="mr-2">{lang.nativeName}</span>
                <span className="text-muted-foreground text-xs">({lang.name})</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="sm" onClick={toggleTheme} className="w-full justify-start gap-2 rounded-xl text-xs text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {!collapsed && (theme === "dark" ? "Light Mode" : "Dark Mode")}
        </Button>
        <Button variant="ghost" size="sm" onClick={signOut} className="w-full justify-start gap-2 rounded-xl text-xs text-sidebar-foreground hover:bg-sidebar-accent hover:text-destructive">
          <LogOut className="h-4 w-4" />
          {!collapsed && "Sign Out"}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
