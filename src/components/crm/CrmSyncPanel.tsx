import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Link2, ExternalLink, X } from "lucide-react";
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

interface CrmDeal {
  id: string;
  crm_deal_id: string;
  deal_name: string | null;
  deal_value: number | null;
  stage: string | null;
  status: string | null;
  close_date: string | null;
  company_name: string | null;
  synced_at: string;
}

interface Project {
  id: string;
  name: string;
}

interface CrmSyncPanelProps {
  projects: Project[];
  onClose: () => void;
}

const CrmSyncPanel: React.FC<CrmSyncPanelProps> = ({ projects, onClose }) => {
  const { user } = useAuth();
  const [deals, setDeals] = useState<CrmDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [linkingDealId, setLinkingDealId] = useState<string | null>(null);

  useEffect(() => {
    loadDeals();
  }, []);

  const loadDeals = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("crm_deals")
      .select("*")
      .order("synced_at", { ascending: false });

    if (error) {
      console.error("Failed to load deals:", error);
    } else {
      setDeals((data as CrmDeal[]) || []);
    }
    setLoading(false);
  };

  const linkDealToProject = async (dealCrmId: string, projectId: string) => {
    if (!user) return;
    const { error } = await supabase
      .from("estimate_outcomes")
      .upsert({
        user_id: user.id,
        project_id: projectId,
        crm_deal_id: dealCrmId,
      }, { onConflict: "user_id,project_id" } as any);

    if (error) {
      toast.error("Failed to link deal");
      console.error(error);
    } else {
      toast.success("Deal linked to project");
    }
    setLinkingDealId(null);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h2 className="text-lg font-semibold text-foreground">CRM Deals</h2>
        <Button onClick={onClose} size="sm" variant="ghost">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <p className="text-muted-foreground text-sm text-center py-8">Loading deals...</p>
        ) : deals.length === 0 ? (
          <div className="text-center py-12 space-y-3">
            <ExternalLink className="h-10 w-10 mx-auto text-muted-foreground" />
            <p className="text-muted-foreground text-sm">No deals found in the database.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Deal Name</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Close Date</TableHead>
                <TableHead>Link to Project</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deals.map((deal) => (
                <TableRow key={deal.id}>
                  <TableCell className="font-medium">{deal.deal_name || "—"}</TableCell>
                  <TableCell>{deal.company_name || "—"}</TableCell>
                  <TableCell>
                    {deal.deal_value ? `$${Number(deal.deal_value).toLocaleString()}` : "—"}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs">
                      {deal.stage || "—"}
                    </span>
                  </TableCell>
                  <TableCell>{deal.close_date || "—"}</TableCell>
                  <TableCell>
                    {linkingDealId === deal.crm_deal_id ? (
                      <Select onValueChange={(val) => linkDealToProject(deal.crm_deal_id, val)}>
                        <SelectTrigger className="w-40 h-8 text-xs">
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
                        onClick={() => setLinkingDealId(deal.crm_deal_id)}
                        className="gap-1 text-xs"
                      >
                        <Link2 className="h-3 w-3" /> Link
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
};

export default CrmSyncPanel;
