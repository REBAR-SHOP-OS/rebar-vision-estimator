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
  Brain,
  FolderOpen,
  Globe,
  LayoutDashboard,
  LogOut,
  Moon,
  Package,
  Ruler,
  Sun,
} from "lucide-react";
import logoBg from "@/assets/logo.png";
import BrainKnowledgeDialog from "@/components/chat/BrainKnowledgeDialog";

interface AppSidebarProps {
  activeProjectId?: string | null;
  activeProjectName?: string;
}

const mainNav = [
  { title: "Dashboard", url: "/app", icon: LayoutDashboard, end: true },
  { title: "Orders", url: "/app/orders", icon: Package },
  { title: "Standards", url: "/app/standards", icon: Ruler },
];

const projectNav = [{ title: "Workspace", suffix: "", icon: FolderOpen, end: true }];

export default function AppSidebar({ activeProjectId, activeProjectName }: AppSidebarProps) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { language, setLanguage, currentLanguageInfo } = useLanguage();

  const projectBase = activeProjectId ? `/app/project/${activeProjectId}` : null;

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
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
            <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.16em] text-sidebar-foreground/60">
              {collapsed ? "Proj" : activeProjectName || "Project"}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {projectNav.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild className="rounded-xl text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-primary">
                      <NavLink to={`${projectBase}${item.suffix}`} end={item.end} className="hover:bg-transparent" activeClassName="bg-sidebar-accent text-sidebar-primary font-medium">
                        <item.icon className="mr-2 h-4 w-4" />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
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
