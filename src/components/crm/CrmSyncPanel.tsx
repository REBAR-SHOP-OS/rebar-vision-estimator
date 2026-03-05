import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link2, ExternalLink, X, RefreshCw, Zap, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Stage definitions from REBAR SHOP OS pipeline
const PIPELINE_STAGES: Record<string, { label: string; color: string }> = {
  estimation_ben: { label: "Estimation - Ben", color: "bg-amber-500" },
  estimation_karthick: { label: "Estimation - Karthick", color: "bg-orange-500" },
  hot_enquiries: { label: "Hot Enquiries", color: "bg-red-500" },
  qualified: { label: "Qualified", color: "bg-teal-500" },
};

interface PipelineLead {
  id: string;
  title: string;
  stage: string;
  expected_value: number | null;
  expected_close_date: string | null;
  priority: string | null;
  probability: number | null;
  source: string | null;
  created_at: string;
  customer_id: string | null;
  customers: { name: string; company_name: string | null } | null;
}

interface Project {
  id: string;
  name: string;
}

interface CrmSyncPanelProps {
  projects: Project[];
  onClose: () => void;
  onStartEstimation?: (projectId: string) => void;
}
const CrmSyncPanel: React.FC<CrmSyncPanelProps> = ({ projects, onClose, onStartEstimation }) => {
  const { user } = useAuth();
  const [leads, setLeads] = useState<PipelineLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [linkingLeadId, setLinkingLeadId] = useState<string | null>(null);
  const [creatingLeadId, setCreatingLeadId] = useState<string | null>(null);
  useEffect(() => {
    fetchLeads();
  }, []);

  const fetchLeads = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-pipeline-leads");
      if (error) {
        console.error("Failed to fetch pipeline leads:", error);
        toast.error("Failed to fetch pipeline leads");
      } else {
        setLeads(data?.leads || []);
      }
    } catch (err) {
      console.error("Error:", err);
      toast.error("Failed to connect to pipeline");
    }
    setLoading(false);
  };

  const linkLeadToProject = async (leadId: string, projectId: string) => {
    if (!user) return;
    const { error } = await supabase
      .from("estimate_outcomes")
      .upsert({
        user_id: user.id,
        project_id: projectId,
        crm_deal_id: leadId,
      }, { onConflict: "user_id,project_id" } as any);

    if (error) {
      toast.error("Failed to link lead");
      console.error(error);
    } else {
      toast.success("Lead linked to project");
    }
    setLinkingLeadId(null);
  };

  const startEstimationFromLead = async (lead: PipelineLead) => {
    if (!user || !onStartEstimation) return;
    setCreatingLeadId(lead.id);
    const projectName = lead.title || lead.customers?.company_name || "New Estimation";
    const clientName = lead.customers?.company_name || lead.customers?.name || null;

    const { data, error } = await supabase
      .from("projects")
      .insert({ user_id: user.id, name: projectName, client_name: clientName })
      .select()
      .single();

    if (error) {
      toast.error("Failed to create project");
      setCreatingLeadId(null);
      return;
    }

    // Link to estimate_outcomes
    await supabase.from("estimate_outcomes").insert({
      user_id: user.id,
      project_id: data.id,
      crm_deal_id: lead.id,
    });

    toast.success(`Project "${projectName}" created from lead`);
    setCreatingLeadId(null);
    onStartEstimation(data.id);
  };

  const getStageInfo = (stage: string) => {
    return PIPELINE_STAGES[stage] || { label: stage, color: "bg-muted" };
  };

  const getPriorityBadge = (priority: string | null) => {
    switch (priority) {
      case "high": return <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[10px]">High</Badge>;
      case "urgent": return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 text-[10px]">Urgent</Badge>;
      case "low": return <Badge className="bg-muted text-muted-foreground text-[10px]">Low</Badge>;
      default: return <Badge variant="secondary" className="text-[10px]">Medium</Badge>;
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-foreground">Pipeline Leads</h2>
          <Badge variant="secondary" className="text-xs">{leads.length} leads</Badge>
        </div>
        <div className="flex gap-2">
          <Button onClick={fetchLeads} disabled={loading} size="sm" variant="outline" className="gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button onClick={onClose} size="sm" variant="ghost">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
            <RefreshCw className="h-5 w-5 animate-spin" />
            <span className="text-sm">Fetching pipeline leads...</span>
          </div>
        ) : leads.length === 0 ? (
          <div className="text-center py-12 space-y-3">
            <ExternalLink className="h-10 w-10 mx-auto text-muted-foreground" />
            <p className="text-muted-foreground text-sm">No pending leads found in the pipeline.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lead Title</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Close Date</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((lead) => {
                const stageInfo = getStageInfo(lead.stage);
                return (
                  <TableRow key={lead.id}>
                    <TableCell className="font-medium max-w-[200px] truncate">{lead.title || "—"}</TableCell>
                    <TableCell className="text-sm">
                      {lead.customers?.company_name || lead.customers?.name || "—"}
                    </TableCell>
                    <TableCell className="font-medium">
                      {lead.expected_value ? `$${Number(lead.expected_value).toLocaleString()}` : "—"}
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium text-white ${stageInfo.color}`}>
                        {stageInfo.label}
                      </span>
                    </TableCell>
                    <TableCell>{getPriorityBadge(lead.priority)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {lead.expected_close_date || "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {onStartEstimation && (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => startEstimationFromLead(lead)}
                            disabled={creatingLeadId === lead.id}
                            className="gap-1 text-xs"
                          >
                            {creatingLeadId === lead.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                            Start
                          </Button>
                        )}
                        {linkingLeadId === lead.id ? (
                          <Select onValueChange={(val) => linkLeadToProject(lead.id, val)}>
                            <SelectTrigger className="w-32 h-8 text-xs">
                              <SelectValue placeholder="Select project" />
                            </SelectTrigger>
                            <SelectContent>
                              {projects.map((p) => (
                                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setLinkingLeadId(lead.id)}
                            className="gap-1 text-xs"
                          >
                            <Link2 className="h-3 w-3" /> Link
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
};

export default CrmSyncPanel;
