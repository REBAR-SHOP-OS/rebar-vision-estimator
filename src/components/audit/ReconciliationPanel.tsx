import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Link2, CheckCircle, AlertTriangle, Loader2, ShieldAlert, Eye, EyeOff, Filter } from "lucide-react";

interface ReconciliationPanelProps {
  projectId: string;
}

const ISSUE_TYPES = [
  "REVISION_CHAIN_AMBIGUOUS",
  "MISSING_SHEET_ID",
  "DUPLICATE_DETECTED",
  "MISSING_DEAL_LINK",
  "DRAWING_SET_TO_ESTIMATE_LINK",
] as const;

const ISSUE_LABELS: Record<string, { label: string; color: string }> = {
  REVISION_CHAIN_AMBIGUOUS: { label: "Revision Conflict", color: "text-amber-500" },
  MISSING_SHEET_ID: { label: "Missing Sheet ID", color: "text-orange-500" },
  DUPLICATE_DETECTED: { label: "Duplicate", color: "text-blue-500" },
  MISSING_DEAL_LINK: { label: "Missing Deal Link", color: "text-muted-foreground" },
  DRAWING_SET_TO_ESTIMATE_LINK: { label: "Drawing↔Estimate", color: "text-primary" },
};

const ReconciliationPanel: React.FC<ReconciliationPanelProps> = ({ projectId }) => {
  const { user } = useAuth();
  const [records, setRecords] = useState<any[]>([]);
  const [drawingSets, setDrawingSets] = useState<any[]>([]);
  const [estimateVersions, setEstimateVersions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDrawingSet, setSelectedDrawingSet] = useState("");
  const [selectedEstimateVersion, setSelectedEstimateVersion] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [filterType, setFilterType] = useState<string>("all");
  const [showResolved, setShowResolved] = useState(false);

  useEffect(() => {
    loadData();
  }, [projectId]);

  const loadData = async () => {
    setLoading(true);
    const [recRes, dsRes, evRes] = await Promise.all([
      supabase.from("reconciliation_records").select("*").eq("project_id", projectId).order("created_at", { ascending: false }),
      supabase.from("drawing_sets").select("*").eq("project_id", projectId),
      supabase.from("estimate_versions").select("*").eq("project_id", projectId),
    ]);
    if (recRes.data) setRecords(recRes.data);
    if (dsRes.data) setDrawingSets(dsRes.data);
    if (evRes.data) setEstimateVersions(evRes.data);
    setLoading(false);
  };

  const createLink = async () => {
    if (!user || !selectedDrawingSet || !selectedEstimateVersion) return;
    setSaving(true);
    const { error } = await supabase.from("reconciliation_records").insert({
      project_id: projectId,
      user_id: user.id,
      issue_type: "DRAWING_SET_TO_ESTIMATE_LINK",
      candidates: {
        drawing_set_id: selectedDrawingSet,
        estimate_version_id: selectedEstimateVersion,
      },
      human_resolution: {
        resolved: true,
        resolved_by: user.id,
        final_link: {
          drawing_set_id: selectedDrawingSet,
          estimate_version_id: selectedEstimateVersion,
        },
      },
      resolved: true,
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
      notes,
    });
    if (error) {
      toast.error("Failed to save link");
    } else {
      toast.success("Drawing-estimate link saved");
      setSelectedDrawingSet("");
      setSelectedEstimateVersion("");
      setNotes("");
      loadData();
    }
    setSaving(false);
  };

  const resolveRecord = async (recordId: string, action: "resolve" | "waive", resolutionNotes: string) => {
    if (!user) return;
    const { error } = await supabase
      .from("reconciliation_records")
      .update({
        resolved: true,
        resolved_by: user.id,
        resolved_at: new Date().toISOString(),
        human_resolution: { action, resolved_by: user.id, notes: resolutionNotes },
        notes: resolutionNotes || undefined,
      })
      .eq("id", recordId);

    if (error) {
      toast.error("Failed to update record");
    } else {
      toast.success(action === "resolve" ? "Issue resolved" : "Issue waived");
      loadData();
    }
  };

  const filteredRecords = records.filter((r) => {
    if (!showResolved && r.resolved) return false;
    if (filterType !== "all" && r.issue_type !== filterType) return false;
    return true;
  });

  const unresolvedCount = records.filter((r) => !r.resolved).length;

  if (loading) {
    return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Drawing ↔ Estimate Reconciliation</h3>
        </div>
        {unresolvedCount > 0 && (
          <Badge variant="destructive" className="text-[10px] gap-1">
            <ShieldAlert className="h-3 w-3" />
            {unresolvedCount} unresolved
          </Badge>
        )}
      </div>

      {/* Quality gate */}
      {unresolvedCount > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <p className="text-xs text-amber-700 dark:text-amber-400">
                <strong>{unresolvedCount} issue{unresolvedCount !== 1 ? "s" : ""}</strong> blocking production index status. Resolve or waive to proceed.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create Link */}
      {drawingSets.length > 0 && estimateVersions.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-xs">Link Drawing Set to Estimate Version</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Select value={selectedDrawingSet} onValueChange={setSelectedDrawingSet}>
                <SelectTrigger><SelectValue placeholder="Drawing Set" /></SelectTrigger>
                <SelectContent>
                  {drawingSets.map((ds) => (
                    <SelectItem key={ds.id} value={ds.id}>
                      {ds.set_name || `Set ${ds.issue_purpose}`} ({ds.issue_date || "no date"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={selectedEstimateVersion} onValueChange={setSelectedEstimateVersion}>
                <SelectTrigger><SelectValue placeholder="Estimate Version" /></SelectTrigger>
                <SelectContent>
                  {estimateVersions.map((ev) => (
                    <SelectItem key={ev.id} value={ev.id}>
                      v{ev.version_number} — {ev.status} ({ev.currency} {ev.total_quoted_price?.toLocaleString() || "draft"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Textarea placeholder="Resolution notes..." value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            <Button onClick={createLink} disabled={saving || !selectedDrawingSet || !selectedEstimateVersion} size="sm" className="gap-1.5">
              <Link2 className="h-3 w-3" />
              Save Link
            </Button>
          </CardContent>
        </Card>
      ) : (
        <p className="text-xs text-muted-foreground">No drawing sets or estimate versions found for this project.</p>
      )}

      {/* Filters */}
      {records.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="h-3 w-3 text-muted-foreground" />
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="h-7 text-[11px] w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-[11px]">All Types</SelectItem>
              {ISSUE_TYPES.map((t) => (
                <SelectItem key={t} value={t} className="text-[11px]">{ISSUE_LABELS[t]?.label || t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowResolved(!showResolved)}
            className="gap-1 text-[11px] h-7"
          >
            {showResolved ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            {showResolved ? "Hide Resolved" : "Show Resolved"}
          </Button>
        </div>
      )}

      {/* Records */}
      {filteredRecords.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">
            {showResolved ? "All" : "Open"} Issues ({filteredRecords.length})
          </p>
          {filteredRecords.map((r) => (
            <ReconciliationCard
              key={r.id}
              record={r}
              onResolve={(notes) => resolveRecord(r.id, "resolve", notes)}
              onWaive={(notes) => resolveRecord(r.id, "waive", notes)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/** Individual reconciliation record card with resolve/waive actions */
const ReconciliationCard: React.FC<{
  record: any;
  onResolve: (notes: string) => void;
  onWaive: (notes: string) => void;
}> = ({ record, onResolve, onWaive }) => {
  const [expanded, setExpanded] = useState(false);
  const [actionNotes, setActionNotes] = useState("");
  const info = ISSUE_LABELS[record.issue_type] || { label: record.issue_type, color: "text-muted-foreground" };

  return (
    <Card className={`p-3 ${record.resolved ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-2 mb-1">
        {record.resolved ? (
          <CheckCircle className="h-3 w-3 text-primary" />
        ) : (
          <AlertTriangle className={`h-3 w-3 ${info.color}`} />
        )}
        <Badge variant="secondary" className="text-[9px]">{info.label}</Badge>
        <span className="text-[10px] text-muted-foreground">
          {new Date(record.created_at).toLocaleDateString()}
        </span>
        {record.resolved && (
          <Badge variant="outline" className="text-[8px] text-primary">
            {(record.human_resolution as any)?.action === "waive" ? "Waived" : "Resolved"}
          </Badge>
        )}
      </div>
      {record.notes && <p className="text-xs text-muted-foreground mb-2">{record.notes}</p>}

      {!record.resolved && (
        <>
          {expanded ? (
            <div className="space-y-2 mt-2">
              <Textarea
                placeholder="Resolution notes..."
                value={actionNotes}
                onChange={(e) => setActionNotes(e.target.value)}
                rows={2}
                className="text-xs"
              />
              <div className="flex gap-1">
                <Button size="sm" className="text-[11px] h-7 gap-1" onClick={() => onResolve(actionNotes)}>
                  <CheckCircle className="h-3 w-3" /> Resolve
                </Button>
                <Button size="sm" variant="outline" className="text-[11px] h-7 gap-1" onClick={() => onWaive(actionNotes)}>
                  <EyeOff className="h-3 w-3" /> Waive
                </Button>
                <Button size="sm" variant="ghost" className="text-[11px] h-7" onClick={() => setExpanded(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="ghost" className="text-[11px] h-6 mt-1" onClick={() => setExpanded(true)}>
              Take Action
            </Button>
          )}
        </>
      )}
    </Card>
  );
};

export default ReconciliationPanel;
