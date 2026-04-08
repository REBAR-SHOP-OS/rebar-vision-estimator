import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Eye, Layers, Plus } from "lucide-react";
import { toast } from "sonner";
import { logAuditEvent } from "@/lib/audit-logger";

interface DrawingView {
  id: string;
  view_type: string;
  title: string | null;
  status: string;
  confidence: number;
  revision_label: string | null;
  created_at: string;
}

export default function DrawingViewsPanel({ segmentId, projectId }: { segmentId: string; projectId?: string }) {
  const { user } = useAuth();
  const [views, setViews] = useState<DrawingView[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const load = () => {
    supabase.from("drawing_views").select("*").eq("segment_id", segmentId).order("created_at").then(({ data }) => {
      setViews((data as DrawingView[]) || []);
      setLoading(false);
    });
  };

  useEffect(() => { load(); }, [segmentId]);

  const handleGenerate = async () => {
    if (!user || !projectId) return;
    setGenerating(true);
    try {
      // Create the drawing_views record first
      const { data: viewData, error: viewErr } = await supabase.from("drawing_views").insert({
        segment_id: segmentId,
        user_id: user.id,
        view_type: "plan",
        title: `Draft View ${views.length + 1}`,
        status: "generating",
        confidence: 0,
        revision_label: "R0",
      }).select("id").single();
      if (viewErr) throw viewErr;

      // Call the shop-drawing edge function
      const { data: fnData, error: fnErr } = await supabase.functions.invoke("generate-shop-drawing", {
        body: { projectId, segmentId },
      });

      if (fnErr) {
        // Fallback: mark as draft if edge function fails
        await supabase.from("drawing_views").update({ status: "draft" }).eq("id", viewData.id);
        toast.warning("Draft record created but drawing generation failed");
      } else {
        // Update view status to review
        await supabase.from("drawing_views").update({ status: "review", confidence: 0.5 }).eq("id", viewData.id);
        toast.success("Draft drawing generated");
      }

      await logAuditEvent(user.id, "created", "drawing_view", viewData?.id, projectId, segmentId);
      load();
    } catch {
      toast.error("Failed to create drawing view");
    }
    setGenerating(false);
  };

  if (loading) return <div className="flex items-center justify-center h-24"><Loader2 className="h-4 w-4 animate-spin text-primary" /></div>;

  const statusColor = (s: string) => {
    if (s === "approved") return "bg-[hsl(var(--status-approved))]/15 text-[hsl(var(--status-approved))]";
    if (s === "review") return "bg-[hsl(var(--status-review))]/15 text-[hsl(var(--status-review))]";
    return "bg-muted text-muted-foreground";
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Eye className="h-4 w-4 text-muted-foreground" />Drawing Views
        </h4>
        <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs" onClick={handleGenerate} disabled={generating}>
          {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          Generate Draft
        </Button>
      </div>
      {views.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-28 text-muted-foreground gap-1.5 border border-dashed border-border rounded-lg">
          <Layers className="h-6 w-6" />
          <p className="text-xs">No drawing views generated yet.</p>
          <p className="text-[10px]">Click "Generate Draft" to create a view.</p>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/60">
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="text-left px-3 py-2 font-semibold">View</th>
                <th className="text-left px-3 py-2 font-semibold">Type</th>
                <th className="text-left px-3 py-2 font-semibold">Status</th>
                <th className="text-right px-3 py-2 font-semibold">Confidence</th>
                <th className="text-left px-3 py-2 font-semibold">Rev</th>
                <th className="text-right px-3 py-2 font-semibold">Created</th>
              </tr>
            </thead>
            <tbody>
              {views.map((v) => (
                <tr key={v.id} className="border-t border-border/50 hover:bg-muted/20 transition-colors">
                  <td className="px-3 py-2 font-medium text-foreground">{v.title || "Untitled"}</td>
                  <td className="px-3 py-2"><Badge variant="outline" className="text-[9px] capitalize">{v.view_type}</Badge></td>
                  <td className="px-3 py-2"><Badge className={`text-[9px] ${statusColor(v.status)}`}>{v.status}</Badge></td>
                  <td className="px-3 py-2 text-right font-mono text-muted-foreground">{Number(v.confidence) > 0 ? `${Math.round(Number(v.confidence) * 100)}%` : "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{v.revision_label || "—"}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{new Date(v.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
