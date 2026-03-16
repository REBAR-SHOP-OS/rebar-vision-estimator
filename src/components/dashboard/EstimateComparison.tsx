import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GitCompare, TrendingUp, TrendingDown, Minus } from "lucide-react";

interface EstimateVersion {
  id: string;
  version_number: number;
  total_estimated_cost: number | null;
  scope_source_type: string | null;
  scope_confidence: number | null;
  confidence_score: number | null;
  status: string | null;
  created_at: string;
  line_items: any[];
}

const EstimateComparison: React.FC<{ projectId: string; onClose: () => void }> = ({ projectId, onClose }) => {
  const { user } = useAuth();
  const [versions, setVersions] = useState<EstimateVersion[]>([]);
  const [selected, setSelected] = useState<[string | null, string | null]>([null, null]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("estimate_versions")
      .select("id, version_number, total_estimated_cost, scope_source_type, scope_confidence, confidence_score, status, created_at, line_items")
      .eq("project_id", projectId)
      .order("version_number", { ascending: false })
      .then(({ data }) => {
        setVersions((data as EstimateVersion[]) || []);
        if (data && data.length >= 2) setSelected([data[0].id, data[1].id]);
        else if (data && data.length === 1) setSelected([data[0].id, null]);
        setLoading(false);
      });
  }, [user, projectId]);

  const vA = versions.find((v) => v.id === selected[0]);
  const vB = versions.find((v) => v.id === selected[1]);

  const computeWeight = (items: any[]): number => {
    if (!items || !Array.isArray(items)) return 0;
    return items.reduce((sum: number, el: any) => sum + (el.total_weight_kg || el.weight_kg || 0), 0);
  };

  const weightA = vA ? computeWeight(vA.line_items) : 0;
  const weightB = vB ? computeWeight(vB.line_items) : 0;
  const delta = weightA - weightB;
  const deltaPercent = weightB > 0 ? ((delta / weightB) * 100).toFixed(1) : "N/A";

  const fmtDate = (ts: string) => new Date(ts).toLocaleDateString();

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
          <GitCompare className="h-5 w-5 text-primary" />
          Estimate Comparison
        </h2>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : versions.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-10">No estimates yet for this project.</div>
      ) : (
        <>
          {/* Version Selectors */}
          <div className="grid grid-cols-2 gap-3">
            {["Version A", "Version B"].map((label, idx) => (
              <div key={label}>
                <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
                <select
                  value={selected[idx] || ""}
                  onChange={(e) => {
                    const newSel = [...selected] as [string | null, string | null];
                    newSel[idx] = e.target.value || null;
                    setSelected(newSel);
                  }}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                >
                  <option value="">None</option>
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      v{v.version_number} — {fmtDate(v.created_at)} ({v.status})
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {/* Comparison Summary */}
          {vA && vB && (
            <Card className="border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Weight Delta</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-[10px] text-muted-foreground">v{vA.version_number}</p>
                    <p className="text-lg font-bold text-foreground">{weightA.toFixed(0)} kg</p>
                  </div>
                  <div className="flex flex-col items-center justify-center">
                    {delta > 0 ? <TrendingUp className="h-5 w-5 text-destructive" /> :
                     delta < 0 ? <TrendingDown className="h-5 w-5 text-primary" /> :
                     <Minus className="h-5 w-5 text-muted-foreground" />}
                    <p className={`text-sm font-bold ${delta > 0 ? "text-destructive" : delta < 0 ? "text-primary" : "text-muted-foreground"}`}>
                      {delta > 0 ? "+" : ""}{delta.toFixed(0)} kg ({deltaPercent}%)
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">v{vB.version_number}</p>
                    <p className="text-lg font-bold text-foreground">{weightB.toFixed(0)} kg</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[vA, vB].map((v) => (
                    <div key={v.id} className="rounded-lg border border-border p-2 space-y-1">
                      <p className="font-medium text-foreground">v{v.version_number}</p>
                      <p className="text-muted-foreground">Scope: <Badge variant="outline" className="text-[9px]">{v.scope_source_type || "unknown"}</Badge></p>
                      <p className="text-muted-foreground">Confidence: {((v.scope_confidence || 0) * 100).toFixed(0)}%</p>
                      <p className="text-muted-foreground">Elements: {Array.isArray(v.line_items) ? v.line_items.length : 0}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Version List */}
          <Card className="border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">All Versions ({versions.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[250px]">
                <div className="space-y-1">
                  {versions.map((v) => (
                    <div key={v.id} className="flex items-center gap-2 py-1.5 border-b border-border/50 text-xs">
                      <Badge variant="outline" className="text-[9px]">v{v.version_number}</Badge>
                      <span className="text-foreground flex-1">{computeWeight(v.line_items).toFixed(0)} kg</span>
                      <Badge className={`text-[9px] ${v.status === "draft" ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary"}`}>
                        {v.status}
                      </Badge>
                      <span className="text-muted-foreground">{fmtDate(v.created_at)}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default EstimateComparison;
