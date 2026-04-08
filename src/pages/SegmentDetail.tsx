import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Loader2, Layers, AlertTriangle, FileText, Eye } from "lucide-react";

export default function SegmentDetail() {
  const { id: projectId, segId } = useParams<{ id: string; segId: string }>();
  const navigate = useNavigate();
  const [segment, setSegment] = useState<any>(null);
  const [estimateItems, setEstimateItems] = useState<any[]>([]);
  const [barItems, setBarItems] = useState<any[]>([]);
  const [issues, setIssues] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!segId) return;
    setLoading(true);
    Promise.all([
      supabase.from("segments").select("*").eq("id", segId).single(),
      supabase.from("estimate_items").select("*").eq("segment_id", segId).order("created_at"),
      supabase.from("bar_items").select("*").eq("segment_id", segId).order("mark"),
      supabase.from("validation_issues").select("*").eq("segment_id", segId).order("created_at", { ascending: false }),
    ]).then(([seg, est, bar, iss]) => {
      setSegment(seg.data);
      setEstimateItems(est.data || []);
      setBarItems(bar.data || []);
      setIssues(iss.data || []);
      setLoading(false);
    });
  }, [segId]);

  if (loading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  if (!segment) {
    return <div className="flex items-center justify-center h-full text-muted-foreground">Segment not found.</div>;
  }

  const totalWeight = estimateItems.reduce((sum, i) => sum + Number(i.total_weight || 0), 0);
  const totalLength = estimateItems.reduce((sum, i) => sum + Number(i.total_length || 0), 0);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-muted/30">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/app/project/${projectId}/segments`)} className="h-8 w-8">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-foreground truncate">{segment.name}</h2>
          <div className="flex items-center gap-2 mt-0.5">
            <Badge variant="outline" className="text-[9px] capitalize">{segment.segment_type.replace(/_/g, " ")}</Badge>
            <Badge variant="secondary" className="text-[9px]">{segment.status}</Badge>
            {segment.level_label && <span className="text-[10px] text-muted-foreground">Level: {segment.level_label}</span>}
          </div>
        </div>
      </div>

      <Tabs defaultValue="estimate" className="flex flex-col flex-1">
        <div className="border-b border-border px-4">
          <TabsList className="bg-transparent h-9 gap-1">
            <TabsTrigger value="estimate" className="text-xs">Estimate</TabsTrigger>
            <TabsTrigger value="bars" className="text-xs">Bar Schedule</TabsTrigger>
            <TabsTrigger value="issues" className="text-xs">Issues ({issues.length})</TabsTrigger>
            <TabsTrigger value="sources" className="text-xs">Sources</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="estimate" className="flex-1 overflow-auto p-4 m-0">
          {/* Summary Cards */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <Card><CardContent className="p-3 text-center"><p className="text-lg font-bold">{estimateItems.length}</p><p className="text-[10px] text-muted-foreground uppercase">Items</p></CardContent></Card>
            <Card><CardContent className="p-3 text-center"><p className="text-lg font-bold font-mono">{totalLength.toLocaleString()}</p><p className="text-[10px] text-muted-foreground uppercase">Total Length (m)</p></CardContent></Card>
            <Card><CardContent className="p-3 text-center"><p className="text-lg font-bold font-mono">{totalWeight.toLocaleString()}</p><p className="text-[10px] text-muted-foreground uppercase">Total Weight (kg)</p></CardContent></Card>
          </div>

          {estimateItems.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">No estimate items yet.</div>
          ) : (
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/60">
                  <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="text-left px-3 py-2 font-semibold">Description</th>
                    <th className="text-left px-3 py-2 font-semibold">Bar Size</th>
                    <th className="text-right px-3 py-2 font-semibold">Qty</th>
                    <th className="text-right px-3 py-2 font-semibold">Length</th>
                    <th className="text-right px-3 py-2 font-semibold">Weight</th>
                    <th className="text-right px-3 py-2 font-semibold">Confidence</th>
                    <th className="text-left px-3 py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {estimateItems.map((item) => (
                    <tr key={item.id} className="border-t border-border/50">
                      <td className="px-3 py-2 text-foreground">{item.description || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{item.bar_size || "—"}</td>
                      <td className="px-3 py-2 text-right font-mono">{item.quantity_count}</td>
                      <td className="px-3 py-2 text-right font-mono">{Number(item.total_length).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-mono">{Number(item.total_weight).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-mono">{Number(item.confidence) > 0 ? `${Math.round(Number(item.confidence) * 100)}%` : "—"}</td>
                      <td className="px-3 py-2"><Badge variant="outline" className="text-[9px]">{item.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="bars" className="flex-1 overflow-auto p-4 m-0">
          {barItems.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">No bar items yet.</div>
          ) : (
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/60">
                  <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="text-left px-3 py-2 font-semibold">Mark</th>
                    <th className="text-left px-3 py-2 font-semibold">Size</th>
                    <th className="text-left px-3 py-2 font-semibold">Shape</th>
                    <th className="text-right px-3 py-2 font-semibold">Cut Length</th>
                    <th className="text-right px-3 py-2 font-semibold">Qty</th>
                    <th className="text-left px-3 py-2 font-semibold">Finish</th>
                    <th className="text-right px-3 py-2 font-semibold">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {barItems.map((b) => (
                    <tr key={b.id} className="border-t border-border/50">
                      <td className="px-3 py-2 font-medium text-foreground">{b.mark || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{b.size || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{b.shape_code || "—"}</td>
                      <td className="px-3 py-2 text-right font-mono">{Number(b.cut_length).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-mono">{b.quantity}</td>
                      <td className="px-3 py-2 text-muted-foreground capitalize">{b.finish_type}</td>
                      <td className="px-3 py-2 text-right font-mono">{Number(b.confidence) > 0 ? `${Math.round(Number(b.confidence) * 100)}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="issues" className="flex-1 overflow-auto p-4 m-0">
          {issues.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">No issues for this segment.</div>
          ) : (
            <div className="space-y-2">
              {issues.map((issue) => (
                <div key={issue.id} className="border border-border rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-[hsl(var(--status-review))]" />
                    <span className="text-sm font-medium">{issue.title}</span>
                    <Badge variant="outline" className="text-[9px]">{issue.severity}</Badge>
                    <Badge variant={issue.status === "open" ? "destructive" : "default"} className="text-[9px]">{issue.status}</Badge>
                  </div>
                  {issue.description && <p className="text-xs text-muted-foreground mt-1">{issue.description}</p>}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="sources" className="flex-1 overflow-auto p-4 m-0">
          <div className="text-center py-8 text-sm text-muted-foreground">
            Source sheet linking coming soon.
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
