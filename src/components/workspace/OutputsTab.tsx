import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Download, Loader2, ShieldAlert, CheckCircle2, Clock } from "lucide-react";
import { toast } from "sonner";
import { logAuditEvent } from "@/lib/audit-logger";

interface OutputItem {
  type: string;
  label: string;
  available: boolean;
  count?: number;
}

export default function OutputsTab({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const [outputs, setOutputs] = useState<OutputItem[]>([]);
  const [approvalStatus, setApprovalStatus] = useState<string>("none");
  const [openIssues, setOpenIssues] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      supabase.from("estimate_versions").select("id", { count: "exact" }).eq("project_id", projectId),
      supabase.from("shop_drawings").select("id", { count: "exact" }).eq("project_id", projectId),
      supabase.from("validation_issues").select("id", { count: "exact" }).eq("project_id", projectId),
      supabase.from("quote_versions").select("id", { count: "exact" }).eq("project_id", projectId),
      supabase.from("approvals").select("status").eq("project_id", projectId).is("segment_id", null).order("created_at", { ascending: false }).limit(1),
      supabase.from("validation_issues").select("id", { count: "exact" }).eq("project_id", projectId).eq("status", "open"),
    ]).then(([est, shop, issues, quotes, appRes, openRes]) => {
      setOutputs([
        { type: "estimate", label: "Estimate Summary", available: (est.count || 0) > 0, count: est.count || 0 },
        { type: "shop_drawing", label: "Draft Shop Drawings", available: (shop.count || 0) > 0, count: shop.count || 0 },
        { type: "issues", label: "Issue Report", available: (issues.count || 0) > 0, count: issues.count || 0 },
        { type: "quote", label: "Quote Packages", available: (quotes.count || 0) > 0, count: quotes.count || 0 },
      ]);
      // Project-level approvals gate outputs (segment-level are informational)
      setApprovalStatus(appRes.data?.[0]?.status || "none");
      setOpenIssues(openRes.count || 0);
      setLoading(false);
    });
  }, [projectId]);

  const handleExport = async (type: string) => {
    if (!user) return;
    setExporting(type);
    try {
      if (type === "issues") {
        // Generate CSV of issues
        const { data } = await supabase.from("validation_issues")
          .select("title, issue_type, severity, status, assigned_to, resolution_note, created_at")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false });
        if (!data || data.length === 0) { toast.error("No issues to export"); return; }
        const headers = ["Title", "Type", "Severity", "Status", "Assigned To", "Resolution Note", "Created"];
        const rows = data.map((r: any) => [r.title, r.issue_type, r.severity, r.status, r.assigned_to || "", r.resolution_note || "", r.created_at]);
        const csv = [headers.join(","), ...rows.map((r: any) => r.map((c: any) => `"${String(c).replace(/"/g, '""')}"`).join(","))].join("\n");
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `issues-report-${projectId.slice(0, 8)}.csv`; a.click();
        URL.revokeObjectURL(url);
        await logAuditEvent(user.id, "exported", "export", undefined, projectId, undefined, { export_type: "issues_csv" });
        toast.success("Issues report exported");
      } else if (type === "shop_drawing") {
        // Fetch latest shop drawing HTML and open in new tab
        const { data } = await supabase.from("shop_drawings")
          .select("html_content")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();
        if (!data?.html_content) { toast.error("No shop drawing available"); return; }
        const blob = new Blob([data.html_content], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
        await logAuditEvent(user.id, "exported", "export", undefined, projectId, undefined, { export_type: "shop_drawing_html" });
        toast.success("Shop drawing opened");
      } else if (type === "estimate") {
        // Export estimate summary as CSV
        const { data } = await supabase.from("estimate_items")
          .select("description, bar_size, quantity_count, total_length, total_weight, confidence, status")
          .eq("project_id", projectId)
          .neq("item_type", "source_link")
          .order("created_at");
        if (!data || data.length === 0) { toast.error("No estimate items to export"); return; }
        const headers = ["Description", "Bar Size", "Qty", "Length", "Weight", "Confidence", "Status"];
        const rows = data.map((r: any) => [r.description || "", r.bar_size || "", r.quantity_count, r.total_length, r.total_weight, r.confidence, r.status]);
        const csv = [headers.join(","), ...rows.map((r: any) => r.map((c: any) => `"${String(c).replace(/"/g, '""')}"`).join(","))].join("\n");
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `estimate-summary-${projectId.slice(0, 8)}.csv`; a.click();
        URL.revokeObjectURL(url);
        await logAuditEvent(user.id, "exported", "export", undefined, projectId, undefined, { export_type: "estimate_csv" });
        toast.success("Estimate summary exported");
      } else if (type === "quote") {
        const { data } = await supabase.from("quote_versions")
          .select("version_number, quoted_price, currency, status, exclusions_text, terms_text, created_at")
          .eq("project_id", projectId)
          .order("version_number", { ascending: false });
        if (!data || data.length === 0) { toast.error("No quotes to export"); return; }
        const headers = ["Version", "Price", "Currency", "Status", "Exclusions", "Terms", "Created"];
        const rows = data.map((r: any) => [r.version_number, r.quoted_price, r.currency, r.status, r.exclusions_text || "", r.terms_text || "", r.created_at]);
        const csv = [headers.join(","), ...rows.map((r: any) => r.map((c: any) => `"${String(c).replace(/"/g, '""')}"`).join(","))].join("\n");
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `quotes-${projectId.slice(0, 8)}.csv`; a.click();
        URL.revokeObjectURL(url);
        await logAuditEvent(user.id, "exported", "export", undefined, projectId, undefined, { export_type: "quote_csv" });
        toast.success("Quote package exported");
      }
    } catch (err) {
      toast.error("Export failed");
    } finally {
      setExporting(null);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-40"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  }

  const isBlocked = openIssues > 0;
  const isApproved = approvalStatus === "approved";

  return (
    <div className="p-4 md:p-6">
      <h3 className="text-sm font-semibold text-foreground mb-3">Outputs & Exports</h3>

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
              <Button
                variant="outline"
                size="sm"
                disabled={!o.available || exporting === o.type}
                className="text-xs h-8"
                onClick={() => handleExport(o.type)}
              >
                {exporting === o.type ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Download className="h-3.5 w-3.5 mr-1" />}
                Export
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
