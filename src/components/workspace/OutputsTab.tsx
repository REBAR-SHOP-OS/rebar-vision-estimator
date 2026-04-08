import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Download, Loader2, ShieldAlert, CheckCircle2, Clock } from "lucide-react";

interface OutputItem {
  type: string;
  label: string;
  available: boolean;
  count?: number;
}

export default function OutputsTab({ projectId }: { projectId: string }) {
  const [outputs, setOutputs] = useState<OutputItem[]>([]);
  const [approvalStatus, setApprovalStatus] = useState<string>("none");
  const [openIssues, setOpenIssues] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      supabase.from("estimate_versions").select("id", { count: "exact" }).eq("project_id", projectId),
      supabase.from("shop_drawings").select("id", { count: "exact" }).eq("project_id", projectId),
      supabase.from("validation_issues").select("id", { count: "exact" }).eq("project_id", projectId),
      supabase.from("quote_versions").select("id", { count: "exact" }).eq("project_id", projectId),
      supabase.from("approvals").select("status").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1),
      supabase.from("validation_issues").select("id", { count: "exact" }).eq("project_id", projectId).eq("status", "open"),
    ]).then(([est, shop, issues, quotes, appRes, openRes]) => {
      setOutputs([
        { type: "estimate", label: "Estimate Summary", available: (est.count || 0) > 0, count: est.count || 0 },
        { type: "shop_drawing", label: "Draft Shop Drawings", available: (shop.count || 0) > 0, count: shop.count || 0 },
        { type: "issues", label: "Issue Report", available: (issues.count || 0) > 0, count: issues.count || 0 },
        { type: "quote", label: "Quote Packages", available: (quotes.count || 0) > 0, count: quotes.count || 0 },
      ]);
      setApprovalStatus(appRes.data?.[0]?.status || "none");
      setOpenIssues(openRes.count || 0);
      setLoading(false);
    });
  }, [projectId]);

  if (loading) {
    return <div className="flex items-center justify-center h-40"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  }

  const isBlocked = openIssues > 0;
  const isApproved = approvalStatus === "approved";

  return (
    <div className="p-4 md:p-6">
      <h3 className="text-sm font-semibold text-foreground mb-3">Outputs & Exports</h3>

      {/* Gating Banner */}
      {isBlocked && (
        <div className="flex items-center gap-2 p-3 mb-4 bg-destructive/10 border border-destructive/20 rounded-lg">
          <ShieldAlert className="h-4 w-4 text-destructive flex-shrink-0" />
          <span className="text-xs text-destructive font-medium">{openIssues} open issue(s) — resolve before exporting final outputs.</span>
        </div>
      )}

      {!isApproved && approvalStatus !== "none" && (
        <div className="flex items-center gap-2 p-3 mb-4 bg-[hsl(var(--status-review))]/10 border border-[hsl(var(--status-review))]/20 rounded-lg">
          <Clock className="h-4 w-4 text-[hsl(var(--status-review))] flex-shrink-0" />
          <span className="text-xs text-[hsl(var(--status-review))] font-medium">Approval pending — outputs are marked as draft until approved.</span>
        </div>
      )}

      {isApproved && !isBlocked && (
        <div className="flex items-center gap-2 p-3 mb-4 bg-[hsl(var(--status-approved))]/10 border border-[hsl(var(--status-approved))]/20 rounded-lg">
          <CheckCircle2 className="h-4 w-4 text-[hsl(var(--status-approved))] flex-shrink-0" />
          <span className="text-xs text-[hsl(var(--status-approved))] font-medium">Approved — outputs are ready for export.</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {outputs.map((o) => (
          <Card key={o.type} className={!o.available ? "opacity-50" : ""}>
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-foreground">{o.label}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {o.available ? `${o.count} available` : "Not yet generated"}
                    {o.available && !isApproved && " · Draft"}
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" disabled={!o.available} className="text-xs h-8">
                <Download className="h-3.5 w-3.5 mr-1" />Export
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
