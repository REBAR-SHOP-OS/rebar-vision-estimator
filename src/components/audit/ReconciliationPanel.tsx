import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Link2, CheckCircle, AlertTriangle, Loader2 } from "lucide-react";

interface ReconciliationPanelProps {
  projectId: string;
}

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

  if (loading) {
    return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link2 className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-bold text-foreground">Drawing ↔ Estimate Reconciliation</h3>
      </div>

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
        <p className="text-xs text-muted-foreground">No drawing sets or estimate versions found for this project. They will be created automatically during the estimation pipeline.</p>
      )}

      {/* Existing Records */}
      {records.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">Resolution History ({records.length})</p>
          {records.map((r) => (
            <Card key={r.id} className="p-3">
              <div className="flex items-center gap-2 mb-1">
                {r.resolved ? (
                  <CheckCircle className="h-3 w-3 text-primary" />
                ) : (
                  <AlertTriangle className="h-3 w-3 text-amber-500" />
                )}
                <Badge variant="secondary" className="text-[9px]">{r.issue_type}</Badge>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(r.created_at).toLocaleDateString()}
                </span>
              </div>
              {r.notes && <p className="text-xs text-muted-foreground">{r.notes}</p>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default ReconciliationPanel;
