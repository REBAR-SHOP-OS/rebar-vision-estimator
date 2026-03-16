import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { BarChart3, FileText, Layers, Target, AlertTriangle, CheckCircle } from "lucide-react";

interface ProjectHealth {
  id: string;
  name: string;
  linkage_score: string;
  workflow_status: string;
  scope_items: string[] | null;
  created_at: string;
  file_count: number;
  drawing_count: number;
  estimate_count: number;
}

const SCORE_COLORS: Record<string, string> = {
  L0: "bg-muted text-muted-foreground",
  L1: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  L2: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  L3: "bg-primary/15 text-primary",
};

const ProjectHealthDashboard: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { user } = useAuth();
  const [projects, setProjects] = useState<ProjectHealth[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: projectsData } = await supabase
        .from("projects")
        .select("id, name, linkage_score, workflow_status, scope_items, created_at")
        .order("updated_at", { ascending: false })
        .limit(50);

      if (!projectsData) { setLoading(false); return; }

      const enriched: ProjectHealth[] = await Promise.all(
        projectsData.map(async (p: any) => {
          const [{ count: fileCount }, { count: drawingCount }, { count: estimateCount }] = await Promise.all([
            supabase.from("project_files").select("id", { count: "exact", head: true }).eq("project_id", p.id),
            supabase.from("drawing_search_index").select("id", { count: "exact", head: true }).eq("project_id", p.id),
            supabase.from("estimate_versions").select("id", { count: "exact", head: true }).eq("project_id", p.id),
          ]);
          return {
            ...p,
            linkage_score: p.linkage_score || "L0",
            workflow_status: p.workflow_status || "intake",
            file_count: fileCount || 0,
            drawing_count: drawingCount || 0,
            estimate_count: estimateCount || 0,
          };
        })
      );
      setProjects(enriched);
      setLoading(false);
    })();
  }, [user]);

  const scoreCounts = { L0: 0, L1: 0, L2: 0, L3: 0 };
  projects.forEach((p) => { scoreCounts[p.linkage_score as keyof typeof scoreCounts] = (scoreCounts[p.linkage_score as keyof typeof scoreCounts] || 0) + 1; });

  const noScopeProjects = projects.filter((p) => !p.scope_items || p.scope_items.length === 0);
  const totalProgress = projects.length > 0 ? Math.round(((scoreCounts.L2 + scoreCounts.L3) / projects.length) * 100) : 0;

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          Project Health Dashboard
        </h2>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Object.entries(scoreCounts).map(([score, count]) => (
              <Card key={score} className="border-border">
                <CardContent className="p-3 text-center">
                  <Badge className={`${SCORE_COLORS[score]} mb-1`}>{score}</Badge>
                  <p className="text-2xl font-bold text-foreground">{count}</p>
                  <p className="text-[10px] text-muted-foreground">projects</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Overall Progress */}
          <Card className="border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Pipeline Completion</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Progress value={totalProgress} className="h-2" />
              <p className="text-xs text-muted-foreground">{totalProgress}% of projects at L2+ (scope detected or estimated)</p>
            </CardContent>
          </Card>

          {/* No-Scope Alert */}
          {noScopeProjects.length > 0 && (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4" />
                  {noScopeProjects.length} project(s) with no scope
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {noScopeProjects.slice(0, 10).map((p) => (
                    <div key={p.id} className="flex items-center gap-2 text-xs">
                      <span className="text-foreground truncate flex-1">{p.name}</span>
                      <Badge variant="outline" className="text-[9px]">{p.linkage_score}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Project Table */}
          <Card className="border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">All Projects</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left py-1.5 px-2">Project</th>
                      <th className="text-center py-1.5 px-1">Score</th>
                      <th className="text-center py-1.5 px-1">Status</th>
                      <th className="text-center py-1.5 px-1"><FileText className="h-3 w-3 mx-auto" /></th>
                      <th className="text-center py-1.5 px-1"><Layers className="h-3 w-3 mx-auto" /></th>
                      <th className="text-center py-1.5 px-1"><Target className="h-3 w-3 mx-auto" /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {projects.map((p) => (
                      <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="py-1.5 px-2 truncate max-w-[150px] text-foreground">{p.name}</td>
                        <td className="text-center py-1.5 px-1">
                          <Badge className={`text-[9px] ${SCORE_COLORS[p.linkage_score]}`}>{p.linkage_score}</Badge>
                        </td>
                        <td className="text-center py-1.5 px-1 text-muted-foreground">{p.workflow_status}</td>
                        <td className="text-center py-1.5 px-1 text-foreground">{p.file_count}</td>
                        <td className="text-center py-1.5 px-1 text-foreground">{p.drawing_count}</td>
                        <td className="text-center py-1.5 px-1 text-foreground">{p.estimate_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default ProjectHealthDashboard;
