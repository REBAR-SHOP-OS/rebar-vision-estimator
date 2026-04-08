import { useParams, useNavigate } from "react-router-dom";
import { getMassKgPerM } from "@/lib/rebar-weights";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Loader2, Layers, AlertTriangle, FileText, Eye, CheckCircle2, ShieldAlert, Clock, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { logAuditEvent } from "@/lib/audit-logger";
import SourcesPanel from "@/components/workspace/SourcesPanel";
import ApprovalPanel from "@/components/workspace/ApprovalPanel";
import DrawingViewsPanel from "@/components/workspace/DrawingViewsPanel";
import QATab from "@/components/workspace/QATab";

export default function SegmentDetail() {
  const { id: projectId, segId } = useParams<{ id: string; segId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [segment, setSegment] = useState<any>(null);
  const [estimateItems, setEstimateItems] = useState<any[]>([]);
  const [barItems, setBarItems] = useState<any[]>([]);
  const [issues, setIssues] = useState<any[]>([]);
  const [approvalStatus, setApprovalStatus] = useState<string>("none");
  const [loading, setLoading] = useState(true);
  const [projectFiles, setProjectFiles] = useState<any[]>([]);

  // Estimate item edit state
  const [editItem, setEditItem] = useState<any>(null);
  const [eiDesc, setEiDesc] = useState("");
  const [eiBarSize, setEiBarSize] = useState("");
  const [eiQty, setEiQty] = useState("");
  const [eiLength, setEiLength] = useState("");
  const [eiWeight, setEiWeight] = useState("");
  const [eiStatus, setEiStatus] = useState("draft");
  const [eiSourceFileId, setEiSourceFileId] = useState("__none__");
  const [eiSaving, setEiSaving] = useState(false);

  // Bar item add/edit state
  const [editBar, setEditBar] = useState<any>(null);
  const [barDialogOpen, setBarDialogOpen] = useState(false);
  const [bMark, setBMark] = useState("");
  const [bSize, setBSize] = useState("");
  const [bShape, setBShape] = useState("");
  const [bCutLen, setBCutLen] = useState("");
  const [bQty, setBQty] = useState("");
  const [bFinish, setBFinish] = useState("black");
  const [bCover, setBCover] = useState("");
  const [bLap, setBLap] = useState("");
  const [barSaving, setBarSaving] = useState(false);
  const [autoEstimating, setAutoEstimating] = useState(false);
  const [autoBarScheduling, setAutoBarScheduling] = useState(false);

  const runAutoEstimate = async () => {
    if (!user || !segId || !projectId) return;
    setAutoEstimating(true);
    try {
      const { data, error } = await supabase.functions.invoke("auto-estimate", {
        body: { segment_id: segId, project_id: projectId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Auto-estimate created ${data.items_created} items`);
      loadData();
    } catch (e: any) {
      toast.error(e.message || "Auto-estimate failed");
    } finally {
      setAutoEstimating(false);
    }
  };

  const runAutoBarSchedule = async () => {
    if (!user || !segId || !projectId) return;
    setAutoBarScheduling(true);
    try {
      const { data, error } = await supabase.functions.invoke("auto-bar-schedule", {
        body: { segment_id: segId, project_id: projectId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Auto bar schedule created ${data.bars_created} items`);
      loadData();
    } catch (e: any) {
      toast.error(e.message || "Auto bar schedule failed");
    } finally {
      setAutoBarScheduling(false);
    }
  };

  const loadData = () => {
    if (!segId || !projectId) return;
    setLoading(true);
    Promise.all([
      supabase.from("segments").select("*").eq("id", segId).single(),
      supabase.from("estimate_items").select("*").eq("segment_id", segId).neq("item_type", "source_link").order("created_at"),
      supabase.from("bar_items").select("*").eq("segment_id", segId).order("mark"),
      supabase.from("validation_issues").select("*").eq("segment_id", segId).order("created_at", { ascending: false }),
      supabase.from("approvals").select("status").eq("segment_id", segId).order("created_at", { ascending: false }).limit(1),
      supabase.from("project_files").select("id, file_name").eq("project_id", projectId),
    ]).then(([seg, est, bar, iss, app, files]) => {
      setSegment(seg.data);
      setEstimateItems(est.data || []);
      setBarItems(bar.data || []);
      setIssues(iss.data || []);
      setApprovalStatus(app.data?.[0]?.status || "none");
      setProjectFiles(files.data || []);
      setLoading(false);
    });
  };

  useEffect(() => { loadData(); }, [segId, projectId]);

  const deleteEstimateItem = async (itemId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Delete this estimate item?")) return;
    const { error } = await supabase.from("estimate_items").delete().eq("id", itemId);
    if (error) { toast.error("Delete failed"); return; }
    toast.success("Item deleted");
    loadData();
  };

  // Estimate item edit handlers
  const openEditItem = (item: any | null) => {
    setEditItem(item || "new");
    setEiDesc(item?.description || "");
    setEiBarSize(item?.bar_size || "");
    setEiQty(String(item?.quantity_count || 0));
    setEiLength(String(item?.total_length || 0));
    setEiWeight(String(item?.total_weight || 0));
    setEiStatus(item?.status || "draft");
    setEiSourceFileId(item?.source_file_id || "__none__");
  };

  const saveEditItem = async () => {
    if (!editItem || !user || !segId || !projectId) return;
    setEiSaving(true);
    const payload = {
      description: eiDesc.trim() || null,
      bar_size: eiBarSize.trim() || null,
      quantity_count: parseInt(eiQty) || 0,
      total_length: parseFloat(eiLength) || 0,
      total_weight: parseFloat(eiWeight) || 0,
      status: eiStatus,
      source_file_id: eiSourceFileId === "__none__" ? null : eiSourceFileId,
    };
    if (editItem === "new") {
      const { error, data } = await supabase.from("estimate_items").insert({
        ...payload,
        segment_id: segId,
        project_id: projectId,
        user_id: user.id,
      }).select("id").single();
      if (error) toast.error("Failed to create item");
      else {
        await logAuditEvent(user.id, "created", "estimate_item", data.id, projectId, segId);
        toast.success("Item created");
        setEditItem(null);
        loadData();
      }
    } else {
      const { error } = await supabase.from("estimate_items").update(payload).eq("id", editItem.id);
      if (error) toast.error("Failed to update item");
      else {
        await logAuditEvent(user.id, "updated", "estimate_item", editItem.id, projectId, segId);
        toast.success("Item updated");
        setEditItem(null);
        loadData();
      }
    }
    setEiSaving(false);
  };

  // Bar item handlers
  const openBarDialog = (bar?: any) => {
    setEditBar(bar || null);
    setBMark(bar?.mark || "");
    setBSize(bar?.size || "");
    setBShape(bar?.shape_code || "");
    setBCutLen(String(bar?.cut_length || ""));
    setBQty(String(bar?.quantity || ""));
    setBFinish(bar?.finish_type || "black");
    setBCover(String(bar?.cover_value || ""));
    setBLap(String(bar?.lap_length || ""));
    setBarDialogOpen(true);
  };

  const saveBar = async () => {
    if (!user || !segId) return;
    setBarSaving(true);
    const payload = {
      mark: bMark.trim() || null,
      size: bSize.trim() || null,
      shape_code: bShape.trim() || null,
      cut_length: parseFloat(bCutLen) || 0,
      quantity: parseInt(bQty) || 0,
      finish_type: bFinish,
      cover_value: parseFloat(bCover) || null,
      lap_length: parseFloat(bLap) || null,
    };

    if (editBar) {
      const { error } = await supabase.from("bar_items").update(payload).eq("id", editBar.id);
      if (error) toast.error("Failed to update bar");
      else {
        await logAuditEvent(user.id, "updated", "bar_item", editBar.id, projectId, segId);
        toast.success("Bar updated");
      }
    } else {
      const { data, error } = await supabase.from("bar_items").insert({
        ...payload,
        segment_id: segId,
        user_id: user.id,
      }).select("id").single();
      if (error) toast.error("Failed to add bar");
      else {
        await logAuditEvent(user.id, "created", "bar_item", data?.id, projectId, segId);
        toast.success("Bar added");
      }
    }
    setBarDialogOpen(false);
    setBarSaving(false);
    loadData();
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  if (!segment) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
        <Layers className="h-8 w-8" />
        <p className="text-sm font-medium">Segment not found.</p>
        <Button variant="outline" size="sm" onClick={() => navigate(`/app/project/${projectId}`)}>Back to Project</Button>
      </div>
    );
  }

  const totalWeight = estimateItems.reduce((sum, i) => sum + Number(i.total_weight || 0), 0);
  const totalLength = estimateItems.reduce((sum, i) => sum + Number(i.total_length || 0), 0);
  const openIssues = issues.filter(i => i.status === "open").length;
  const blockers = issues.filter(i => i.status === "open" && (i.severity === "error" || i.severity === "critical")).length;

  const readinessColor = (r: string) => {
    if (r === "ready") return "bg-[hsl(var(--status-approved))]/15 text-[hsl(var(--status-approved))]";
    if (r === "in_progress") return "bg-[hsl(var(--status-review))]/15 text-[hsl(var(--status-review))]";
    return "bg-muted text-muted-foreground";
  };

  const approvalIcon = () => {
    if (approvalStatus === "approved") return <CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--status-approved))]" />;
    if (approvalStatus === "rejected" || approvalStatus === "blocked") return <ShieldAlert className="h-3.5 w-3.5 text-destructive" />;
    if (approvalStatus === "pending") return <Clock className="h-3.5 w-3.5 text-[hsl(var(--status-review))]" />;
    return null;
  };

  const fileNameById = (id: string) => projectFiles.find(f => f.id === id)?.file_name || "";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-muted/30">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/app/project/${projectId}/segments`)} className="h-8 w-8">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-foreground truncate">{segment.name}</h2>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <Badge variant="outline" className="text-[9px] capitalize">{segment.segment_type.replace(/_/g, " ")}</Badge>
            <Badge variant="secondary" className="text-[9px]">{segment.status}</Badge>
            <Badge className={`text-[9px] ${readinessColor(segment.drawing_readiness)}`}>{(segment.drawing_readiness || "not_ready").replace(/_/g, " ")}</Badge>
            {approvalStatus !== "none" && (
              <span className="flex items-center gap-1">{approvalIcon()}<span className="text-[9px] text-muted-foreground capitalize">{approvalStatus}</span></span>
            )}
            {segment.level_label && <span className="text-[10px] text-muted-foreground">Level: {segment.level_label}</span>}
          </div>
        </div>
        {blockers > 0 && (
          <Badge variant="destructive" className="text-[9px] gap-1"><ShieldAlert className="h-3 w-3" />{blockers} blocker{blockers !== 1 ? "s" : ""}</Badge>
        )}
      </div>

      <Tabs defaultValue="estimate" className="flex flex-col flex-1">
        <div className="border-b border-border px-4">
          <TabsList className="bg-transparent h-9 gap-1">
            <TabsTrigger value="estimate" className="text-xs">Estimate</TabsTrigger>
            <TabsTrigger value="bars" className="text-xs">Bar Schedule</TabsTrigger>
            <TabsTrigger value="drawings" className="text-xs">Drawings</TabsTrigger>
            <TabsTrigger value="issues" className="text-xs">Issues ({openIssues})</TabsTrigger>
            <TabsTrigger value="sources" className="text-xs">Sources</TabsTrigger>
            <TabsTrigger value="approvals" className="text-xs">Approvals</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="estimate" className="flex-1 overflow-auto p-4 m-0">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-foreground">Estimate Items</h4>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs" onClick={runAutoEstimate} disabled={autoEstimating}>
                {autoEstimating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                {autoEstimating ? "Estimating…" : "Auto Estimate"}
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs" onClick={() => openEditItem(null)}>
                <Plus className="h-3 w-3" />Add Item
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Card><CardContent className="p-3 text-center"><p className="text-lg font-bold">{estimateItems.length}</p><p className="text-[10px] text-muted-foreground uppercase">Items</p></CardContent></Card>
            <Card><CardContent className="p-3 text-center"><p className="text-lg font-bold font-mono">{totalLength.toLocaleString()}</p><p className="text-[10px] text-muted-foreground uppercase">Total Length (m)</p></CardContent></Card>
            <Card><CardContent className="p-3 text-center"><p className="text-lg font-bold font-mono">{totalWeight.toLocaleString()}</p><p className="text-[10px] text-muted-foreground uppercase">Total Weight (kg)</p></CardContent></Card>
            <Card><CardContent className="p-3 text-center"><p className="text-lg font-bold">{openIssues}</p><p className="text-[10px] text-muted-foreground uppercase">Open Issues</p></CardContent></Card>
          </div>

          {blockers > 0 && (
            <div className="flex items-center gap-2 p-2.5 mb-3 bg-destructive/10 border border-destructive/20 rounded-lg">
              <ShieldAlert className="h-3.5 w-3.5 text-destructive" />
              <span className="text-xs text-destructive">{blockers} blocker(s) must be resolved before approval.</span>
            </div>
          )}

          {estimateItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2 border border-dashed border-border rounded-lg">
              <FileText className="h-6 w-6" />
              <p className="text-xs">No estimate items yet.</p>
              <p className="text-[10px]">Click <strong>"Add Item"</strong> above or run AI analysis.</p>
            </div>
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
                    <th className="text-left px-3 py-2 font-semibold">Source</th>
                    <th className="text-left px-3 py-2 font-semibold">Status</th>
                    <th className="px-2 py-2 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {estimateItems.map((item) => (
                    <tr key={item.id} className="border-t border-border/50 hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => openEditItem(item)}>
                      <td className="px-3 py-2 text-foreground">{item.description || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{item.bar_size || "—"}</td>
                      <td className="px-3 py-2 text-right font-mono">{item.quantity_count}</td>
                      <td className="px-3 py-2 text-right font-mono">{Number(item.total_length).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-mono">{Number(item.total_weight).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-mono">{Number(item.confidence) > 0 ? `${Math.round(Number(item.confidence) * 100)}%` : "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground text-[10px] truncate max-w-[160px]">
                        {segment ? [segment.level_label, segment.zone_label, segment.name].filter(Boolean).join(" · ") : "—"}
                      </td>
                      <td className="px-3 py-2"><Badge variant="outline" className="text-[9px]">{item.status}</Badge></td>
                      <td className="px-2 py-2">
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={(e) => deleteEstimateItem(item.id, e)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="bars" className="flex-1 overflow-auto p-4 m-0">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-foreground">Bar Schedule</h4>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs" onClick={runAutoBarSchedule} disabled={autoBarScheduling || estimateItems.length === 0}>
                {autoBarScheduling ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                {autoBarScheduling ? "Generating…" : "Auto Schedule"}
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs" onClick={() => openBarDialog()}>
                <Plus className="h-3 w-3" />Add Bar
              </Button>
            </div>
          </div>
          {(() => {
            const computeBarWeightKg = (b: any) => {
              const qty = Number(b.quantity) || 0;
              const cutMm = Number(b.cut_length) || 0;
              const massKgM = getMassKgPerM(b.size || "");
              return qty * (cutMm / 1000) * massKgM;
            };
            const totalBarCount = barItems.length;
            const totalBarQty = barItems.reduce((s, b) => s + (Number(b.quantity) || 0), 0);
            const totalBarWeightKg = barItems.reduce((s, b) => s + computeBarWeightKg(b), 0);
            const totalCutLength = barItems.reduce((s, b) => s + (Number(b.cut_length) || 0), 0);
            const uniqueSizes = [...new Set(barItems.map(b => b.size).filter(Boolean))];

            return barItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2 border border-dashed border-border rounded-lg">
                <Layers className="h-6 w-6" />
                <p className="text-xs">No bar items yet.</p>
                <p className="text-[10px]">Add bars manually or run estimation.</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <Card><CardContent className="p-3 text-center"><p className="text-lg font-bold">{totalBarCount}</p><p className="text-[10px] text-muted-foreground uppercase">Bars</p></CardContent></Card>
                  <Card><CardContent className="p-3 text-center"><p className="text-lg font-bold font-mono">{totalBarQty}</p><p className="text-[10px] text-muted-foreground uppercase">Total Qty</p></CardContent></Card>
                  <Card><CardContent className="p-3 text-center"><p className="text-lg font-bold font-mono">{totalBarWeightKg.toLocaleString(undefined, { maximumFractionDigits: 1 })}</p><p className="text-[10px] text-muted-foreground uppercase">Weight (kg)</p></CardContent></Card>
                  <Card><CardContent className="p-3 text-center"><p className="text-lg font-bold">{uniqueSizes.join(", ") || "—"}</p><p className="text-[10px] text-muted-foreground uppercase">Sizes</p></CardContent></Card>
                </div>
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
                        <th className="text-right px-3 py-2 font-semibold">Weight (kg)</th>
                        <th className="text-right px-3 py-2 font-semibold">Confidence</th>
                        <th className="text-right px-3 py-2 font-semibold"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {barItems.map((b) => {
                        const wKg = computeBarWeightKg(b);
                        return (
                          <tr key={b.id} className="border-t border-border/50 hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => openBarDialog(b)}>
                            <td className="px-3 py-2 font-medium text-foreground">{b.mark || "—"}</td>
                            <td className="px-3 py-2 text-muted-foreground">{b.size || "—"}</td>
                            <td className="px-3 py-2 text-muted-foreground">{b.shape_code || "—"}</td>
                            <td className="px-3 py-2 text-right font-mono">{Number(b.cut_length).toLocaleString()}</td>
                            <td className="px-3 py-2 text-right font-mono">{b.quantity}</td>
                            <td className="px-3 py-2 text-muted-foreground capitalize">{b.finish_type}</td>
                            <td className="px-3 py-2 text-right font-mono font-semibold text-primary">{wKg > 0 ? wKg.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "—"}</td>
                            <td className="px-3 py-2 text-right font-mono">{Number(b.confidence) > 0 ? `${Math.round(Number(b.confidence) * 100)}%` : "—"}</td>
                            <td className="px-3 py-2 text-right"><Pencil className="h-3 w-3 text-muted-foreground" /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-border bg-muted/40 font-semibold">
                        <td className="px-3 py-2 text-foreground" colSpan={4}>Total</td>
                        <td className="px-3 py-2 text-right font-mono">{totalBarQty}</td>
                        <td className="px-3 py-2"></td>
                        <td className="px-3 py-2 text-right font-mono text-primary">{totalBarWeightKg.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                        <td className="px-3 py-2" colSpan={2}></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            );
          })()}
        </TabsContent>

        <TabsContent value="drawings" className="flex-1 overflow-auto p-4 m-0">
          <DrawingViewsPanel segmentId={segId!} projectId={projectId} />
        </TabsContent>

        <TabsContent value="issues" className="flex-1 overflow-auto m-0">
          <QATab projectId={projectId!} segmentId={segId} />
        </TabsContent>

        <TabsContent value="sources" className="flex-1 overflow-auto p-4 m-0">
          <SourcesPanel segmentId={segId!} projectId={projectId!} />
        </TabsContent>

        <TabsContent value="approvals" className="flex-1 overflow-auto p-4 m-0">
          <ApprovalPanel projectId={projectId!} segmentId={segId} />
        </TabsContent>
      </Tabs>

      {/* Estimate Item Edit Dialog */}
      <Dialog open={!!editItem} onOpenChange={(open) => !open && setEditItem(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="text-sm">{editItem === "new" ? "Add Estimate Item" : "Edit Estimate Item"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Description</Label><Input value={eiDesc} onChange={e => setEiDesc(e.target.value)} className="h-9 text-sm" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">Bar Size</Label><Input value={eiBarSize} onChange={e => setEiBarSize(e.target.value)} className="h-9 text-sm" placeholder="e.g. 20M" /></div>
              <div><Label className="text-xs">Status</Label>
                <Select value={eiStatus} onValueChange={setEiStatus}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["draft","pending","approved","rejected"].map(s => <SelectItem key={s} value={s} className="text-sm capitalize">{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label className="text-xs">Quantity</Label><Input type="number" value={eiQty} onChange={e => setEiQty(e.target.value)} className="h-9 text-sm" /></div>
              <div><Label className="text-xs">Length</Label><Input type="number" value={eiLength} onChange={e => setEiLength(e.target.value)} className="h-9 text-sm" /></div>
              <div><Label className="text-xs">Weight</Label><Input type="number" value={eiWeight} onChange={e => setEiWeight(e.target.value)} className="h-9 text-sm" /></div>
            </div>
            <div>
              <Label className="text-xs">Source File</Label>
              <Select value={eiSourceFileId} onValueChange={setEiSourceFileId}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" className="text-sm">None</SelectItem>
                  {projectFiles.filter(f => f.id).map(f => <SelectItem key={f.id} value={f.id} className="text-sm">{f.file_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={saveEditItem} disabled={eiSaving} className="w-full" size="sm">{eiSaving ? "Saving…" : editItem === "new" ? "Create Item" : "Save Changes"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bar Item Add/Edit Dialog */}
      <Dialog open={barDialogOpen} onOpenChange={setBarDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="text-sm">{editBar ? "Edit Bar" : "Add Bar"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div><Label className="text-xs">Mark</Label><Input value={bMark} onChange={e => setBMark(e.target.value)} className="h-9 text-sm" placeholder="e.g. A1" /></div>
              <div><Label className="text-xs">Size</Label><Input value={bSize} onChange={e => setBSize(e.target.value)} className="h-9 text-sm" placeholder="e.g. 15M" /></div>
              <div><Label className="text-xs">Shape Code</Label><Input value={bShape} onChange={e => setBShape(e.target.value)} className="h-9 text-sm" placeholder="e.g. 11" /></div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label className="text-xs">Cut Length</Label><Input type="number" value={bCutLen} onChange={e => setBCutLen(e.target.value)} className="h-9 text-sm" /></div>
              <div><Label className="text-xs">Quantity</Label><Input type="number" value={bQty} onChange={e => setBQty(e.target.value)} className="h-9 text-sm" /></div>
              <div><Label className="text-xs">Finish</Label>
                <Select value={bFinish} onValueChange={setBFinish}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["black","galvanized","epoxy","stainless"].map(f => <SelectItem key={f} value={f} className="text-sm capitalize">{f}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">Cover (mm)</Label><Input type="number" value={bCover} onChange={e => setBCover(e.target.value)} className="h-9 text-sm" /></div>
              <div><Label className="text-xs">Lap Length (mm)</Label><Input type="number" value={bLap} onChange={e => setBLap(e.target.value)} className="h-9 text-sm" /></div>
            </div>
            <Button onClick={saveBar} disabled={barSaving} className="w-full" size="sm">{barSaving ? "Saving…" : editBar ? "Save Changes" : "Add Bar"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
