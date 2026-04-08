import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, Plus, Building2, BarChart3, HeartPulse, Activity } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

interface ProjectRow {
  id: string;
  name: string;
  client_name: string | null;
  project_type: string | null;
  status: string;
  workflow_status: string | null;
  linkage_score: string | null;
  updated_at: string;
  fileCount: number;
  latestVersion: number | null;
  approvedCount: number;
  needsReviewCount: number;
  blockedCount: number;
  trustedTotal: number;
  pendingTotal: number;
}

interface ProjectDashboardProps {
  onSelectProject: (id: string) => void;
  onNewEstimation: () => void;
  onShowCrm: () => void;
  onShowOutcomes: () => void;
  onShowHealth: () => void;
  onShowDiagnostics: () => void;
  onShowSearch: () => void;
}

type FilterStatus = "all" | "has_blocked" | "needs_review" | "approved";

export default function ProjectDashboard({
  onSelectProject, onNewEstimation, onShowCrm, onShowOutcomes, onShowHealth, onShowDiagnostics, onShowSearch,
}: ProjectDashboardProps) {
  const { t } = useLanguage();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [projRes, filesRes, estRes] = await Promise.all([
        supabase.from("projects").select("*").order("updated_at", { ascending: false }),
        supabase.from("project_files").select("id, project_id"),
        supabase.from("estimate_versions").select("project_id, version_number, line_items").order("version_number", { ascending: false }),
      ]);

      const projs = projRes.data || [];
      const files = filesRes.data || [];
      const estimates = estRes.data || [];

      // Group files by project
      const fileCounts: Record<string, number> = {};
      for (const f of files) { fileCounts[f.project_id] = (fileCounts[f.project_id] || 0) + 1; }

      // Latest estimate per project
      const latestEstimates: Record<string, any> = {};
      for (const e of estimates) {
        if (!latestEstimates[e.project_id]) latestEstimates[e.project_id] = e;
      }

      const rows: ProjectRow[] = projs.map((p) => {
        const est = latestEstimates[p.id];
        const items = (est?.line_items as any[]) || [];
        let approved = 0, review = 0, blocked = 0, trusted = 0, pending = 0;
        for (const li of items) {
          const s = (li.status || "").toLowerCase();
          if (s === "approved" || s === "ready") { approved++; trusted += Number(li.cost_estimate || li.costEstimate || li.cost || 0); }
          else if (s === "blocked") { blocked++; }
          else { review++; pending += Number(li.cost_estimate || li.costEstimate || li.cost || 0); }
        }
        return {
          id: p.id, name: p.name, client_name: p.client_name, project_type: p.project_type,
          status: p.status, workflow_status: p.workflow_status, linkage_score: p.linkage_score,
          updated_at: p.updated_at, fileCount: fileCounts[p.id] || 0,
          latestVersion: est?.version_number || null,
          approvedCount: approved, needsReviewCount: review, blockedCount: blocked,
          trustedTotal: trusted, pendingTotal: pending,
        };
      });
      setProjects(rows);
      setLoading(false);
    }
    load();
  }, []);

  const filtered = useMemo(() => {
    let list = projects;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q) || (p.client_name || "").toLowerCase().includes(q));
    }
    if (filter === "has_blocked") list = list.filter((p) => p.blockedCount > 0);
    else if (filter === "needs_review") list = list.filter((p) => p.needsReviewCount > 0);
    else if (filter === "approved") list = list.filter((p) => p.blockedCount === 0 && p.needsReviewCount === 0 && p.approvedCount > 0);
    return list;
  }, [projects, search, filter]);

  function healthDot(p: ProjectRow) {
    if (p.blockedCount > 0) return "bg-[hsl(var(--status-blocked))]";
    if (p.needsReviewCount > 0) return "bg-[hsl(var(--status-review))]";
    if (p.approvedCount > 0) return "bg-[hsl(var(--status-approved))]";
    return "bg-muted-foreground/30";
  }

  const fmt = (v: number) => v > 0 ? `$${v.toLocaleString()}` : "—";

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background/80 backdrop-blur-sm flex-wrap">
        <h2 className="text-lg font-bold text-foreground">Projects</h2>
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>
        <div className="flex gap-1">
          {(["all", "has_blocked", "needs_review", "approved"] as FilterStatus[]).map((f) => (
            <Button
              key={f}
              variant={filter === f ? "default" : "ghost"}
              size="sm"
              className="text-[10px] h-7 px-2"
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All" : f === "has_blocked" ? "Blocked" : f === "needs_review" ? "Review" : "Approved"}
            </Button>
          ))}
        </div>
        <div className="flex gap-1.5 ml-auto">
          <Button onClick={onNewEstimation} size="sm" className="gap-1.5 h-8 text-xs"><Plus className="h-3.5 w-3.5" />{t("newEstimation")}</Button>
          <Button onClick={onShowCrm} variant="outline" size="sm" className="gap-1 h-8 text-xs"><Building2 className="h-3.5 w-3.5" />CRM</Button>
          <Button onClick={onShowOutcomes} variant="outline" size="sm" className="gap-1 h-8 text-xs"><BarChart3 className="h-3.5 w-3.5" />Outcomes</Button>
          <Button onClick={onShowSearch} variant="outline" size="sm" className="gap-1 h-8 text-xs"><Search className="h-3.5 w-3.5" />Drawings</Button>
          <Button onClick={onShowHealth} variant="outline" size="sm" className="gap-1 h-8 text-xs"><HeartPulse className="h-3.5 w-3.5" />Health</Button>
          <Button onClick={onShowDiagnostics} variant="outline" size="sm" className="gap-1 h-8 text-xs"><Activity className="h-3.5 w-3.5" />Diag</Button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
            {projects.length === 0 ? "No projects yet. Start a new estimation." : "No projects match your filters."}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm z-10">
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <th className="text-left px-4 py-2.5 font-semibold w-6"></th>
                <th className="text-left px-3 py-2.5 font-semibold">Project</th>
                <th className="text-left px-3 py-2.5 font-semibold">Client</th>
                <th className="text-left px-3 py-2.5 font-semibold">Type</th>
                <th className="text-right px-3 py-2.5 font-semibold">Files</th>
                <th className="text-right px-3 py-2.5 font-semibold">Ver</th>
                <th className="text-right px-3 py-2.5 font-semibold">✓</th>
                <th className="text-right px-3 py-2.5 font-semibold">⚠</th>
                <th className="text-right px-3 py-2.5 font-semibold">✗</th>
                <th className="text-right px-3 py-2.5 font-semibold">Trusted</th>
                <th className="text-right px-3 py-2.5 font-semibold">Pending</th>
                <th className="text-right px-3 py-2.5 font-semibold">Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => onSelectProject(p.id)}
                  className="border-b border-border/50 cursor-pointer hover:bg-muted/30 transition-colors h-10"
                >
                  <td className="px-4 py-2"><div className={`h-2 w-2 rounded-full ${healthDot(p)}`} /></td>
                  <td className="px-3 py-2 font-medium text-foreground">{p.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{p.client_name || "—"}</td>
                  <td className="px-3 py-2">
                    {p.project_type ? <Badge variant="secondary" className="text-[9px]">{p.project_type}</Badge> : "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{p.fileCount}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{p.latestVersion ?? "—"}</td>
                  <td className="px-3 py-2 text-right text-[hsl(var(--status-approved))] font-medium">{p.approvedCount || ""}</td>
                  <td className="px-3 py-2 text-right text-[hsl(var(--status-review))] font-medium">{p.needsReviewCount || ""}</td>
                  <td className="px-3 py-2 text-right text-[hsl(var(--status-blocked))] font-medium">{p.blockedCount || ""}</td>
                  <td className="px-3 py-2 text-right font-mono text-[hsl(var(--status-approved))]">{fmt(p.trustedTotal)}</td>
                  <td className="px-3 py-2 text-right font-mono text-[hsl(var(--status-review))]">{fmt(p.pendingTotal)}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{new Date(p.updated_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
