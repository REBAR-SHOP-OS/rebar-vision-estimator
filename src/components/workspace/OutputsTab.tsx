import { useEffect, useState } from "react";
import { buildShopDrawingHtml } from "@/lib/shop-drawing-template";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Download, Loader2, ShieldAlert, CheckCircle2, Clock, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { logAuditEvent } from "@/lib/audit-logger";
import { exportExcelFile } from "@/lib/excel-export";
import {
  getCurrentVerifiedEstimate,
  refreshVerifiedEstimateFromWorkspace,
} from "@/lib/verified-estimate/verified-estimate-store";

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
  const [aiDrafting, setAiDrafting] = useState(false);
  const [verifiedRow, setVerifiedRow] = useState<{
    id: string;
    status: string;
    blocked_reasons: unknown;
    result_json: unknown;
  } | null>(null);
  const [refreshingCanonical, setRefreshingCanonical] = useState(false);

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
    getCurrentVerifiedEstimate(supabase, projectId).then((r) => setVerifiedRow(r));
  }, [projectId]);

  const refreshCanonical = async () => {
    if (!user) return;
    setRefreshingCanonical(true);
    try {
      await refreshVerifiedEstimateFromWorkspace(supabase, projectId, user.id);
      const row = await getCurrentVerifiedEstimate(supabase, projectId);
      setVerifiedRow(row);
      toast.success("Canonical estimate refreshed from workspace data");
    } catch {
      toast.error("Could not refresh canonical estimate");
    } finally {
      setRefreshingCanonical(false);
    }
  };

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
        let ver = await getCurrentVerifiedEstimate(supabase, projectId);
        if (!ver) {
          await refreshVerifiedEstimateFromWorkspace(supabase, projectId, user.id);
          ver = await getCurrentVerifiedEstimate(supabase, projectId);
        }
        if (!ver || ver.status === "blocked") {
          const br = Array.isArray(ver?.blocked_reasons)
            ? (ver!.blocked_reasons as string[]).join(" ")
            : "Refresh canonical estimate from the Outputs tab or fix validation issues.";
          toast.error(br || "Export blocked — canonical estimate not verified.");
          return;
        }
        const canon = ver.result_json as { quote?: { bar_list?: any[]; size_breakdown_kg?: Record<string, number> } };
        const projRes2 = await supabase.from("projects").select("name, client_name").eq("id", projectId).single();
        let opened = false;
        if (canon?.quote?.bar_list && canon.quote.bar_list.length > 0) {
          const sizeBreak = canon.quote.size_breakdown_kg || {};
          const html = buildShopDrawingHtml({
            projectName: projRes2.data?.name || "Rebar Takeoff",
            clientName: projRes2.data?.client_name || "",
            barList: canon.quote.bar_list as any[],
            sizeBreakdown: sizeBreak,
          });
          const blob = new Blob([html], { type: "text/html" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url; a.download = `shop-drawing-${projectId.slice(0, 8)}.html`; a.click();
          window.open(url, "_blank");
          opened = true;
        } else {
          const { data } = await supabase.from("shop_drawings")
            .select("html_content")
            .eq("project_id", projectId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (data?.html_content) {
            const blob = new Blob([data.html_content], { type: "text/html" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = `shop-drawing-${projectId.slice(0, 8)}.html`; a.click();
            window.open(url, "_blank");
            opened = true;
          }
        }
        if (!opened) {
          toast.error("No shop drawing data in canonical snapshot — add bar items or run chat estimate first.");
          return;
        }
        try {
          await (supabase as any).from("export_jobs").insert({
            project_id: projectId,
            user_id: user.id,
            verified_estimate_result_id: ver.id,
            export_type: "shop_drawing_html",
            status: "completed",
            metadata: {},
          });
        } catch { /* export_jobs optional */ }
        await logAuditEvent(user.id, "exported", "export", undefined, projectId, undefined, { export_type: "shop_drawing_html" });
        toast.success("Shop drawing downloaded — use Ctrl+P / Cmd+P to save as PDF");
      } else if (type === "estimate") {
        let ver = await getCurrentVerifiedEstimate(supabase, projectId);
        if (!ver) {
          await refreshVerifiedEstimateFromWorkspace(supabase, projectId, user.id);
          ver = await getCurrentVerifiedEstimate(supabase, projectId);
        }
        if (!ver || ver.status === "blocked") {
          const br = Array.isArray(ver?.blocked_reasons)
            ? (ver!.blocked_reasons as string[]).join(" ")
            : "Use Refresh canonical estimate or complete the chat pipeline.";
          toast.error(br || "Export blocked — canonical estimate not verified.");
          return;
        }
        const result = ver.result_json as { quote?: Record<string, unknown> };
        if (!result?.quote) {
          toast.error("Canonical snapshot has no quote payload.");
          return;
        }
        const projRes = await supabase.from("projects").select("name, client_name, address, deviations").eq("id", projectId).single();
        const proj = projRes.data;
        const scopeData = {
          projectName: proj?.name || "Rebar Takeoff",
          clientName: proj?.client_name || "",
          address: proj?.address || "",
          deviations: proj?.deviations || "None noted",
        };
        const quoteResult = { quote: result.quote, elements: [] as any[] };
        await exportExcelFile({ quoteResult, elements: [], scopeData });
        try {
          await (supabase as any).from("export_jobs").insert({
            project_id: projectId,
            user_id: user.id,
            verified_estimate_result_id: ver.id,
            export_type: "estimate_xlsx",
            status: "completed",
            metadata: {},
          });
        } catch { /* optional table */ }
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

  const handleAiVisualDraft = async () => {
    if (!user) return;
    setAiDrafting(true);
    const toastId = toast.loading("Drafting visual sheets with AI…");
    try {
      let ver = await getCurrentVerifiedEstimate(supabase, projectId);
      if (!ver) {
        await refreshVerifiedEstimateFromWorkspace(supabase, projectId, user.id);
        ver = await getCurrentVerifiedEstimate(supabase, projectId);
      }
      if (!ver || ver.status === "blocked") {
        const br = Array.isArray(ver?.blocked_reasons)
          ? (ver!.blocked_reasons as string[]).join(" ")
          : "Refresh canonical estimate or fix validation issues.";
        toast.error(br || "Export blocked — canonical estimate not verified.", { id: toastId });
        return;
      }

      const { data, error } = await supabase.functions.invoke("draft-shop-drawing-ai", {
        body: { projectId },
      });
      if (error) {
        toast.error(error.message || "AI draft failed", { id: toastId });
        return;
      }
      const payload = data as {
        project_name: string;
        client_name: string;
        results: Array<{ segment_id: string; segment_name: string; image_data_uri: string | null; caption: string; error?: string }>;
      };
      const usable = (payload.results || []).filter((r) => r.image_data_uri);
      if (usable.length === 0) {
        toast.error("AI returned no images. Try again or check segments/bar items.", { id: toastId });
        return;
      }

      const esc = (s: string) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
      const sheets = usable.map((r, i) => `
        <section class="sheet">
          <header class="title">
            <div>
              <div class="proj">${esc(payload.project_name)}</div>
              <div class="client">${esc(payload.client_name)}</div>
            </div>
            <div class="sheet-no">SD-AI-${String(i + 1).padStart(2, "0")}</div>
          </header>
          <h2>${esc(r.segment_name)}</h2>
          <img src="${r.image_data_uri}" alt="${esc(r.caption)}" />
          <p class="caption">${esc(r.caption)}</p>
          <footer>AI visual draft — not for fabrication. Verify against deterministic shop drawing &amp; bar list.</footer>
        </section>`).join("\n");

      const html = `<!doctype html><html><head><meta charset="utf-8" />
        <title>AI Visual Draft — ${esc(payload.project_name)}</title>
        <style>
          @page { size: letter landscape; margin: 12mm; }
          body { font-family: Arial, sans-serif; margin: 0; color: #111; }
          .sheet { page-break-after: always; padding: 16px; border: 1px solid #222; margin: 12px; }
          .sheet:last-child { page-break-after: auto; }
          .title { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #222; padding-bottom: 8px; }
          .proj { font-weight: 700; font-size: 16px; }
          .client { font-size: 12px; color: #555; }
          .sheet-no { font-weight: 700; font-size: 14px; }
          h2 { font-size: 14px; margin: 10px 0 8px; }
          img { max-width: 100%; max-height: 70vh; border: 1px solid #ccc; display: block; margin: 0 auto; }
          .caption { font-size: 11px; color: #444; margin-top: 6px; text-align: center; }
          footer { margin-top: 8px; font-size: 10px; color: #888; border-top: 1px dashed #aaa; padding-top: 6px; }
        </style></head><body>${sheets}</body></html>`;

      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ai-visual-draft-${projectId.slice(0, 8)}.html`;
      a.click();
      window.open(url, "_blank");

      try {
        await supabase.from("shop_drawings").insert({
          project_id: projectId,
          user_id: user.id,
          html_content: html,
          options: { kind: "ai_visual", segment_count: usable.length, model: "google/gemini-3.1-flash-image-preview" },
        });
      } catch { /* non-fatal */ }

      try {
        await (supabase as any).from("export_jobs").insert({
          project_id: projectId,
          user_id: user.id,
          verified_estimate_result_id: ver.id,
          export_type: "shop_drawing_ai_visual",
          status: "completed",
          metadata: { segment_count: usable.length },
        });
      } catch { /* optional */ }

      await logAuditEvent(user.id, "exported", "export", undefined, projectId, undefined, {
        export_type: "shop_drawing_ai_visual",
        segment_count: usable.length,
      });
      toast.success(`AI visual draft generated (${usable.length} sheet${usable.length === 1 ? "" : "s"})`, { id: toastId });
    } catch (e: any) {
      toast.error(e?.message || "AI draft failed", { id: toastId });
    } finally {
      setAiDrafting(false);
    }
  };

  const verifiedBlocked = verifiedRow?.status === "blocked";
  const blockedList = Array.isArray(verifiedRow?.blocked_reasons)
    ? (verifiedRow!.blocked_reasons as string[])
    : [];

  return (
    <div className="p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold text-foreground">Outputs & Exports</h3>
        <Button variant="outline" size="sm" className="text-xs h-8" disabled={refreshingCanonical} onClick={refreshCanonical}>
          {refreshingCanonical ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
          Refresh canonical estimate
        </Button>
      </div>

      {verifiedBlocked && blockedList.length > 0 && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/25 text-destructive text-xs space-y-1">
          <p className="font-semibold">Export blocked (canonical verification)</p>
          <ul className="list-disc pl-4">
            {blockedList.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}

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
              <div className="flex items-center gap-2">
                {o.type === "shop_drawing" && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!o.available || aiDrafting}
                    className="text-xs h-8"
                    onClick={handleAiVisualDraft}
                    title="Generate AI visual sketches with Nano Banana 2"
                  >
                    {aiDrafting
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                      : <Sparkles className="h-3.5 w-3.5 mr-1" />}
                    AI Visual
                  </Button>
                )}
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
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
