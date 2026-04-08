import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Download, Loader2, ShieldAlert, CheckCircle2, Clock } from "lucide-react";
import { toast } from "sonner";
import { logAuditEvent } from "@/lib/audit-logger";
import { exportExcelFile } from "@/lib/excel-export";
import { getMassKgPerM } from "@/lib/rebar-weights";

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
    // Fetch segment IDs first, then bar_items count
    supabase.from("segments").select("id").eq("project_id", projectId).then(async (segRes) => {
      const segIds = (segRes.data || []).map((s: any) => s.id);
      const barItemsCountPromise = segIds.length > 0
        ? supabase.from("bar_items").select("id", { count: "exact" }).in("segment_id", segIds)
        : Promise.resolve({ count: 0 });

      const [est, shop, issues, quotes, appRes, openRes, estItems, barItemsRes] = await Promise.all([
        supabase.from("estimate_versions").select("id", { count: "exact" }).eq("project_id", projectId),
        supabase.from("shop_drawings").select("id", { count: "exact" }).eq("project_id", projectId),
        supabase.from("validation_issues").select("id", { count: "exact" }).eq("project_id", projectId),
        supabase.from("quote_versions").select("id", { count: "exact" }).eq("project_id", projectId),
        supabase.from("approvals").select("status").eq("project_id", projectId).is("segment_id", null).order("created_at", { ascending: false }).limit(1),
        supabase.from("validation_issues").select("id", { count: "exact" }).eq("project_id", projectId).eq("status", "open"),
        supabase.from("estimate_items").select("id", { count: "exact" }).eq("project_id", projectId),
        barItemsCountPromise,
      ]);

      const estCount = (est.count || 0) + (estItems.count || 0);
      const shopCount = (shop.count || 0);
      const barCount = (barItemsRes as any).count || 0;
      const hasEstData = estCount > 0 || barCount > 0;
      setOutputs([
        { type: "estimate", label: "Estimate Summary", available: hasEstData, count: estCount || barCount },
        { type: "shop_drawing", label: "Draft Shop Drawings", available: shopCount > 0 || barCount > 0, count: shopCount || barCount },
        { type: "issues", label: "Issue Report", available: hasEstData, count: issues.count || 0 },
        { type: "quote", label: "Quote Packages", available: hasEstData, count: (quotes.count || 0) || (hasEstData ? 1 : 0) },
      ]);
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
        const { data } = await supabase.from("validation_issues")
          .select("title, issue_type, severity, status, assigned_to, resolution_note, created_at")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false });
        const headers = ["Title", "Type", "Severity", "Status", "Assigned To", "Resolution Note", "Created"];
        const rows = (data || []).length > 0
          ? (data || []).map((r: any) => [r.title, r.issue_type, r.severity, r.status, r.assigned_to || "", r.resolution_note || "", r.created_at])
          : [["No issues found", "", "", "", "", "", new Date().toISOString()]];
        const csv = [headers.join(","), ...rows.map((r: any) => r.map((c: any) => `"${String(c).replace(/"/g, '""')}"`).join(","))].join("\n");
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `issues-report-${projectId.slice(0, 8)}.csv`; a.click();
        URL.revokeObjectURL(url);
        await logAuditEvent(user.id, "exported", "export", undefined, projectId, undefined, { export_type: "issues_csv" });
        toast.success("Issues report exported");
      } else if (type === "shop_drawing") {
        // Try existing shop drawing first
        const { data } = await supabase.from("shop_drawings")
          .select("html_content")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (data?.html_content) {
          const blob = new Blob([data.html_content], { type: "text/html" });
          const url = URL.createObjectURL(blob);
          window.open(url, "_blank");
        } else {
          // Generate a simple bar schedule HTML from bar_items
          const { data: segs } = await supabase.from("segments").select("id, name, segment_type").eq("project_id", projectId);
          const segIds = (segs || []).map((s: any) => s.id);
          const segMap: Record<string, string> = {};
          (segs || []).forEach((s: any) => { segMap[s.id] = s.name; });
          let bars: any[] = [];
          if (segIds.length > 0) {
            const { data: bi } = await supabase.from("bar_items").select("*").in("segment_id", segIds);
            bars = bi || [];
          }
          if (bars.length === 0) { toast.error("No shop drawing data available"); return; }
          const rows = bars.map((b: any, i: number) => `<tr><td>${i+1}</td><td>${segMap[b.segment_id] || ""}</td><td>${b.mark || ""}</td><td>${b.size || ""}</td><td>${b.shape_code || ""}</td><td>${b.cut_length || 0}</td><td>${b.quantity || 0}</td><td>${b.finish_type || ""}</td></tr>`).join("");
          const html = `<html><head><title>Bar Schedule</title><style>table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:6px 10px;font-size:13px}th{background:#2a5c5c;color:#fff}</style></head><body><h2>Bar Schedule</h2><table><tr><th>#</th><th>Segment</th><th>Mark</th><th>Size</th><th>Shape</th><th>Cut Length</th><th>Qty</th><th>Finish</th></tr>${rows}</table></body></html>`;
          const blob = new Blob([html], { type: "text/html" });
          const url = URL.createObjectURL(blob);
          window.open(url, "_blank");
        }
        await logAuditEvent(user.id, "exported", "export", undefined, projectId, undefined, { export_type: "shop_drawing_html" });
        toast.success("Shop drawing opened");
      } else if (type === "estimate") {
        // Fetch project, segments, estimate_items, bar_items
        const [projRes, segRes, eiRes] = await Promise.all([
          supabase.from("projects").select("name, client_name, address, deviations").eq("id", projectId).single(),
          supabase.from("segments").select("id, name, segment_type").eq("project_id", projectId),
          supabase.from("estimate_items").select("bar_size, quantity_count, total_weight, segment_id, description, confidence, status").eq("project_id", projectId).neq("item_type", "source_link"),
        ]);
        const segIds = (segRes.data || []).map((s: any) => s.id);
        const segMap: Record<string, string> = {};
        (segRes.data || []).forEach((s: any) => { segMap[s.id] = s.segment_type || s.name; });

        let barItems: any[] = [];
        if (segIds.length > 0) {
          const { data: bi } = await supabase.from("bar_items").select("*").in("segment_id", segIds);
          barItems = bi || [];
        }

        if ((eiRes.data || []).length === 0 && barItems.length === 0) { toast.error("No estimate items to export"); return; }

        // Build bar_list for excel-export
        const barList = barItems.map((b: any) => {
          const massKgM = getMassKgPerM(b.size);
          const lengthMm = (b.cut_length || 0);
          const qty = b.quantity || 0;
          const wtKg = qty * (lengthMm / 1000) * massKgM;
          return {
            element_type: segMap[b.segment_id] || "OTHER",
            size: b.size || "",
            qty,
            multiplier: 1,
            length_mm: lengthMm,
            weight_kg: wtKg,
            bend_type: b.shape_code || "",
            bar_mark: b.mark || "",
            description: b.mark || "",
            notes: b.finish_type || "",
          };
        });

        // Size breakdown
        const sizeBreakdownKg: Record<string, number> = {};
        barList.forEach((b: any) => { sizeBreakdownKg[b.size] = (sizeBreakdownKg[b.size] || 0) + b.weight_kg; });
        // Also add from estimate_items
        (eiRes.data || []).forEach((ei: any) => {
          if (ei.bar_size && ei.total_weight) {
            sizeBreakdownKg[ei.bar_size] = (sizeBreakdownKg[ei.bar_size] || 0) + Number(ei.total_weight);
          }
        });

        const totalKg = Object.values(sizeBreakdownKg).reduce((a, b) => a + b, 0);
        const proj = projRes.data;

        const quoteResult = {
          quote: {
            bar_list: barList,
            size_breakdown_kg: sizeBreakdownKg,
            total_weight_kg: totalKg,
            risk_flags: [],
            reconciliation: { drawing_based_total: totalKg },
          },
        };
        const scopeData = {
          projectName: proj?.name || "Rebar Takeoff",
          clientName: proj?.client_name || "",
          address: proj?.address || "",
          deviations: proj?.deviations || "None noted",
        };

        await exportExcelFile({ quoteResult, elements: [], scopeData });
        await logAuditEvent(user.id, "exported", "export", undefined, projectId, undefined, { export_type: "estimate_xlsx" });
        toast.success("Estimate Excel exported");
      } else if (type === "quote") {
        const { data } = await supabase.from("quote_versions")
          .select("version_number, quoted_price, currency, status, exclusions_text, terms_text, created_at")
          .eq("project_id", projectId)
          .order("version_number", { ascending: false });
        if (data && data.length > 0) {
          const headers = ["Version", "Price", "Currency", "Status", "Exclusions", "Terms", "Created"];
          const rows = data.map((r: any) => [r.version_number, r.quoted_price, r.currency, r.status, r.exclusions_text || "", r.terms_text || "", r.created_at]);
          const csv = [headers.join(","), ...rows.map((r: any) => r.map((c: any) => `"${String(c).replace(/"/g, '""')}"`).join(","))].join("\n");
          const blob = new Blob([csv], { type: "text/csv" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url; a.download = `quotes-${projectId.slice(0, 8)}.csv`; a.click();
          URL.revokeObjectURL(url);
        } else {
          // Generate draft quote from estimate data
          const { data: eiData } = await supabase.from("estimate_items")
            .select("description, bar_size, quantity_count, total_weight, confidence")
            .eq("project_id", projectId).neq("item_type", "source_link");
          const totalWt = (eiData || []).reduce((s: number, r: any) => s + (Number(r.total_weight) || 0), 0);
          const headers = ["Item", "Bar Size", "Qty", "Weight (kg)", "Confidence"];
          const rows = (eiData || []).map((r: any) => [r.description || "", r.bar_size || "", r.quantity_count, r.total_weight, r.confidence]);
          rows.push(["TOTAL", "", "", totalWt.toFixed(1), ""]);
          const csv = [headers.join(","), ...rows.map((r: any) => r.map((c: any) => `"${String(c).replace(/"/g, '""')}"`).join(","))].join("\n");
          const blob = new Blob([csv], { type: "text/csv" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url; a.download = `draft-quote-${projectId.slice(0, 8)}.csv`; a.click();
          URL.revokeObjectURL(url);
        }
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
