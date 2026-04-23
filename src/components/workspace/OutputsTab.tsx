import { useEffect, useState } from "react";
import { buildShopDrawingHtml } from "@/lib/shop-drawing-template";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Download, Loader2, ShieldAlert, CheckCircle2, Clock, Sparkles, ShieldCheck } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { logAuditEvent } from "@/lib/audit-logger";
import { exportExcelFile } from "@/lib/excel-export";
// @ts-ignore - no types
import html2pdf from "html2pdf.js";
import { getLogoDataUri } from "@/lib/logo-base64";
import { validateDrawingMetadata, type DrawingMode } from "@/lib/shop-drawing/validate-metadata";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  getCurrentVerifiedEstimate,
  refreshVerifiedEstimateFromWorkspace,
  commitAllLinesForExport,
} from "@/lib/verified-estimate/verified-estimate-store";

interface OutputItem {
  type: string;
  label: string;
  available: boolean;
  count?: number;
}

async function renderHtmlToPdf(html: string, filename: string): Promise<void> {
  // Mount the HTML on-screen but visually hidden so html2canvas can measure it.
  // Offscreen positioning (left:-10000px) breaks layout for paginated content.
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.top = "0";
  container.style.left = "0";
  container.style.width = "11in";
  container.style.opacity = "0";
  container.style.pointerEvents = "none";
  container.style.zIndex = "-1";
  container.style.background = "#ffffff";
  container.innerHTML = html;
  document.body.appendChild(container);

  // Wait for any <img> inside to load so they appear in the canvas.
  const imgs = Array.from(container.querySelectorAll("img"));
  await Promise.all(
    imgs.map((img) =>
      img.complete && img.naturalWidth > 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          })
    )
  );

  try {
    await html2pdf()
      .set({
        margin: 0.4,
        filename,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
        jsPDF: { unit: "in", format: "letter", orientation: "landscape" },
        pagebreak: { mode: ["css", "legacy"], before: ".sheet" },
      })
      .from(container)
      .save();
  } finally {
    document.body.removeChild(container);
  }
}

export default function OutputsTab({ projectId, filter }: { projectId: string; filter?: "estimate" | "shop_drawings" }) {
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
  const [committing, setCommitting] = useState(false);
  const [confirmCommitOpen, setConfirmCommitOpen] = useState(false);

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

  const lineCount = Array.isArray((verifiedRow?.result_json as any)?.lines)
    ? ((verifiedRow!.result_json as any).lines as any[]).length
    : 0;
  const uncommittedCount = Array.isArray((verifiedRow?.result_json as any)?.lines)
    ? ((verifiedRow!.result_json as any).lines as any[]).filter((l) => l.review_required).length
    : 0;

  const handleCommitAll = async () => {
    if (!user) return;
    setCommitting(true);
    try {
      const { committed, gate } = await commitAllLinesForExport(supabase, projectId, user.id);
      const row = await getCurrentVerifiedEstimate(supabase, projectId);
      setVerifiedRow(row);
      await logAuditEvent(user.id, "lines_committed_for_export", "verified_estimate", row?.id, projectId, undefined, {
        committed_count: committed,
        can_export: gate.canExport,
      });
      if (gate.canExport) {
        toast.success(`Committed ${committed} line(s) — exports unlocked.`);
      } else {
        toast.warning(`Committed ${committed} line(s), but other gates still block export.`);
      }
    } catch (e: any) {
      toast.error(e?.message || "Could not commit lines.");
    } finally {
      setCommitting(false);
      setConfirmCommitOpen(false);
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
        let html: string | null = null;
        if (canon?.quote?.bar_list && canon.quote.bar_list.length > 0) {
          const sizeBreak = canon.quote.size_breakdown_kg || {};
          html = buildShopDrawingHtml({
            projectName: projRes2.data?.name || "Rebar Takeoff",
            clientName: projRes2.data?.client_name || "",
            barList: canon.quote.bar_list as any[],
            sizeBreakdown: sizeBreak,
          });
        } else {
          const { data } = await supabase.from("shop_drawings")
            .select("html_content")
            .eq("project_id", projectId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (data?.html_content) html = data.html_content;
        }
        if (!html) {
          toast.error("No shop drawing data in canonical snapshot — add bar items or run chat estimate first.");
          return;
        }
        await renderHtmlToPdf(html, `shop-drawing-${projectId.slice(0, 8)}.pdf`);
        try {
          await (supabase as any).from("export_jobs").insert({
            project_id: projectId,
            user_id: user.id,
            verified_estimate_result_id: ver.id,
            export_type: "shop_drawing_pdf",
            status: "completed",
            metadata: {},
          });
        } catch { /* export_jobs optional */ }
        await logAuditEvent(user.id, "exported", "export", undefined, projectId, undefined, { export_type: "shop_drawing_pdf" });
        toast.success("Shop drawing PDF downloaded");
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
    // Phase 1: trust-first metadata gate. AI Draft is the most permissive mode
    // but we still refuse to render if project name / sheet number / scale missing.
    const projGate = await supabase
      .from("projects")
      .select("name, client_name")
      .eq("id", projectId)
      .maybeSingle();
    const gate = validateDrawingMetadata(
      {
        projectName: projGate.data?.name,
        clientName: projGate.data?.client_name,
        sheetNumber: "SD-AI-01",
        scale: "N/A (visual draft)",
      },
      "ai_draft" as DrawingMode,
    );
    if (!gate.ok) {
      const first = gate.issues.filter((i) => i.severity === "error").slice(0, 3);
      toast.error(`Cannot generate: ${first.map((i) => i.message).join(" ")}`);
      // Persist for QA tab visibility
      try {
        await supabase.from("validation_issues").insert(
          first.map((i) => ({
            project_id: projectId,
            user_id: user.id,
            issue_type: "metadata_invalid",
            severity: "error",
            title: `Shop drawing metadata: ${i.field}`,
            description: i.message,
            status: "open",
          })),
        );
      } catch { /* non-fatal */ }
      return;
    }
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
        body: { projectId, provider: "openai" },
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
      const logoDataUri = await getLogoDataUri().catch(() => "");
      const sheets = usable.map((r, i) => `
        <section class="sheet">
          <div class="sheet-frame">
          <div class="watermark">AI VISUAL DRAFT — NOT FOR FABRICATION</div>
          <header class="title">
            <div class="title-left">
              ${logoDataUri ? `<img class="brand" src="${logoDataUri}" alt="REBAR.SHOP" />` : ""}
              <div>
              <div class="proj">${esc(payload.project_name)}</div>
              <div class="client">${esc(payload.client_name)}</div>
              </div>
            </div>
            <div class="sheet-no">
              <div class="lbl">DRAWING NO.</div>
              <div class="val">SD-AI-${String(i + 1).padStart(2, "0")}</div>
              <div class="ai-chip">AI CHANGE CANDIDATE</div>
            </div>
          </header>
          <h2>${esc(r.segment_name)}</h2>
          <img src="${r.image_data_uri}" alt="${esc(r.caption)}" />
          <p class="caption">${esc(r.caption)}</p>
          <footer>AI visual draft — not for fabrication. Verify against deterministic shop drawing &amp; bar list.</footer>
          </div>
        </section>`).join("\n");

      const html = `<!doctype html><html><head><meta charset="utf-8" />
        <title>AI Visual Draft — ${esc(payload.project_name)}</title>
        <style>
          @page { size: letter landscape; margin: 0.4in; }
          body { font-family: Arial, sans-serif; margin: 0; color: #111; }
          .sheet { page-break-after: always; margin: 0; padding: 6px; }
          .sheet:last-child { page-break-after: auto; }
          .sheet-frame { position: relative; border: 3px solid #d97706; outline: 1px solid #d97706; outline-offset: 4px; padding: 14px 16px; overflow: hidden; }
          .watermark { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); font-size: 72px; font-weight: 900; color: #d97706; opacity: 0.10; pointer-events: none; white-space: nowrap; letter-spacing: 4px; z-index: 0; }
          .title { position: relative; z-index: 1; display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #d97706; padding-bottom: 8px; gap: 16px; }
          .title-left { display: flex; align-items: center; gap: 12px; }
          .brand { max-height: 44px; max-width: 130px; object-fit: contain; display: block; }
          .proj { font-weight: 700; font-size: 15px; letter-spacing: 0.2px; }
          .client { font-size: 12px; color: #555; }
          .sheet-no { border: 1px solid #d97706; padding: 4px 10px; text-align: center; min-width: 130px; background: #fff7ed; }
          .sheet-no .lbl { font-size: 9px; color: #92400e; letter-spacing: 0.5px; }
          .sheet-no .val { font-weight: 700; font-size: 14px; font-family: ui-monospace, Menlo, monospace; }
          .ai-chip { margin-top: 4px; font-size: 8px; font-weight: 700; color: #92400e; background: #fde68a; padding: 2px 4px; border-radius: 2px; letter-spacing: 0.4px; }
          h2 { position: relative; z-index: 1; font-size: 14px; margin: 10px 0 8px; }
          .sheet img:not(.brand) { position: relative; z-index: 1; max-width: 100%; max-height: 6.4in; border: 1px solid #d97706; display: block; margin: 0 auto; }
          .caption { position: relative; z-index: 1; font-size: 11px; color: #444; margin-top: 6px; text-align: center; }
          footer { position: relative; z-index: 1; margin-top: 8px; font-size: 10px; color: #92400e; font-weight: 600; border-top: 2px solid #d97706; padding-top: 6px; background: #fffbeb; padding: 6px 8px; }
        </style></head><body>${sheets}</body></html>`;

      await renderHtmlToPdf(html, `ai-visual-draft-${projectId.slice(0, 8)}.pdf`);

      try {
        await supabase.from("shop_drawings").insert({
          project_id: projectId,
          user_id: user.id,
          html_content: html,
          options: { kind: "ai_visual", segment_count: usable.length, model: "google/gemini-3.1-flash-image-preview" },
          drawing_mode: "ai_draft",
          export_class: "ai_preview_pdf",
          watermark_mode: "ai_draft",
          validation_state: { ok: true, issues: [] },
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
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="text-xs h-8" disabled={refreshingCanonical} onClick={refreshCanonical}>
            {refreshingCanonical ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
            Refresh canonical estimate
          </Button>
          <Button
            variant="default"
            size="sm"
            className="text-xs h-8"
            disabled={committing || lineCount === 0 || uncommittedCount === 0}
            onClick={() => setConfirmCommitOpen(true)}
            title={
              lineCount === 0
                ? "Refresh canonical estimate first"
                : uncommittedCount === 0
                  ? "All lines already committed"
                  : `Mark all ${lineCount} line(s) as reviewed and ready for export`
            }
          >
            {committing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <ShieldCheck className="h-3.5 w-3.5 mr-1" />}
            Commit all lines for export
            {uncommittedCount > 0 && ` (${uncommittedCount})`}
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmCommitOpen} onOpenChange={setConfirmCommitOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Commit all lines for export?</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark all {lineCount} estimate line(s) in the current canonical snapshot as reviewed and
              ready for export. This action is audit-logged. You can re-run "Refresh canonical estimate" at any
              time to rebuild from workspace data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={committing}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleCommitAll} disabled={committing}>
              {committing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              Commit {lineCount} line(s)
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
        {outputs.filter((o) => {
          if (filter === "estimate") return o.type === "estimate" || o.type === "issues" || o.type === "quote";
          if (filter === "shop_drawings") return o.type === "shop_drawing";
          return true;
        }).map((o) => (
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
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!o.available || aiDrafting}
                        className="text-xs h-8"
                        title="Choose drawing render mode"
                      >
                        {aiDrafting
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                          : <Sparkles className="h-3.5 w-3.5 mr-1" />}
                        Render…
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64">
                      <DropdownMenuLabel className="text-[10px]">Trust-first export modes</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={handleAiVisualDraft} className="text-xs">
                        <Sparkles className="h-3.5 w-3.5 mr-2 text-[hsl(var(--status-review))]" />
                        <div className="flex flex-col">
                          <span className="font-medium">AI Preview PDF</span>
                          <span className="text-[10px] text-muted-foreground">Watermarked draft, not for fabrication</span>
                        </div>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled
                        className="text-xs opacity-60"
                        title="Phase 2 — requires deterministic model + reviewer assignment"
                      >
                        <Clock className="h-3.5 w-3.5 mr-2 text-primary" />
                        <div className="flex flex-col">
                          <span className="font-medium">Review Draft PDF</span>
                          <span className="text-[10px] text-muted-foreground">Coming in Phase 2</span>
                        </div>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={openIssues > 0 || !isApproved}
                        className="text-xs"
                        onClick={() => handleExport("shop_drawing")}
                        title={
                          openIssues > 0
                            ? `Blocked: ${openIssues} open issue(s)`
                            : !isApproved
                              ? "Blocked: requires approval"
                              : "Issue deterministic fabrication PDF"
                        }
                      >
                        <ShieldCheck className="h-3.5 w-3.5 mr-2 text-[hsl(var(--status-approved))]" />
                        <div className="flex flex-col">
                          <span className="font-medium">Fabrication PDF</span>
                          <span className="text-[10px] text-muted-foreground">
                            {openIssues > 0 || !isApproved ? "Resolve issues + approval first" : "Issued — ready for shop floor"}
                          </span>
                        </div>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
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
