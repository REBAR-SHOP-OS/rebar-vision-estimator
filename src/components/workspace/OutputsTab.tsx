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
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { getLogoDataUri } from "@/lib/logo-base64";
import { validateDrawingMetadata, normalizeProjectName, type DrawingMode } from "@/lib/shop-drawing/validate-metadata";
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
  // Extract <style> blocks and body contents from the full HTML string so they
  // survive being mounted into a <div> (innerHTML drops <html>/<head>/<body>).
  const styleMatches = Array.from(html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi))
    .map((m) => m[1])
    .join("\n");
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyHtml = bodyMatch ? bodyMatch[1] : html;

  // Read the sheet size encoded by the caller via data-* attrs on the body wrapper
  // (e.g. <body data-sheet-w="18" data-sheet-h="24" data-sheet-orient="landscape">).
  // Falls back to ARCH C landscape (24x18) for AI Candidate / Review Draft.
  const sheetMatch = html.match(/<body([^>]*)>/i);
  const sheetAttrs = sheetMatch ? sheetMatch[1] : "";
  const sheetW = parseFloat((sheetAttrs.match(/data-sheet-w="([\d.]+)"/) || [])[1] || "24");
  const sheetH = parseFloat((sheetAttrs.match(/data-sheet-h="([\d.]+)"/) || [])[1] || "18");
  const sheetOrient = ((sheetAttrs.match(/data-sheet-orient="([a-z]+)"/) || [])[1] || "landscape") as
    | "landscape"
    | "portrait";

  // Keep the render tree live but move it far off-canvas.
  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.top = "0";
  container.style.left = "0";
  container.style.transform = "translateX(-200vw)";
  // Match container width to the chosen sheet so html2canvas captures at true sheet aspect.
  container.style.width = `${sheetW}in`;
  container.style.background = "#ffffff";
  container.style.color = "#111";
  container.style.padding = "0";
  container.style.margin = "0";
  container.style.zIndex = "-1";
  container.style.overflow = "visible";
  if (styleMatches) {
    const styleEl = document.createElement("style");
    styleEl.textContent = styleMatches;
    container.appendChild(styleEl);
  }
  const bodyWrap = document.createElement("div");
  bodyWrap.innerHTML = bodyHtml;
  container.appendChild(bodyWrap);
  document.body.appendChild(container);

  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

  if (document.fonts?.ready) {
    await document.fonts.ready.catch(() => undefined);
  }

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
    const pages = Array.from(container.querySelectorAll<HTMLElement>(".sheet"));
    const targets = pages.length > 0 ? pages : [bodyWrap];
    // Build PDF at the real drawing-sheet size, NOT letter. No shrink-to-page.
    const pdf = new jsPDF({
      unit: "in",
      format: [sheetW, sheetH],
      orientation: sheetOrient,
    });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    // Zero PDF margin: the HTML sheet already reserves its own header / footer / legend zones.
    const usableWidth = pageWidth;
    const usableHeight = pageHeight;

    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      const canvas = await html2canvas(target, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: "#ffffff",
        logging: false,
        width: Math.max(target.scrollWidth, target.offsetWidth),
        height: Math.max(target.scrollHeight, target.offsetHeight),
        windowWidth: Math.max(target.scrollWidth, target.offsetWidth),
        windowHeight: Math.max(target.scrollHeight, target.offsetHeight),
      });

      const imgData = canvas.toDataURL("image/jpeg", 0.98);
      // Render the captured sheet at FULL sheet size — never shrink. The HTML
      // template is responsible for splitting content across .sheet sections
      // when it would otherwise overflow the readable viewport.
      const imgWidth = usableWidth;
      const imgHeight = usableHeight;
      const x = 0;
      const y = 0;

      if (index > 0) pdf.addPage();
      pdf.addImage(imgData, "JPEG", x, y, imgWidth, imgHeight);
    }

    pdf.save(filename);
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
    // Auto-correct known drafting typos in project / client name BEFORE we
    // hand the strings to the AI prompt or render them in the wrapper HTML.
    const projFix = normalizeProjectName(projGate.data?.name);
    const clientFix = normalizeProjectName(projGate.data?.client_name);
    const safeProjectName = projFix.normalized;
    const safeClientName = clientFix.normalized;
    const gate = validateDrawingMetadata(
      {
        projectName: safeProjectName,
        clientName: safeClientName,
        sheetNumber: "AI-CANDIDATE-01",
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
      const generatedAt = new Date().toISOString().slice(0, 10);
      const confidencePct = typeof ver.result_json === "object" && ver.result_json && "confidence" in (ver.result_json as any)
        ? Math.round(Number((ver.result_json as any).confidence ?? 0) * 100)
        : null;
      const sourceLabel = `Verified Estimate v${ver.version_number ?? "?"}`;
      // ──────────────────────────────────────────────────────────────────
      // Real drawing-sheet sizing — ARCH C 24"x18" landscape.
      // Reserved zones (in inches): header 1.0  |  drawable 14.6  |  legend 1.4  |  footer 0.5  (right title strip 2.5)
      // No shrink-to-fit. One AI image per sheet. Layout engine splits to a
      // new sheet automatically because each result is its own <section.sheet>.
      // ──────────────────────────────────────────────────────────────────
      const SHEET_W_IN = 24;
      const SHEET_H_IN = 18;
      const sheets = usable.map((r, i) => `
        <section class="sheet">
          <div class="watermark">AI VISUAL DRAFT — NOT FOR FABRICATION</div>
          <div class="watermark watermark-sub">CANDIDATE — NO FORMAL REVISION</div>
          <div class="corner-hatch"></div>
          <div class="frame">
            <header class="zone-header">
              <div class="title-left">
                ${logoDataUri ? `<img class="brand" src="${logoDataUri}" alt="REBAR.SHOP" />` : ""}
                <div>
                  <div class="proj">${esc(safeProjectName || payload.project_name)}</div>
                  <div class="client">${esc(safeClientName || payload.client_name)}</div>
                  <div class="seg">SEGMENT: ${esc(r.segment_name)}</div>
                </div>
              </div>
              <div class="ai-pill-wrap"><div class="ai-pill">UNVERIFIED — AI CANDIDATE</div></div>
            </header>
            <main class="zone-drawable">
              <img class="sheet-image" src="${r.image_data_uri}" alt="${esc(r.caption)}" />
              <div class="unverified-band">All callouts, bar marks, and dimensions in this image are AI-generated and unverified. Sketch only — not measured, not to scale.</div>
            </main>
            <footer class="zone-footer">
              <div class="footer-legend">
                <div class="legend-title">LEGEND</div>
                <div class="legend-grid">
                  <div class="legend-row"><span class="sw sw-cand"></span>Candidate #n</div>
                  <div class="legend-row"><span class="sw sw-ai"></span>AI Note</div>
                  <div class="legend-row"><span class="sw sw-unv"></span>Unverified mark</div>
                  <div class="legend-row"><span class="sw sw-src"></span>Source ref</div>
                </div>
              </div>
              <div class="footer-warn">Marks, quantities, and changes shown are AI suggestions. None are tied to a controlled revision. Use Review Draft for reviewer workflow, Issued for fabrication.</div>
            </footer>
            <div class="title-strip">
              <div class="ts-pill">UNVERIFIED · AI CANDIDATE</div>
              <div class="ts-cell"><div class="ts-lbl">SHEET</div><div class="ts-val">AI-CANDIDATE-${String(i + 1).padStart(2, "0")}</div></div>
              <div class="ts-cell"><div class="ts-lbl">SHEET SIZE</div><div class="ts-val">ARCH C · 24×18</div></div>
              <div class="ts-cell"><div class="ts-lbl">SCALE</div><div class="ts-val">Schematic — N.T.S.</div></div>
              <div class="ts-cell"><div class="ts-lbl">GENERATED</div><div class="ts-val">${esc(generatedAt)}</div></div>
              <div class="ts-cell"><div class="ts-lbl">SOURCE</div><div class="ts-val">${esc(sourceLabel)}</div></div>
              <div class="ts-cell"><div class="ts-lbl">CONFIDENCE</div><div class="ts-val">${confidencePct !== null ? confidencePct + "%" : "Pending"}</div></div>
              <div class="ts-cell"><div class="ts-lbl">DETERMINISTIC MATCH</div><div class="ts-val ts-warn">Pending</div></div>
              <div class="ts-cell"><div class="ts-lbl">REVIEW STATUS</div><div class="ts-val ts-warn">Unreviewed</div></div>
              <div class="ts-cell"><div class="ts-lbl">PENDING</div><div class="ts-val">Awaiting reviewer</div></div>
              <div class="ts-cell ts-cap"><div class="ts-lbl">CAPTION</div><div class="ts-val ts-cap-val">${esc(r.caption)}</div></div>
            </div>
          </div>
        </section>`).join("\n");

      const html = `<!doctype html><html><head><meta charset="utf-8" />
        <title>AI Visual Draft — ${esc(safeProjectName || payload.project_name)}</title>
        <style>
          /* Real drawing sheet: ARCH C 24x18 landscape, no shrink-to-fit. */
          @page { size: ${SHEET_W_IN}in ${SHEET_H_IN}in; margin: 0; }
          html, body { margin: 0; padding: 0; background: #fff; color: #111; }
          body { font-family: "Helvetica Neue", Arial, sans-serif; }
          .sheet { position: relative; width: ${SHEET_W_IN}in; height: ${SHEET_H_IN}in; background: #fff; page-break-after: always; overflow: hidden; box-sizing: border-box; }
          .sheet:last-child { page-break-after: auto; }

          /* Watermarks — full-sheet, behind content */
          .watermark { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); font-size: 110px; font-weight: 900; color: #d97706; opacity: 0.10; pointer-events: none; white-space: nowrap; letter-spacing: 8px; z-index: 0; }
          .watermark-sub { font-size: 46px; opacity: 0.09; transform: translate(-50%, calc(-50% + 130px)) rotate(-30deg); letter-spacing: 12px; }
          .corner-hatch { position: absolute; top: 0; right: 0; width: 1.4in; height: 1.4in; background: repeating-linear-gradient(135deg, #d97706 0 8px, transparent 8px 16px); opacity: 0.30; pointer-events: none; z-index: 0; }

          /* Drawing frame: 0.4in margin from sheet edge, dashed amber outer + solid amber inner */
          .frame {
            position: absolute; inset: 0.4in; box-sizing: border-box;
            border: 4px dashed #d97706;
            display: grid;
            /* columns: main drawing area | right title strip */
            grid-template-columns: 1fr 2.5in;
            /* rows: header | drawable | legend | footer */
            grid-template-rows: 1.0in 1fr 1.4in 0.5in;
            grid-template-areas:
              "header   title"
              "drawable title"
              "legend   title"
              "footer   title";
            background: #fff;
          }

          .zone-header { grid-area: header; border-bottom: 2px solid #d97706; padding: 0.15in 0.25in; display: flex; justify-content: space-between; align-items: center; gap: 0.3in; background: #fffbeb; position: relative; z-index: 1; }
          .title-left { display: flex; align-items: center; gap: 0.2in; }
          .brand { max-height: 0.7in; max-width: 1.6in; object-fit: contain; display: block; }
          .proj { font-weight: 700; font-size: 22px; letter-spacing: 0.3px; }
          .client { font-size: 14px; color: #555; }
          .seg { font-size: 13px; color: #92400e; font-weight: 700; margin-top: 2px; letter-spacing: 0.5px; }
          .ai-pill { background: #b91c1c; color: #fff; font-weight: 800; font-size: 16px; letter-spacing: 1.5px; padding: 8px 18px; border-radius: 4px; box-shadow: 0 0 0 3px #fff, 0 0 0 5px #b91c1c; }

          .zone-drawable { grid-area: drawable; position: relative; padding: 0.2in; background:
            radial-gradient(circle, #ddd 0.5px, transparent 0.5px) 0 0 / 0.5in 0.5in,
            #fff;
            display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: hidden; z-index: 1;
          }
          /* Image fits the drawable viewport at intrinsic readable size — no shrink past the unverified band. */
          .sheet-image { display: block; max-width: 100%; max-height: calc(100% - 0.6in); object-fit: contain; border: 1px dashed #d97706; background: #fff; }
          .unverified-band { width: 100%; margin-top: 0.15in; padding: 0.08in 0.15in; background: #fef3c7; border: 1.5px solid #d97706; color: #7c2d12; font-size: 12px; font-weight: 700; text-align: center; letter-spacing: 0.4px; box-sizing: border-box; }

          .zone-legend { grid-area: legend; border-top: 1.5px solid #d97706; padding: 0.12in 0.25in; background: #fffbeb; font-size: 11px; color: #111; display: grid; grid-template-columns: repeat(2, 1fr); column-gap: 0.4in; row-gap: 4px; align-content: start; position: relative; z-index: 1; }
          .legend-title { grid-column: 1 / -1; font-weight: 800; font-size: 12px; letter-spacing: 1px; color: #92400e; margin-bottom: 4px; }
          .legend-row { display: flex; align-items: center; gap: 8px; }
          .sw { display: inline-block; width: 14px; height: 10px; border: 1px solid #111; }
          .sw-cand { background: #fde68a; border-color: #d97706; }
          .sw-ai { background: #fff; border: 1.5px dashed #b91c1c; }
          .sw-unv { background: repeating-linear-gradient(45deg, #fff 0 3px, #fca5a5 3px 6px); border-color: #b91c1c; }
          .sw-src { background: #dbeafe; border-color: #1e40af; }
          .legend-note { grid-column: 1 / -1; margin-top: 4px; font-size: 10px; color: #92400e; font-style: italic; }

          .zone-footer { grid-area: footer; border-top: 2px solid #d97706; padding: 0.1in 0.25in; background: #fffbeb; font-size: 11px; color: #7c2d12; font-weight: 600; display: flex; align-items: center; position: relative; z-index: 1; }

          /* Right-edge vertical title strip — ARCH-style */
          .title-strip { grid-area: title; border-left: 2px solid #d97706; background: #fff; display: flex; flex-direction: column; padding: 0.15in; gap: 0.08in; position: relative; z-index: 1; }
          .ts-pill { background: #b91c1c; color: #fff; font-weight: 800; font-size: 11px; letter-spacing: 1px; padding: 6px 8px; text-align: center; border-radius: 3px; margin-bottom: 0.1in; }
          .ts-cell { border: 1px solid #d97706; padding: 5px 8px; background: #fff7ed; }
          .ts-cell.ts-cap { flex: 1; display: flex; flex-direction: column; }
          .ts-lbl { font-size: 8px; color: #92400e; letter-spacing: 0.6px; font-weight: 800; }
          .ts-val { font-size: 12px; font-weight: 700; font-family: ui-monospace, "Consolas", monospace; color: #111; margin-top: 2px; }
          .ts-warn { color: #b91c1c; }
          .ts-cap-val { font-size: 10px; font-family: "Helvetica Neue", Arial, sans-serif; font-weight: 500; color: #444; line-height: 1.3; flex: 1; overflow: hidden; }
        </style></head><body data-sheet-w="${SHEET_W_IN}" data-sheet-h="${SHEET_H_IN}" data-sheet-orient="landscape">${sheets}</body></html>`;

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

  // ──────────────────────────────────────────────────────────────────
  // Phase 2 — Review Draft PDF
  // Same AI image source, but reframed for the reviewer workflow:
  //   • reviewer name + review date in the title strip
  //   • per-candidate Accept / Reject / Pending column with provenance
  //   • deterministic-match % computed from bar_items.deterministic_match
  //   • unresolved-issues count surfaced on every sheet
  //   • blue review banner (not amber draft) so it is visually distinct
  // No formal revision history — that stays gated behind Issued mode.
  // ──────────────────────────────────────────────────────────────────
  const handleReviewDraft = async () => {
    if (!user) return;
    const reviewerName = window.prompt("Reviewer name (required for Review Draft):", "")?.trim();
    if (!reviewerName) {
      toast.error("Reviewer name is required for Review Draft mode.");
      return;
    }
    const projGate = await supabase
      .from("projects")
      .select("name, client_name")
      .eq("id", projectId)
      .maybeSingle();
    const safeProjectName = normalizeProjectName(projGate.data?.name).normalized;
    const safeClientName = normalizeProjectName(projGate.data?.client_name).normalized;
    const gate = validateDrawingMetadata(
      {
        projectName: safeProjectName,
        clientName: safeClientName,
        sheetNumber: "REVIEW-01",
        scale: "N/A (review draft)",
        reviewerName,
      },
      "review_draft" as DrawingMode,
    );
    if (!gate.ok) {
      const first = gate.issues.filter((i) => i.severity === "error").slice(0, 3);
      toast.error(`Cannot generate: ${first.map((i) => i.message).join(" ")}`);
      return;
    }
    setAiDrafting(true);
    const toastId = toast.loading("Building Review Draft…");
    try {
      let ver = await getCurrentVerifiedEstimate(supabase, projectId);
      if (!ver) {
        await refreshVerifiedEstimateFromWorkspace(supabase, projectId, user.id);
        ver = await getCurrentVerifiedEstimate(supabase, projectId);
      }
      if (!ver || ver.status === "blocked") {
        toast.error("Export blocked — canonical estimate not verified.", { id: toastId });
        return;
      }

      // Pull deterministic-match telemetry from bar_items (provenance per row).
      const segRes = await supabase.from("segments").select("id").eq("project_id", projectId);
      const segIds = (segRes.data || []).map((s: any) => s.id);
      let matchPct = 0;
      let totalBars = 0;
      let matchedBars = 0;
      if (segIds.length > 0) {
        const barRes = await supabase
          .from("bar_items")
          .select("deterministic_match")
          .in("segment_id", segIds);
        const rows = (barRes.data || []) as Array<{ deterministic_match: boolean }>;
        totalBars = rows.length;
        matchedBars = rows.filter((r) => r.deterministic_match).length;
        matchPct = totalBars > 0 ? Math.round((matchedBars / totalBars) * 100) : 0;
      }

      const issuesRes = await supabase
        .from("validation_issues")
        .select("id", { count: "exact" })
        .eq("project_id", projectId)
        .eq("status", "open");
      const openIssueCount = issuesRes.count || 0;

      const { data, error } = await supabase.functions.invoke("draft-shop-drawing-ai", {
        body: { projectId, provider: "openai" },
      });
      if (error) {
        toast.error(error.message || "Review draft failed", { id: toastId });
        return;
      }
      const payload = data as {
        project_name: string;
        client_name: string;
        results: Array<{ segment_id: string; segment_name: string; image_data_uri: string | null; caption: string }>;
      };
      const usable = (payload.results || []).filter((r) => r.image_data_uri);
      if (usable.length === 0) {
        toast.error("AI returned no images. Try again.", { id: toastId });
        return;
      }

      const esc = (s: string) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
      const logoDataUri = await getLogoDataUri().catch(() => "");
      const reviewDate = new Date().toISOString().slice(0, 10);
      const sourceLabel = `Verified Estimate v${ver.version_number ?? "?"}`;
      const SHEET_W_IN = 24;
      const SHEET_H_IN = 18;

      const sheets = usable.map((r, i) => `
        <section class="sheet">
          <div class="watermark">REVIEW DRAFT — NOT FOR FABRICATION</div>
          <div class="frame">
            <header class="zone-header">
              <div class="title-left">
                ${logoDataUri ? `<img class="brand" src="${logoDataUri}" alt="REBAR.SHOP" />` : ""}
                <div>
                  <div class="proj">${esc(safeProjectName || payload.project_name)}</div>
                  <div class="client">${esc(safeClientName || payload.client_name)}</div>
                  <div class="seg">SEGMENT: ${esc(r.segment_name)}</div>
                </div>
              </div>
              <div class="ai-pill-wrap"><div class="rev-pill">REVIEW DRAFT — REVIEWER WORKFLOW</div></div>
            </header>
            <main class="zone-drawable">
              <img class="sheet-image" src="${r.image_data_uri}" alt="${esc(r.caption)}" />
              <div class="review-band">
                Reviewer: <strong>${esc(reviewerName)}</strong> · Date: <strong>${reviewDate}</strong> ·
                Compared against: <strong>${esc(sourceLabel)}</strong> · Deterministic match:
                <strong>${matchPct}%</strong> (${matchedBars}/${totalBars} bars) · Open issues:
                <strong>${openIssueCount}</strong>
              </div>
            </main>
            <aside class="zone-legend">
              <div class="legend-title">CANDIDATE NOTE STATUS</div>
              <div class="legend-row"><span class="sw sw-pend"></span>Pending — needs reviewer decision</div>
              <div class="legend-row"><span class="sw sw-acc"></span>Accepted — promote to issued</div>
              <div class="legend-row"><span class="sw sw-rej"></span>Rejected — discard candidate</div>
              <div class="legend-row"><span class="sw sw-det"></span>Deterministic match available</div>
              <div class="legend-note">Formal revision history is only assigned in Issued mode.</div>
            </aside>
            <footer class="zone-footer">
              Reviewer must mark every Candidate # note as Accepted, Rejected, or Deferred before this segment can advance to Issued.
            </footer>
            <div class="title-strip">
              <div class="rev-pill ts-pill-rev">REVIEW DRAFT</div>
              <div class="ts-cell"><div class="ts-lbl">SHEET</div><div class="ts-val">REVIEW-${String(i + 1).padStart(2, "0")}</div></div>
              <div class="ts-cell"><div class="ts-lbl">SHEET SIZE</div><div class="ts-val">ARCH C · 24×18</div></div>
              <div class="ts-cell"><div class="ts-lbl">REVIEWED BY</div><div class="ts-val">${esc(reviewerName)}</div></div>
              <div class="ts-cell"><div class="ts-lbl">REVIEW DATE</div><div class="ts-val">${reviewDate}</div></div>
              <div class="ts-cell"><div class="ts-lbl">SOURCE</div><div class="ts-val">${esc(sourceLabel)}</div></div>
              <div class="ts-cell"><div class="ts-lbl">DETERMINISTIC MATCH</div><div class="ts-val ${matchPct >= 80 ? "ts-ok" : "ts-warn"}">${matchPct}% (${matchedBars}/${totalBars})</div></div>
              <div class="ts-cell"><div class="ts-lbl">OPEN ISSUES</div><div class="ts-val ${openIssueCount === 0 ? "ts-ok" : "ts-warn"}">${openIssueCount}</div></div>
              <div class="ts-cell ts-cap"><div class="ts-lbl">CAPTION</div><div class="ts-val ts-cap-val">${esc(r.caption)}</div></div>
            </div>
          </div>
        </section>`).join("\n");

      const html = `<!doctype html><html><head><meta charset="utf-8" />
        <title>Review Draft — ${esc(safeProjectName || payload.project_name)}</title>
        <style>
          @page { size: ${SHEET_W_IN}in ${SHEET_H_IN}in; margin: 0; }
          html, body { margin: 0; padding: 0; background: #fff; color: #111; font-family: "Helvetica Neue", Arial, sans-serif; }
          .sheet { position: relative; width: ${SHEET_W_IN}in; height: ${SHEET_H_IN}in; background: #fff; page-break-after: always; overflow: hidden; box-sizing: border-box; }
          .sheet:last-child { page-break-after: auto; }
          .watermark { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); font-size: 100px; font-weight: 900; color: #1d4ed8; opacity: 0.08; pointer-events: none; white-space: nowrap; letter-spacing: 8px; z-index: 0; }
          .frame { position: absolute; inset: 0.4in; box-sizing: border-box; border: 4px solid #1d4ed8; display: grid; grid-template-columns: 1fr 2.5in; grid-template-rows: 1.0in 1fr 1.4in 0.5in; grid-template-areas: "header title" "drawable title" "legend title" "footer title"; background: #fff; }
          .zone-header { grid-area: header; border-bottom: 2px solid #1d4ed8; padding: 0.15in 0.25in; display: flex; justify-content: space-between; align-items: center; gap: 0.3in; background: #eff6ff; position: relative; z-index: 1; }
          .title-left { display: flex; align-items: center; gap: 0.2in; }
          .brand { max-height: 0.7in; max-width: 1.6in; object-fit: contain; display: block; }
          .proj { font-weight: 700; font-size: 22px; }
          .client { font-size: 14px; color: #555; }
          .seg { font-size: 13px; color: #1e3a8a; font-weight: 700; margin-top: 2px; letter-spacing: 0.5px; }
          .rev-pill { background: #1d4ed8; color: #fff; font-weight: 800; font-size: 14px; letter-spacing: 1.5px; padding: 8px 18px; border-radius: 4px; }
          .zone-drawable { grid-area: drawable; position: relative; padding: 0.2in; display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: hidden; z-index: 1; background: #fff; }
          .sheet-image { display: block; max-width: 100%; max-height: calc(100% - 0.8in); object-fit: contain; border: 1px solid #1d4ed8; background: #fff; }
          .review-band { width: 100%; margin-top: 0.15in; padding: 0.1in 0.2in; background: #dbeafe; border: 1.5px solid #1d4ed8; color: #1e3a8a; font-size: 12px; text-align: center; box-sizing: border-box; }
          .zone-legend { grid-area: legend; border-top: 1.5px solid #1d4ed8; padding: 0.12in 0.25in; background: #eff6ff; font-size: 11px; color: #111; display: grid; grid-template-columns: repeat(2, 1fr); column-gap: 0.4in; row-gap: 4px; align-content: start; z-index: 1; }
          .legend-title { grid-column: 1 / -1; font-weight: 800; font-size: 12px; letter-spacing: 1px; color: #1e3a8a; margin-bottom: 4px; }
          .legend-row { display: flex; align-items: center; gap: 8px; }
          .sw { display: inline-block; width: 14px; height: 10px; border: 1px solid #111; }
          .sw-pend { background: #fde68a; border-color: #d97706; }
          .sw-acc { background: #bbf7d0; border-color: #15803d; }
          .sw-rej { background: #fecaca; border-color: #b91c1c; }
          .sw-det { background: #dbeafe; border-color: #1d4ed8; }
          .legend-note { grid-column: 1 / -1; margin-top: 4px; font-size: 10px; color: #1e3a8a; font-style: italic; }
          .zone-footer { grid-area: footer; border-top: 2px solid #1d4ed8; padding: 0.1in 0.25in; background: #eff6ff; font-size: 11px; color: #1e3a8a; font-weight: 600; display: flex; align-items: center; z-index: 1; }
          .title-strip { grid-area: title; border-left: 2px solid #1d4ed8; background: #fff; display: flex; flex-direction: column; padding: 0.15in; gap: 0.08in; z-index: 1; }
          .ts-pill-rev { font-size: 11px; padding: 6px 8px; text-align: center; margin-bottom: 0.1in; }
          .ts-cell { border: 1px solid #1d4ed8; padding: 5px 8px; background: #eff6ff; }
          .ts-cell.ts-cap { flex: 1; display: flex; flex-direction: column; }
          .ts-lbl { font-size: 8px; color: #1e3a8a; letter-spacing: 0.6px; font-weight: 800; }
          .ts-val { font-size: 12px; font-weight: 700; font-family: ui-monospace, "Consolas", monospace; color: #111; margin-top: 2px; }
          .ts-warn { color: #b91c1c; }
          .ts-ok { color: #15803d; }
          .ts-cap-val { font-size: 10px; font-family: "Helvetica Neue", Arial, sans-serif; font-weight: 500; color: #444; line-height: 1.3; flex: 1; overflow: hidden; }
        </style></head><body data-sheet-w="${SHEET_W_IN}" data-sheet-h="${SHEET_H_IN}" data-sheet-orient="landscape">${sheets}</body></html>`;

      await renderHtmlToPdf(html, `review-draft-${projectId.slice(0, 8)}.pdf`);

      try {
        await supabase.from("shop_drawings").insert({
          project_id: projectId,
          user_id: user.id,
          html_content: html,
          options: { kind: "review_draft", reviewer: reviewerName, deterministic_match_pct: matchPct, open_issues: openIssueCount },
          drawing_mode: "review_draft",
          export_class: "review_draft_pdf",
          watermark_mode: "review_draft",
          validation_state: { ok: true, issues: [], reviewer: reviewerName, match_pct: matchPct },
        });
      } catch { /* non-fatal */ }

      await logAuditEvent(user.id, "exported", "export", undefined, projectId, undefined, {
        export_type: "shop_drawing_review_draft",
        reviewer: reviewerName,
        deterministic_match_pct: matchPct,
        open_issues: openIssueCount,
        segment_count: usable.length,
      });
      toast.success(`Review draft generated (${usable.length} sheet${usable.length === 1 ? "" : "s"})`, { id: toastId });
    } catch (e: any) {
      toast.error(e?.message || "Review draft failed", { id: toastId });
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
                        onClick={handleReviewDraft}
                        disabled={aiDrafting}
                        className="text-xs"
                        title="Reviewer workflow — adds deterministic match %, reviewer name, open-issue count"
                      >
                        <Clock className="h-3.5 w-3.5 mr-2 text-primary" />
                        <div className="flex flex-col">
                          <span className="font-medium">Review Draft PDF</span>
                          <span className="text-[10px] text-muted-foreground">Reviewer workflow · deterministic match %</span>
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
