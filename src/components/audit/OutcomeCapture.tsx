import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { TrendingUp, TrendingDown, Minus, Save, BarChart3, Loader2 } from "lucide-react";

interface OutcomeCaptureProps {
  projects: { id: string; name: string }[];
}

const OutcomeCapture: React.FC<OutcomeCaptureProps> = ({ projects }) => {
  const { user } = useAuth();
  const [outcomes, setOutcomes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    project_id: "",
    award_status: "pending",
    quoted_price: "",
    quoted_weight_kg: "",
    actual_cost: "",
    actual_weight_kg: "",
    change_orders_total: "",
    notes: "",
  });

  useEffect(() => {
    loadOutcomes();
  }, []);

  const loadOutcomes = async () => {
    const { data, error } = await supabase
      .from("estimate_outcomes")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error && data) setOutcomes(data);
    setLoading(false);
  };

  const handleSave = async () => {
    if (!user || !form.project_id) return;
    setSaving(true);

    const payload = {
      user_id: user.id,
      project_id: form.project_id,
      award_status: form.award_status,
      quoted_price: form.quoted_price ? Number(form.quoted_price) : null,
      quoted_weight_kg: form.quoted_weight_kg ? Number(form.quoted_weight_kg) : null,
      actual_cost: form.actual_cost ? Number(form.actual_cost) : null,
      actual_weight_kg: form.actual_weight_kg ? Number(form.actual_weight_kg) : null,
      change_orders_total: form.change_orders_total ? Number(form.change_orders_total) : null,
      notes: form.notes || null,
    };

    let error;
    if (editingId) {
      ({ error } = await supabase.from("estimate_outcomes").update(payload).eq("id", editingId));
    } else {
      ({ error } = await supabase.from("estimate_outcomes").insert(payload));
    }

    if (error) {
      toast.error("Failed to save outcome");
    } else {
      toast.success(editingId ? "Outcome updated" : "Outcome saved");
      setEditingId(null);
      setForm({ project_id: "", award_status: "pending", quoted_price: "", quoted_weight_kg: "", actual_cost: "", actual_weight_kg: "", change_orders_total: "", notes: "" });
      loadOutcomes();
    }
    setSaving(false);
  };

  const runDeltaAnalysis = async () => {
    if (!user) return;
    setAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-outcomes", {
        body: { user_id: user.id },
      });
      if (error) throw error;
      setAnalysisResult(data);
      toast.success("Delta analysis complete");
    } catch (e) {
      toast.error("Analysis failed");
    }
    setAnalyzing(false);
  };

  const editOutcome = (o: any) => {
    setEditingId(o.id);
    setForm({
      project_id: o.project_id || "",
      award_status: o.award_status || "pending",
      quoted_price: o.quoted_price?.toString() || "",
      quoted_weight_kg: o.quoted_weight_kg?.toString() || "",
      actual_cost: o.actual_cost?.toString() || "",
      actual_weight_kg: o.actual_weight_kg?.toString() || "",
      change_orders_total: o.change_orders_total?.toString() || "",
      notes: o.notes || "",
    });
  };

  const statusIcon = (status: string) => {
    if (status === "won") return <TrendingUp className="h-3 w-3 text-primary" />;
    if (status === "lost") return <TrendingDown className="h-3 w-3 text-destructive" />;
    return <Minus className="h-3 w-3 text-muted-foreground" />;
  };

  return (
    <div className="space-y-4 p-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-foreground">Outcome Tracking</h2>
        <Button onClick={runDeltaAnalysis} disabled={analyzing} size="sm" variant="outline" className="gap-1.5">
          {analyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : <BarChart3 className="h-3 w-3" />}
          Run Delta Analysis
        </Button>
      </div>

      {/* Entry Form */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">{editingId ? "Edit Outcome" : "Record Outcome"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Project</Label>
              <Select value={form.project_id} onValueChange={(v) => setForm({ ...form, project_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Award Status</Label>
              <Select value={form.award_status} onValueChange={(v) => setForm({ ...form, award_status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="won">Won</SelectItem>
                  <SelectItem value="lost">Lost</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Quoted Price ($)</Label>
              <Input type="number" value={form.quoted_price} onChange={(e) => setForm({ ...form, quoted_price: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Actual Cost ($)</Label>
              <Input type="number" value={form.actual_cost} onChange={(e) => setForm({ ...form, actual_cost: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Quoted Weight (kg)</Label>
              <Input type="number" value={form.quoted_weight_kg} onChange={(e) => setForm({ ...form, quoted_weight_kg: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Actual Weight (kg)</Label>
              <Input type="number" value={form.actual_weight_kg} onChange={(e) => setForm({ ...form, actual_weight_kg: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Change Orders Total ($)</Label>
              <Input type="number" value={form.change_orders_total} onChange={(e) => setForm({ ...form, change_orders_total: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Notes</Label>
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          </div>
          <Button onClick={handleSave} disabled={saving || !form.project_id} size="sm" className="gap-1.5">
            <Save className="h-3 w-3" />
            {editingId ? "Update" : "Save"} Outcome
          </Button>
        </CardContent>
      </Card>

      {/* Analysis Results */}
      {analysisResult && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Delta Analysis Results
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-4 gap-2">
              <div className="rounded-lg bg-muted p-2 text-center">
                <p className="text-xs text-muted-foreground">Total</p>
                <p className="text-lg font-bold">{analysisResult.stats?.total_outcomes || 0}</p>
              </div>
              <div className="rounded-lg bg-muted p-2 text-center">
                <p className="text-xs text-muted-foreground">Won</p>
                <p className="text-lg font-bold text-primary">{analysisResult.stats?.won || 0}</p>
              </div>
              <div className="rounded-lg bg-muted p-2 text-center">
                <p className="text-xs text-muted-foreground">Lost</p>
                <p className="text-lg font-bold text-destructive">{analysisResult.stats?.lost || 0}</p>
              </div>
              <div className="rounded-lg bg-muted p-2 text-center">
                <p className="text-xs text-muted-foreground">Avg Delta</p>
                <p className="text-lg font-bold">{analysisResult.stats?.avg_delta_pct?.toFixed(1) || 0}%</p>
              </div>
            </div>
            {analysisResult.analysis && (
              <p className="text-xs text-muted-foreground whitespace-pre-wrap">{analysisResult.analysis}</p>
            )}
            {analysisResult.rules?.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold">Learned Rules:</p>
                {analysisResult.rules.map((r: any, i: number) => (
                  <div key={i} className="rounded border border-border p-2 text-xs space-y-0.5">
                    <p className="font-medium">{r.condition}</p>
                    <p className="text-muted-foreground">{r.correction}</p>
                    <Badge variant="secondary" className="text-[9px]">
                      Confidence: {(r.confidence * 100).toFixed(0)}%
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Outcomes Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Recorded Outcomes ({outcomes.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : outcomes.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">No outcomes recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Project</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Quoted</TableHead>
                  <TableHead className="text-xs">Actual</TableHead>
                  <TableHead className="text-xs">Delta</TableHead>
                  <TableHead className="text-xs"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {outcomes.map((o) => {
                  const projName = projects.find((p) => p.id === o.project_id)?.name || o.project_id?.slice(0, 8);
                  const delta = o.actual_cost && o.quoted_price ? ((o.actual_cost - o.quoted_price) / o.quoted_price * 100) : null;
                  return (
                    <TableRow key={o.id} className="cursor-pointer" onClick={() => editOutcome(o)}>
                      <TableCell className="text-xs">{projName}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {statusIcon(o.award_status)}
                          <span className="text-xs capitalize">{o.award_status}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">{o.quoted_price ? `$${Number(o.quoted_price).toLocaleString()}` : "—"}</TableCell>
                      <TableCell className="text-xs">{o.actual_cost ? `$${Number(o.actual_cost).toLocaleString()}` : "—"}</TableCell>
                      <TableCell className="text-xs">
                        {delta !== null ? (
                          <span className={delta > 0 ? "text-destructive" : "text-primary"}>
                            {delta > 0 ? "+" : ""}{delta.toFixed(1)}%
                          </span>
                        ) : "—"}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" className="text-xs h-6 px-2">Edit</Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default OutcomeCapture;
