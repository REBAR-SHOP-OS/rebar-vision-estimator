import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { StageHeader, Pill, EmptyState, type StageProps } from "./_shared";
import { ArrowLeft, ArrowRight } from "lucide-react";

interface Issue {
  id: string;
  title: string;
  description?: string | null;
  severity: string;
  status: string;
  sheet_id?: string | null;
  issue_type: string;
}

export default function QAStage({ projectId }: StageProps) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("validation_issues")
        .select("id,title,description,severity,status,sheet_id,issue_type")
        .eq("project_id", projectId).order("severity", { ascending: true });
      setIssues((data as any) || []);
      setSelectedId((data?.[0] as any)?.id || null);
      setLoading(false);
    })();
  }, [projectId]);

  const sel = issues.find((i) => i.id === selectedId);

  return (
    <div className="grid grid-cols-12 h-full">
      <div className="col-span-7 border-r border-border flex flex-col min-h-0">
        <StageHeader
          kicker="Stage 04"
          title="QA Gate"
          subtitle="Decides whether items return to takeoff or advance to confirmation."
        />
        <div className="flex-1 overflow-auto">
          {loading ? <EmptyState title="Loading QA issues..." /> :
            issues.length === 0 ? <EmptyState title="No QA issues" hint="When validation runs, blockers and warnings appear here." /> : (
            <table className="w-full text-xs font-mono">
              <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 w-20">Severity</th>
                  <th className="text-left px-3 py-2">Issue</th>
                  <th className="text-left px-3 py-2 w-24">Type</th>
                  <th className="text-left px-3 py-2 w-24">Status</th>
                </tr>
              </thead>
              <tbody>
                {issues.map((i) => (
                  <tr key={i.id} onClick={() => setSelectedId(i.id)}
                    className={`border-t border-border cursor-pointer ${selectedId === i.id ? "bg-primary/5" : "hover:bg-muted/30"}`}>
                    <td className="px-3 py-2">
                      <Pill tone={i.severity === "critical" || i.severity === "error" ? "bad" : i.severity === "warning" ? "warn" : "info"}>
                        {i.severity}
                      </Pill>
                    </td>
                    <td className="px-3 py-2 truncate max-w-0">{i.title}</td>
                    <td className="px-3 py-2 text-muted-foreground">{i.issue_type}</td>
                    <td className="px-3 py-2">{i.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <div className="col-span-5 flex flex-col min-h-0 bg-muted/20">
        <StageHeader kicker="Routing" title={sel ? sel.title : "Select an issue"} />
        <div className="flex-1 overflow-auto p-4 space-y-3">
          {!sel ? <EmptyState title="No issue selected" /> : (
            <>
              <div className="border border-border bg-card p-3 text-xs">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Description</div>
                <div>{sel.description || "—"}</div>
              </div>
              <div className="border border-border bg-card p-3 text-xs">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Source</div>
                <div className="font-mono">{sel.sheet_id || "—"}</div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button className="inline-flex items-center justify-center gap-1.5 px-2 py-2 text-[10px] font-mono uppercase tracking-wider border border-yellow-500/40 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/10">
                  <ArrowLeft className="w-3 h-3" /> Return to Takeoff
                </button>
                <button className="inline-flex items-center justify-center gap-1.5 px-2 py-2 text-[10px] font-mono uppercase tracking-wider border border-primary/50 text-primary hover:bg-primary/10">
                  Advance <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}