import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";

interface Issue {
  id: string;
  issue_type: string;
  severity: string;
  title: string;
  description: string | null;
  status: string;
  assigned_to: string | null;
  created_at: string;
}

export default function QATab({ projectId }: { projectId: string }) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "open" | "resolved">("all");

  useEffect(() => {
    setLoading(true);
    supabase
      .from("validation_issues")
      .select("id, issue_type, severity, title, description, status, assigned_to, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setIssues((data as Issue[]) || []);
        setLoading(false);
      });
  }, [projectId]);

  const filtered = filter === "all" ? issues : issues.filter((i) => filter === "open" ? i.status === "open" : i.status === "resolved");

  const severityColor = (s: string) => {
    if (s === "error" || s === "critical") return "bg-destructive/15 text-destructive";
    if (s === "warning") return "bg-[hsl(var(--status-review))]/15 text-[hsl(var(--status-review))]";
    return "bg-muted text-muted-foreground";
  };

  if (loading) {
    return <div className="flex items-center justify-center h-40"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  }

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center gap-3 mb-3">
        <h3 className="text-sm font-semibold text-foreground">QA / Issues</h3>
        <div className="flex gap-1">
          {(["all", "open", "resolved"] as const).map((f) => (
            <Button key={f} variant={filter === f ? "default" : "ghost"} size="sm" className="text-[10px] h-7 px-2" onClick={() => setFilter(f)}>
              {f === "all" ? `All (${issues.length})` : f === "open" ? `Open (${issues.filter(i => i.status === "open").length})` : `Resolved (${issues.filter(i => i.status === "resolved").length})`}
            </Button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
          <CheckCircle2 className="h-8 w-8 text-primary" />
          <p className="text-sm">{issues.length === 0 ? "No issues found." : "No issues match this filter."}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((issue) => (
            <div key={issue.id} className="border border-border rounded-lg p-3 hover:bg-muted/20 transition-colors">
              <div className="flex items-start gap-2">
                <AlertTriangle className={`h-4 w-4 mt-0.5 flex-shrink-0 ${issue.severity === "error" || issue.severity === "critical" ? "text-destructive" : "text-[hsl(var(--status-review))]"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground">{issue.title}</span>
                    <Badge className={`text-[9px] ${severityColor(issue.severity)}`}>{issue.severity}</Badge>
                    <Badge variant="outline" className="text-[9px]">{issue.issue_type.replace(/_/g, " ")}</Badge>
                    <Badge variant={issue.status === "open" ? "destructive" : "default"} className="text-[9px]">{issue.status}</Badge>
                  </div>
                  {issue.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{issue.description}</p>}
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {new Date(issue.created_at).toLocaleDateString()}
                    {issue.assigned_to && ` · Assigned to ${issue.assigned_to}`}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
