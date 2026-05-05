import { useLocation, useNavigate } from "react-router-dom";
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
  LayoutDashboard,
  FolderOpen,
  Settings,
  Ruler,
  LogOut,
  Sun,
  Moon,
  Globe,
  Brain,
  Package,
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

const projectNav = [
  { title: "Workspace", suffix: "", icon: FolderOpen, end: true },
  { title: "Legacy View", suffix: "/legacy", icon: Settings },
];

export default function AppSidebar({ activeProjectId, activeProjectName }: AppSidebarProps) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { language, setLanguage, currentLanguageInfo } = useLanguage();
  const location = useLocation();

  const projectBase = activeProjectId ? `/app/project/${activeProjectId}` : null;

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        {/* Logo */}
        <div className="flex items-center gap-2 px-3 pt-3 pb-1">
          <img src={logoBg} alt="Logo" className="h-7 w-7 rounded-lg flex-shrink-0" />
          {!collapsed && (
            <span className="text-sm font-bold text-sidebar-foreground truncate">
              Rebar Vision
            </span>
          )}
        </div>

        {/* Main Navigation */}
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNav.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.end}
                      className="hover:bg-muted/50"
                      activeClassName="bg-sidebar-accent text-primary font-medium"
                    >
                      <item.icon className="mr-2 h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Active Project Navigation */}
        {projectBase && (
          <SidebarGroup>
            <SidebarGroupLabel>
              {collapsed ? "Proj" : (activeProjectName || "Project")}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {projectNav.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={`${projectBase}${item.suffix}`}
                        end={item.end}
                        className="hover:bg-muted/50"
                        activeClassName="bg-sidebar-accent text-primary font-medium"
                      >
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

      <SidebarFooter className="border-t border-sidebar-border p-2 space-y-1">
        <BrainKnowledgeDialog />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-sidebar-foreground text-xs">
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
        <Button variant="ghost" size="sm" onClick={toggleTheme} className="w-full justify-start gap-2 text-sidebar-foreground text-xs">
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {!collapsed && (theme === "dark" ? "Light Mode" : "Dark Mode")}
        </Button>
        <Button variant="ghost" size="sm" onClick={signOut} className="w-full justify-start gap-2 text-sidebar-foreground hover:text-destructive text-xs">
          <LogOut className="h-4 w-4" />
          {!collapsed && "Sign Out"}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
