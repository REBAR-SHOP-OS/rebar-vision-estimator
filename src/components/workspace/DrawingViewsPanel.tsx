import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Loader2, Eye, Layers } from "lucide-react";

interface DrawingView {
  id: string;
  view_type: string;
  title: string | null;
  status: string;
  confidence: number;
  revision_label: string | null;
  created_at: string;
}

export default function DrawingViewsPanel({ segmentId }: { segmentId: string }) {
  const [views, setViews] = useState<DrawingView[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from("drawing_views").select("*").eq("segment_id", segmentId).order("created_at").then(({ data }) => {
      setViews((data as DrawingView[]) || []);
      setLoading(false);
    });
  }, [segmentId]);

  if (loading) return <div className="flex items-center justify-center h-24"><Loader2 className="h-4 w-4 animate-spin text-primary" /></div>;

  const statusColor = (s: string) => {
    if (s === "approved") return "bg-[hsl(var(--status-approved))]/15 text-[hsl(var(--status-approved))]";
    if (s === "review") return "bg-[hsl(var(--status-review))]/15 text-[hsl(var(--status-review))]";
    return "bg-muted text-muted-foreground";
  };

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <Eye className="h-4 w-4 text-muted-foreground" />Drawing Views
      </h4>
      {views.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-28 text-muted-foreground gap-1.5 border border-dashed border-border rounded-lg">
          <Layers className="h-6 w-6" />
          <p className="text-xs">No drawing views generated yet.</p>
          <p className="text-[10px]">Views will appear here after draft detailing.</p>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
