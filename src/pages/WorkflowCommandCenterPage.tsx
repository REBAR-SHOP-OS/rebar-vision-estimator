import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Brain,
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Database,
  FileText,
  FolderOpen,
  GitBranch,
  Layers3,
  Loader2,
  MessageSquare,
  Radar,
  RefreshCw,
  Sparkles,
  Upload,
  type LucideIcon,
} from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ProjectRow = Database["public"]["Tables"]["projects"]["Row"];
type ProcessingJobRow = Database["public"]["Tables"]["processing_jobs"]["Row"];

interface EstimateSummaryRow {
  id: string;
  version_number: number;
  total_estimated_cost: number | null;
  confidence_score: number | null;
  status: string | null;
  created_at: string;
  currency: string | null;
}

interface QuoteSummaryRow {
  id: string;
  version_number: number;
  quoted_price: number | null;
  currency: string | null;
  status: string | null;
  created_at: string;
  issued_at: string | null;
}

interface ReviewShareSummaryRow {
  id: string;
  review_type: string | null;
  reviewer_name: string | null;
  reviewer_email: string;
  status: string;
  created_at: string;
  expires_at: string | null;
}

interface ReviewCommentSummaryRow {
  id: string;
  share_id: string;
  author_name: string;
  author_email: string;
  content: string;
  created_at: string;
}

interface CrmDealSummaryRow {
  id: string;
  crm_deal_id: string;
  deal_name: string | null;
  deal_value: number | null;
  stage: string | null;
  status: string | null;
  company_name: string | null;
  synced_at: string | null;
}

interface WorkflowSnapshot {
  project: ProjectRow | null;
  fileCount: number;
  drawingCount: number;
  estimates: EstimateSummaryRow[];
  quotes: QuoteSummaryRow[];
  shares: ReviewShareSummaryRow[];
  comments: ReviewCommentSummaryRow[];
  latestJob: ProcessingJobRow | null;
  deals: CrmDealSummaryRow[];
}

interface LayerMetric {
  label: string;
  value: string;
  hint: string;
}

interface WorkflowLayer {
  id: string;
  title: string;
  eyebrow: string;
  description: string;
  icon: LucideIcon;
  accentClass: string;
  signal: number;
  status: "ready" | "active" | "watch" | "blocked";
  statusLabel: string;
  metrics: LayerMetric[];
  bullets: string[];
  timeline: string[];
}

const emptySnapshot: WorkflowSnapshot = {
  project: null,
  fileCount: 0,
  drawingCount: 0,
  estimates: [],
  quotes: [],
  shares: [],
  comments: [],
  latestJob: null,
  deals: [],
};

const linkageSignal: Record<string, number> = {
  L0: 12,
  L1: 48,
  L2: 74,
  L3: 100,
};

const statusToneClasses: Record<WorkflowLayer["status"], string> = {
  ready: "border-emerald-400/30 bg-emerald-500/15 text-emerald-100",
  active: "border-cyan-400/30 bg-cyan-500/15 text-cyan-100",
  watch: "border-amber-400/30 bg-amber-500/15 text-amber-100",
  blocked: "border-rose-400/30 bg-rose-500/15 text-rose-100",
};

const fmtDate = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Not yet";

const fmtCompactDate = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "Pending";

const fmtCurrency = (value: number | null | undefined, currency = "CAD") => {
  if (value == null) return "Pending";
  try {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString()}`;
  }
};

const clampSignal = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const buildLayerStyle = (index: number, activeIndex: number) => {
  const offset = index - activeIndex;
  const distance = Math.abs(offset);
  const hidden = distance > 3;
  const translateY = offset * 50;
  const translateX = distance * 20 * (offset < 0 ? -1 : 1);
  const scale = Math.max(0.7, 1 - distance * 0.09);
  const rotateX = offset * -5;
  const rotateZ = offset * -3;

  return {
    opacity: hidden ? 0 : Math.max(0.14, 1 - distance * 0.18),
    zIndex: 100 - distance,
    transform: `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale}) rotateX(${rotateX}deg) rotateZ(${rotateZ}deg)`,
    filter: `blur(${hidden ? 8 : distance * 0.45}px)`,
    pointerEvents: hidden ? "none" : "auto",
  } as const;
};

const deriveReviewStage = (snapshot: WorkflowSnapshot) => {
  const latestShare = snapshot.shares[0];
  if (latestShare?.review_type === "customer_quote") return "Sent to customer";
  if (latestShare?.review_type === "quote_approval" && latestShare.status === "commented") return "Neel approved";
  if (latestShare?.review_type === "quote_approval") return "Waiting on Neel";
  if (latestShare?.review_type === "estimation_review" && latestShare.status === "commented") return "Ben approved";
  if (latestShare?.review_type === "estimation_review") return "Waiting on Ben";
  if (snapshot.estimates.length > 0) return "Estimation ready";
  return "Review not started";
};

const deriveSuggestedLayer = (snapshot: WorkflowSnapshot) => {
  const project = snapshot.project;
  if (!project) return 0;
  if (snapshot.quotes.length > 0 || snapshot.deals.length > 0) return 5;
  if (snapshot.shares.length > 0 || snapshot.comments.length > 0) return 4;
  if (snapshot.estimates.length > 0 || project.workflow_status === "estimated") return 3;
  if ((project.scope_items?.length ?? 0) > 0 || snapshot.drawingCount > 0 || snapshot.latestJob) return 2;
  if (snapshot.fileCount > 0) return 1;
  return 0;
};

const MetricTile: React.FC<{
  label: string;
  value: string;
  hint: string;
  accentClass?: string;
}> = ({ label, value, hint, accentClass }) => (
  <div className={cn("rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm", accentClass)}>
    <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">{label}</p>
    <p className="mt-2 text-2xl font-semibold tracking-tight text-white">{value}</p>
    <p className="mt-2 text-xs text-slate-400">{hint}</p>
  </div>
);

const SignalPill: React.FC<{
  label: string;
  tone: WorkflowLayer["status"];
}> = ({ label, tone }) => (
  <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium", statusToneClasses[tone])}>
    {label}
  </span>
);

const WorkflowCommandCenterPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(searchParams.get("projectId"));
  const [snapshot, setSnapshot] = useState<WorkflowSnapshot>(emptySnapshot);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [activeLayerIndex, setActiveLayerIndex] = useState(0);
  const [manualLayerSelection, setManualLayerSelection] = useState(false);

  const syncProjectSelection = (projectId: string | null) => {
    setSelectedProjectId(projectId);
    if (projectId) {
      setSearchParams({ projectId }, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  };

  useEffect(() => {
    let cancelled = false;

    const loadProjects = async () => {
      if (!user) return;
      setLoadingProjects(true);
      const { data, error: projectsError } = await supabase
        .from("projects")
        .select("*")
        .order("updated_at", { ascending: false });

      if (cancelled) return;

      if (projectsError) {
        setError(projectsError.message);
        setProjects([]);
        setLoadingProjects(false);
        return;
      }

      const nextProjects = data || [];
      setProjects(nextProjects);
      setLoadingProjects(false);

      const requestedProjectId = searchParams.get("projectId");
      const requestedExists = requestedProjectId && nextProjects.some((project) => project.id === requestedProjectId);
      const currentExists = selectedProjectId && nextProjects.some((project) => project.id === selectedProjectId);

      if (requestedExists) {
        setSelectedProjectId(requestedProjectId);
      } else if (currentExists) {
        setSelectedProjectId(selectedProjectId);
      } else if (nextProjects[0]) {
        syncProjectSelection(nextProjects[0].id);
      } else {
        syncProjectSelection(null);
      }
    };

    loadProjects();
    return () => {
      cancelled = true;
    };
  }, [user, refreshTick]);

  useEffect(() => {
    const queryProjectId = searchParams.get("projectId");
    if (queryProjectId && queryProjectId !== selectedProjectId) {
      setSelectedProjectId(queryProjectId);
    }
  }, [searchParams, selectedProjectId]);

  useEffect(() => {
    let cancelled = false;

    const loadSnapshot = async () => {
      if (!user || !selectedProjectId) {
        setSnapshot(emptySnapshot);
        return;
      }

      setLoadingSnapshot(true);
      setError(null);

      const [
        projectRes,
        fileCountRes,
        drawingCountRes,
        estimatesRes,
        quotesRes,
        sharesRes,
        jobsRes,
        dealsRes,
      ] = await Promise.all([
        supabase.from("projects").select("*").eq("id", selectedProjectId).single(),
        supabase.from("project_files").select("id", { count: "exact", head: true }).eq("project_id", selectedProjectId),
        supabase.from("drawing_search_index").select("id", { count: "exact", head: true }).eq("project_id", selectedProjectId),
        supabase
          .from("estimate_versions")
          .select("id, version_number, total_estimated_cost, confidence_score, status, created_at, currency")
          .eq("project_id", selectedProjectId)
          .order("version_number", { ascending: false })
          .limit(5),
        supabase
          .from("quote_versions")
          .select("id, version_number, quoted_price, currency, status, created_at, issued_at")
          .eq("project_id", selectedProjectId)
          .order("version_number", { ascending: false })
          .limit(5),
        supabase
          .from("review_shares")
          .select("id, review_type, reviewer_name, reviewer_email, status, created_at, expires_at")
          .eq("project_id", selectedProjectId)
          .order("created_at", { ascending: false })
          .limit(6),
        supabase
          .from("processing_jobs")
          .select("*")
          .eq("project_id", selectedProjectId)
          .order("created_at", { ascending: false })
          .limit(5),
        supabase
          .from("crm_deals")
          .select("id, crm_deal_id, deal_name, deal_value, stage, status, company_name, synced_at")
          .order("synced_at", { ascending: false })
          .limit(5),
      ]);

      const shareIds = (sharesRes.data || []).map((share) => share.id);
      const commentsRes = shareIds.length
        ? await supabase
            .from("review_comments")
            .select("id, share_id, author_name, author_email, content, created_at")
            .in("share_id", shareIds)
            .order("created_at", { ascending: false })
            .limit(12)
        : { data: [], error: null };

      if (cancelled) return;

      const firstError =
        projectRes.error ||
        fileCountRes.error ||
        drawingCountRes.error ||
        estimatesRes.error ||
        quotesRes.error ||
        sharesRes.error ||
        jobsRes.error ||
        dealsRes.error ||
        commentsRes.error;

      if (firstError) {
        setError(firstError.message);
        setLoadingSnapshot(false);
        return;
      }

      setSnapshot({
        project: projectRes.data,
        fileCount: fileCountRes.count || 0,
        drawingCount: drawingCountRes.count || 0,
        estimates: (estimatesRes.data || []) as EstimateSummaryRow[],
        quotes: (quotesRes.data || []) as QuoteSummaryRow[],
        shares: (sharesRes.data || []) as ReviewShareSummaryRow[],
        comments: (commentsRes.data || []) as ReviewCommentSummaryRow[],
        latestJob: jobsRes.data?.[0] || null,
        deals: (dealsRes.data || []) as CrmDealSummaryRow[],
      });
      setLoadingSnapshot(false);
    };

    loadSnapshot();
    return () => {
      cancelled = true;
    };
  }, [user, selectedProjectId, refreshTick]);

  useEffect(() => {
    if (!selectedProjectId) return;

    const channel = supabase
      .channel(`workflow-command-center:${selectedProjectId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "projects", filter: `id=eq.${selectedProjectId}` }, () => setRefreshTick((value) => value + 1))
      .on("postgres_changes", { event: "*", schema: "public", table: "project_files", filter: `project_id=eq.${selectedProjectId}` }, () => setRefreshTick((value) => value + 1))
      .on("postgres_changes", { event: "*", schema: "public", table: "drawing_search_index", filter: `project_id=eq.${selectedProjectId}` }, () => setRefreshTick((value) => value + 1))
      .on("postgres_changes", { event: "*", schema: "public", table: "processing_jobs", filter: `project_id=eq.${selectedProjectId}` }, () => setRefreshTick((value) => value + 1))
      .on("postgres_changes", { event: "*", schema: "public", table: "estimate_versions", filter: `project_id=eq.${selectedProjectId}` }, () => setRefreshTick((value) => value + 1))
      .on("postgres_changes", { event: "*", schema: "public", table: "quote_versions", filter: `project_id=eq.${selectedProjectId}` }, () => setRefreshTick((value) => value + 1))
      .on("postgres_changes", { event: "*", schema: "public", table: "review_shares", filter: `project_id=eq.${selectedProjectId}` }, () => setRefreshTick((value) => value + 1))
      .on("postgres_changes", { event: "*", schema: "public", table: "review_comments" }, () => setRefreshTick((value) => value + 1))
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedProjectId]);

  const suggestedLayerIndex = useMemo(() => deriveSuggestedLayer(snapshot), [snapshot]);

  useEffect(() => {
    setManualLayerSelection(false);
  }, [selectedProjectId]);

  useEffect(() => {
    if (!manualLayerSelection) {
      setActiveLayerIndex(suggestedLayerIndex);
    }
  }, [suggestedLayerIndex, manualLayerSelection]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTypingTarget = target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if (isTypingTarget) return;

      if (event.key === "ArrowRight") {
        setManualLayerSelection(true);
        setActiveLayerIndex((current) => Math.min(current + 1, layers.length - 1));
      }
      if (event.key === "ArrowLeft") {
        setManualLayerSelection(true);
        setActiveLayerIndex((current) => Math.max(current - 1, 0));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [layers.length]);

  const project = snapshot.project;
  const latestEstimate = snapshot.estimates[0];
  const latestQuote = snapshot.quotes[0];
  const latestShare = snapshot.shares[0];
  const latestComment = snapshot.comments[0];
  const latestDeal = snapshot.deals[0];
  const latestJobProgress = typeof snapshot.latestJob?.progress === "number"
    ? snapshot.latestJob.progress
    : linkageSignal[project?.linkage_score || "L0"];
  const scopeCount = project?.scope_items?.length ?? 0;
  const reviewStage = deriveReviewStage(snapshot);
  const confidenceSignal = latestEstimate?.confidence_score != null
    ? clampSignal(latestEstimate.confidence_score * 100)
    : snapshot.estimates.length > 0
      ? 55
      : 12;
  const pipelineSignal = clampSignal(
    snapshot.latestJob?.status === "processing"
      ? latestJobProgress || 18
      : linkageSignal[project?.linkage_score || "L0"],
  );
  const reviewSignal = clampSignal(
    latestShare?.review_type === "customer_quote"
      ? 100
      : latestShare?.review_type === "quote_approval" && latestShare.status === "commented"
        ? 88
        : latestShare?.review_type === "quote_approval"
          ? 72
          : latestShare?.review_type === "estimation_review" && latestShare.status === "commented"
            ? 56
            : latestShare?.review_type === "estimation_review"
              ? 36
              : snapshot.estimates.length > 0
                ? 20
                : 0,
  );
  const quoteSignal = clampSignal(
    latestDeal
      ? 100
      : latestQuote?.status === "issued"
        ? 78
        : latestQuote
          ? 58
          : 10,
  );

  const overviewSignal = clampSignal(
    (
      Math.min(snapshot.fileCount > 0 ? 100 : 18, 100) +
      pipelineSignal +
      confidenceSignal +
      reviewSignal +
      quoteSignal
    ) / 5,
  );

  const layers = useMemo<WorkflowLayer[]>(() => [
    {
      id: "overview",
      title: "Mission overview",
      eyebrow: "Bird's-eye intelligence",
      description: "A full-project holographic view that blends intake, automation, review, and commercial handoff into one operating picture.",
      icon: Radar,
      accentClass: "from-cyan-500/35 via-sky-500/15 to-transparent",
      signal: overviewSignal,
      status: overviewSignal >= 80 ? "ready" : overviewSignal >= 45 ? "active" : "watch",
      statusLabel: overviewSignal >= 80 ? "High readiness" : overviewSignal >= 45 ? "In motion" : "Needs momentum",
      metrics: [
        { label: "Workflow", value: project?.workflow_status || "intake", hint: "Current persisted project state" },
        { label: "Linkage", value: project?.linkage_score || "L0", hint: "Pipeline maturity score" },
        { label: "Review", value: reviewStage, hint: "Latest approval signal" },
      ],
      bullets: [
        snapshot.fileCount > 0 ? `${snapshot.fileCount} source files attached to the project` : "No files uploaded yet",
        snapshot.drawingCount > 0 ? `${snapshot.drawingCount} indexed drawing records are searchable` : "Drawings are not indexed yet",
        latestEstimate ? `Estimate v${latestEstimate.version_number} is the latest estimation snapshot` : "No estimate snapshot has been created yet",
      ],
      timeline: [
        `Project created ${fmtCompactDate(project?.created_at)}`,
        snapshot.latestJob ? `Latest pipeline job ${snapshot.latestJob.status}` : "No pipeline job recorded",
        latestQuote ? `Commercial motion with quote v${latestQuote.version_number}` : "Commercial layer not active yet",
      ],
    },
    {
      id: "intake",
      title: "Intake deck",
      eyebrow: "Project entry layer",
      description: "This layer tracks the source package, client context, and whether the project is ready to enter the automated pipeline.",
      icon: Upload,
      accentClass: "from-fuchsia-500/30 via-violet-500/15 to-transparent",
      signal: snapshot.fileCount > 0 ? 100 : 16,
      status: snapshot.fileCount > 0 ? "ready" : "blocked",
      statusLabel: snapshot.fileCount > 0 ? "Sources loaded" : "Waiting for drawings",
      metrics: [
        { label: "Files", value: `${snapshot.fileCount}`, hint: "Blueprints and intake documents" },
        { label: "Scope items", value: `${scopeCount}`, hint: "Structured scope hints stored on the project" },
        { label: "Client", value: project?.client_name || "Unassigned", hint: "Commercial contact context" },
      ],
      bullets: [
        project?.project_type ? `Project type captured as ${project.project_type}` : "Project type has not been set yet",
        project?.intake_complete ? "Intake has been marked complete by the pipeline" : "Intake completion will flip on after readiness improves",
        project?.address ? `Project address: ${project.address}` : "No address attached to the project card",
      ],
      timeline: [
        `Project opened ${fmtDate(project?.created_at)}`,
        snapshot.fileCount > 0 ? "Source package exists in project_files" : "Waiting for source package",
        scopeCount > 0 ? `${scopeCount} scope items are already defined` : "Scope items are still empty",
      ],
    },
    {
      id: "pipeline",
      title: "Automation pipeline",
      eyebrow: "Indexing + scope intelligence",
      description: "The engine checks for uploaded files, indexed drawings, scope detection, and estimate readiness to compute workflow state and linkage score.",
      icon: Database,
      accentClass: "from-emerald-500/30 via-teal-500/15 to-transparent",
      signal: pipelineSignal,
      status: pipelineSignal >= 75 ? "ready" : pipelineSignal >= 35 ? "active" : "watch",
      statusLabel: snapshot.latestJob?.status === "processing" ? "Actively processing" : project?.workflow_status === "estimated" ? "Pipeline complete" : "Building context",
      metrics: [
        { label: "Pipeline pulse", value: `${pipelineSignal}%`, hint: "Live readiness signal from workflow + jobs" },
        { label: "Indexed drawings", value: `${snapshot.drawingCount}`, hint: "Searchable drawing rows in Supabase" },
        { label: "Latest job", value: snapshot.latestJob?.status || "idle", hint: "Most recent processing job state" },
      ],
      bullets: [
        project?.workflow_status ? `Workflow status persisted as ${project.workflow_status}` : "Workflow status has not been populated",
        project?.linkage_score ? `Linkage score currently resolves to ${project.linkage_score}` : "Linkage score is waiting for evidence",
        snapshot.latestJob?.error_message ? `Latest pipeline issue: ${snapshot.latestJob.error_message.slice(0, 90)}` : "No pipeline error is visible in the latest job",
      ],
      timeline: [
        snapshot.fileCount > 0 ? "Files detected by process-pipeline" : "No files detected yet",
        snapshot.drawingCount > 0 ? "Drawings index is populated" : "Indexing has not produced drawing rows yet",
        scopeCount > 0 ? "Scope evidence exists for pipeline promotion" : "Scope detection is still pending",
      ],
    },
    {
      id: "estimation",
      title: "Estimation engine",
      eyebrow: "Atomic truth synthesis",
      description: "Estimate snapshots are persisted as versions so the UI can compare, review, and route work downstream without losing state.",
      icon: Brain,
      accentClass: "from-blue-500/30 via-indigo-500/15 to-transparent",
      signal: confidenceSignal,
      status: latestEstimate ? "active" : "watch",
      statusLabel: latestEstimate ? `Estimate v${latestEstimate.version_number} live` : "Awaiting estimate snapshot",
      metrics: [
        { label: "Estimates", value: `${snapshot.estimates.length}`, hint: "Recent estimate versions available" },
        { label: "Confidence", value: latestEstimate ? `${confidenceSignal}%` : "Pending", hint: "Latest persisted confidence signal" },
        { label: "Cost basis", value: fmtCurrency(latestEstimate?.total_estimated_cost, latestEstimate?.currency || "CAD"), hint: "Latest estimated total cost" },
      ],
      bullets: [
        latestEstimate ? `Latest estimate status is ${latestEstimate.status || "draft"}` : "No estimate version has been written yet",
        snapshot.estimates.length > 1 ? `${snapshot.estimates.length} versions are available for comparison` : "Version history will accumulate as estimates evolve",
        project?.workflow_status === "estimated" ? "Project workflow already reflects estimated state" : "Workflow will elevate to estimated after prerequisites align",
      ],
      timeline: [
        latestEstimate ? `Estimate created ${fmtDate(latestEstimate.created_at)}` : "No estimate creation event yet",
        latestEstimate ? `Confidence signal recorded at ${confidenceSignal}%` : "Confidence will appear after resolve-scope and persistence",
        "Estimate snapshots power review, quote, and downstream diagnostics",
      ],
    },
    {
      id: "review",
      title: "Human review mesh",
      eyebrow: "Approval chain and feedback loop",
      description: "Internal approvals and external review links turn estimation output into controlled, auditable decisions before the quote leaves the system.",
      icon: MessageSquare,
      accentClass: "from-amber-500/30 via-orange-500/15 to-transparent",
      signal: reviewSignal,
      status: snapshot.shares.length > 0 ? "active" : snapshot.estimates.length > 0 ? "watch" : "blocked",
      statusLabel: reviewStage,
      metrics: [
        { label: "Review links", value: `${snapshot.shares.length}`, hint: "Recent review shares created for this project" },
        { label: "Comments", value: `${snapshot.comments.length}`, hint: "Visible reviewer feedback across active shares" },
        { label: "Latest share", value: latestShare?.status || "none", hint: "Current state of the newest review link" },
      ],
      bullets: [
        latestShare ? `Latest review type is ${latestShare.review_type || "estimation_review"}` : "No review share has been generated yet",
        latestComment ? `${latestComment.author_name} left the newest comment` : "No reviewer comments have landed yet",
        snapshot.comments.length > 0 ? "Feedback loop is active and visible in the command center" : "Feedback loop will surface as comments arrive",
      ],
      timeline: [
        snapshot.estimates.length > 0 ? "Estimate is eligible for review routing" : "Estimate required before review routing",
        latestShare ? `${latestShare.reviewer_name || latestShare.reviewer_email} invited ${fmtCompactDate(latestShare.created_at)}` : "No reviewer invited yet",
        latestComment ? `Latest reviewer note arrived ${fmtCompactDate(latestComment.created_at)}` : "Waiting on reviewer feedback",
      ],
    },
    {
      id: "commercial",
      title: "Quote + CRM handoff",
      eyebrow: "Commercial execution",
      description: "Quotes become the commercial envelope for the project, and CRM sync pushes the latest value into the external sales workflow.",
      icon: Building2,
      accentClass: "from-rose-500/30 via-pink-500/15 to-transparent",
      signal: quoteSignal,
      status: latestDeal ? "ready" : latestQuote ? "active" : "watch",
      statusLabel: latestDeal ? "CRM synced" : latestQuote?.status === "issued" ? "Quote issued" : latestQuote ? "Draft quote live" : "Waiting for commercial package",
      metrics: [
        { label: "Quotes", value: `${snapshot.quotes.length}`, hint: "Recent quote versions available" },
        { label: "Top quote", value: fmtCurrency(latestQuote?.quoted_price, latestQuote?.currency || "CAD"), hint: "Newest commercial offer value" },
        { label: "CRM bridge", value: latestDeal?.stage || "offline", hint: "Latest CRM deal stage detected" },
      ],
      bullets: [
        latestQuote ? `Quote v${latestQuote.version_number} is the latest proposal package` : "Quote workflow has not started yet",
        latestQuote?.issued_at ? `Quote was issued on ${fmtCompactDate(latestQuote.issued_at)}` : "Quote has not been formally issued yet",
        latestDeal ? `Latest CRM deal is ${latestDeal.deal_name || latestDeal.crm_deal_id}` : "CRM sync will appear once a quote is pushed outward",
      ],
      timeline: [
        latestQuote ? `Latest quote created ${fmtDate(latestQuote.created_at)}` : "No quote version has been created",
        latestDeal ? `CRM synced ${fmtDate(latestDeal.synced_at)}` : "No CRM sync event detected",
        latestDeal?.company_name ? `Company context: ${latestDeal.company_name}` : "CRM company context not visible yet",
      ],
    },
  ], [
    confidenceSignal,
    latestComment,
    latestDeal,
    latestEstimate,
    latestQuote,
    latestShare,
    overviewSignal,
    pipelineSignal,
    project,
    quoteSignal,
    reviewSignal,
    reviewStage,
    scopeCount,
    snapshot.comments.length,
    snapshot.drawingCount,
    snapshot.estimates.length,
    snapshot.fileCount,
    snapshot.latestJob,
    snapshot.quotes.length,
    snapshot.shares.length,
  ]);

  const activeLayer = layers[activeLayerIndex] || layers[0];
  const completedLayerCount = layers.filter((layer) => layer.signal >= 70).length;
  const commandSummary = `${completedLayerCount}/${layers.length} layers above operational threshold`;
  const latestEvent = latestComment?.content || snapshot.latestJob?.error_message || latestShare?.status || latestQuote?.status || "System watching for the next signal";

  if (loadingProjects) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading workflow command center...
        </div>
      </div>
    );
  }

  return (
    <div className="workflow-cosmos min-h-screen text-white">
      <div className="workflow-grid absolute inset-0" />
      <div className="workflow-scanline pointer-events-none absolute inset-0 opacity-70" />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1600px] flex-col px-4 py-4 sm:px-6 lg:px-8">
        <header className="glass-card mb-6 flex flex-col gap-4 rounded-[28px] border border-white/10 bg-slate-950/55 px-4 py-4 shadow-[0_25px_100px_rgba(0,0,0,0.35)] backdrop-blur-xl sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/")}
              className="h-10 w-10 rounded-full border border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <Badge className="border-cyan-400/30 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/20">
                  <Sparkles className="mr-1 h-3 w-3" />
                  Workflow command center
                </Badge>
                <Badge variant="outline" className="border-white/10 bg-white/5 text-slate-200">
                  Intelligent layered UI
                </Badge>
              </div>
              <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
                Futuristic bird&apos;s-eye view of the full project workflow
              </h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-300">
                Move forward and backward through operational layers to understand how a project travels from intake to AI estimation, review, quoting, and CRM execution.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="min-w-[240px]">
              <Select
                value={selectedProjectId || ""}
                onValueChange={(value) => {
                  setManualLayerSelection(false);
                  syncProjectSelection(value);
                }}
              >
                <SelectTrigger className="h-11 rounded-2xl border-white/10 bg-white/5 text-white">
                  <SelectValue placeholder="Select a project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((projectOption) => (
                    <SelectItem key={projectOption.id} value={projectOption.id}>
                      {projectOption.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              variant="outline"
              onClick={() => setRefreshTick((value) => value + 1)}
              className="h-11 rounded-2xl border-white/10 bg-white/5 text-white hover:bg-white/10"
            >
              <RefreshCw className={cn("h-4 w-4", loadingSnapshot && "animate-spin")} />
              Refresh signals
            </Button>
          </div>
        </header>

        {!projects.length ? (
          <Card className="border-white/10 bg-slate-950/55 text-white shadow-[0_25px_90px_rgba(0,0,0,0.3)]">
            <CardContent className="flex min-h-[420px] flex-col items-center justify-center gap-4 p-8 text-center">
              <FolderOpen className="h-12 w-12 text-cyan-300" />
              <h2 className="text-2xl font-semibold">No projects are available yet</h2>
              <p className="max-w-lg text-sm text-slate-300">
                Create a project from the dashboard first, then return to this command center to inspect the workflow in layered detail.
              </p>
              <Button onClick={() => navigate("/")} className="rounded-2xl">
                Back to dashboard
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <section className="mb-6 grid gap-4 xl:grid-cols-[1.45fr_1fr]">
              <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/60 p-5 shadow-[0_25px_100px_rgba(2,6,23,0.45)] backdrop-blur-xl sm:p-6">
                <div className="workflow-core-glow absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-500/10 blur-3xl" />
                <div className="relative z-10 flex flex-col gap-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.35em] text-cyan-200/80">Current project pulse</p>
                      <h2 className="mt-2 text-3xl font-semibold tracking-tight">{project?.name || "Project not selected"}</h2>
                      <p className="mt-2 max-w-2xl text-sm text-slate-300">
                        {project?.description || "This command center aggregates the project's realtime automation, review, and commercial signals into one futuristic operating surface."}
                      </p>
                    </div>
                    <div className="rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-right">
                      <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">Command summary</p>
                      <p className="mt-2 text-lg font-semibold text-white">{commandSummary}</p>
                      <p className="mt-1 text-xs text-slate-400">{latestEvent}</p>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <MetricTile label="Workflow state" value={project?.workflow_status || "intake"} hint="Persisted state machine output" />
                    <MetricTile label="Linkage score" value={project?.linkage_score || "L0"} hint="Pipeline confidence maturity" />
                    <MetricTile label="Project assets" value={`${snapshot.fileCount} files`} hint="Drawings and supporting artifacts loaded" />
                    <MetricTile label="Commercial edge" value={latestQuote ? `v${latestQuote.version_number}` : "Dormant"} hint="Latest quote layer status" />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                    {layers.map((layer, index) => {
                      const Icon = layer.icon;
                      const isActive = index === activeLayerIndex;
                      return (
                        <button
                          key={layer.id}
                          type="button"
                          onClick={() => {
                            setManualLayerSelection(true);
                            setActiveLayerIndex(index);
                          }}
                          className={cn(
                            "group rounded-2xl border px-3 py-3 text-left transition-all duration-300",
                            isActive
                              ? "border-cyan-300/50 bg-cyan-400/10 shadow-[0_0_35px_rgba(34,211,238,0.18)]"
                              : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/8",
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <Icon className={cn("h-4 w-4 text-cyan-200", isActive && "workflow-icon-orbit")} />
                            <span className="text-[10px] uppercase tracking-[0.26em] text-slate-400">L{index + 1}</span>
                          </div>
                          <p className="mt-3 text-sm font-medium text-white">{layer.title}</p>
                          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-blue-400 to-fuchsia-400 transition-all duration-500"
                              style={{ width: `${layer.signal}%` }}
                            />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-1">
                <MetricTile label="Latest job" value={snapshot.latestJob?.status || "idle"} hint={snapshot.latestJob ? `Updated ${fmtCompactDate(snapshot.latestJob.created_at)}` : "No active job yet"} accentClass="border-cyan-400/15" />
                <MetricTile label="Review mesh" value={`${snapshot.shares.length} links`} hint={`${snapshot.comments.length} feedback events captured`} accentClass="border-amber-400/15" />
                <MetricTile label="CRM sync" value={latestDeal?.stage || "offline"} hint={latestDeal ? fmtCompactDate(latestDeal.synced_at) : "Waiting on commercial sync"} accentClass="border-fuchsia-400/15" />
              </div>
            </section>

            {error && (
              <div className="mb-4 rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                {error}
              </div>
            )}

            <section className="grid flex-1 gap-6 xl:grid-cols-[1.15fr_0.85fr]">
              <div className="relative min-h-[640px] overflow-hidden rounded-[32px] border border-white/10 bg-slate-950/60 p-5 shadow-[0_30px_100px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:p-6">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(56,189,248,0.12),transparent_28%),radial-gradient(circle_at_20%_80%,rgba(217,70,239,0.12),transparent_30%)]" />
                <div className="relative z-10 flex h-full flex-col">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.35em] text-slate-400">Layer navigator</p>
                      <h3 className="mt-2 text-xl font-semibold">Forward/backward cinematic stack</h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setManualLayerSelection(true);
                          setActiveLayerIndex((current) => Math.max(current - 1, 0));
                        }}
                        disabled={activeLayerIndex === 0}
                        className="h-10 w-10 rounded-full border border-white/10 bg-white/5 text-white hover:bg-white/10 disabled:opacity-40"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setManualLayerSelection(true);
                          setActiveLayerIndex((current) => Math.min(current + 1, layers.length - 1));
                        }}
                        disabled={activeLayerIndex === layers.length - 1}
                        className="h-10 w-10 rounded-full border border-white/10 bg-white/5 text-white hover:bg-white/10 disabled:opacity-40"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="workflow-layer-shell relative flex-1">
                    <div className="pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-400/10 bg-cyan-400/5 blur-3xl" />
                    {layers.map((layer, index) => {
                      const Icon = layer.icon;
                      const isActive = index === activeLayerIndex;
                      return (
                        <button
                          key={layer.id}
                          type="button"
                          onClick={() => {
                            setManualLayerSelection(true);
                            setActiveLayerIndex(index);
                          }}
                          style={buildLayerStyle(index, activeLayerIndex)}
                          className={cn(
                            "absolute left-1/2 top-1/2 h-[74%] w-[88%] -translate-x-1/2 -translate-y-1/2 rounded-[30px] border text-left transition-all duration-500 ease-out",
                            "bg-[linear-gradient(145deg,rgba(15,23,42,0.92),rgba(15,23,42,0.72))] shadow-[0_25px_80px_rgba(2,6,23,0.45)]",
                            isActive ? "border-cyan-300/40" : "border-white/10",
                          )}
                        >
                          <div className={cn("absolute inset-0 rounded-[30px] bg-gradient-to-br opacity-70", layer.accentClass)} />
                          <div className="relative flex h-full flex-col justify-between p-5 sm:p-6">
                            <div>
                              <div className="flex items-start justify-between gap-4">
                                <div className="rounded-2xl border border-white/10 bg-white/10 p-3">
                                  <Icon className={cn("h-6 w-6 text-white", isActive && "workflow-icon-orbit")} />
                                </div>
                                <SignalPill label={layer.statusLabel} tone={layer.status} />
                              </div>

                              <div className="mt-8">
                                <p className="text-[11px] uppercase tracking-[0.35em] text-slate-300">{layer.eyebrow}</p>
                                <h4 className="mt-3 text-3xl font-semibold tracking-tight text-white">{layer.title}</h4>
                                <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">{layer.description}</p>
                              </div>
                            </div>

                            <div className="space-y-4">
                              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-blue-400 to-fuchsia-400 transition-all duration-500"
                                  style={{ width: `${layer.signal}%` }}
                                />
                              </div>

                              <div className="grid gap-3 sm:grid-cols-3">
                                {layer.metrics.map((metric) => (
                                  <div key={metric.label} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                                    <p className="text-[10px] uppercase tracking-[0.26em] text-slate-400">{metric.label}</p>
                                    <p className="mt-2 text-lg font-semibold text-white">{metric.value}</p>
                                    <p className="mt-1 text-[11px] text-slate-400">{metric.hint}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {layers.map((layer, index) => (
                      <button
                        key={layer.id}
                        type="button"
                        onClick={() => {
                          setManualLayerSelection(true);
                          setActiveLayerIndex(index);
                        }}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-xs transition-colors",
                          index === activeLayerIndex
                            ? "border-cyan-300/40 bg-cyan-500/15 text-cyan-100"
                            : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10",
                        )}
                      >
                        {layer.title}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid gap-6">
                <Card className="overflow-hidden rounded-[32px] border-white/10 bg-slate-950/60 text-white shadow-[0_30px_100px_rgba(0,0,0,0.4)] backdrop-blur-xl">
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.35em] text-slate-400">Active layer detail</p>
                        <h3 className="mt-2 text-2xl font-semibold">{activeLayer.title}</h3>
                        <p className="mt-2 text-sm text-slate-300">{activeLayer.description}</p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                        <activeLayer.icon className="h-6 w-6 text-cyan-200" />
                      </div>
                    </div>

                    <div className="mt-6 grid gap-3 sm:grid-cols-2">
                      {activeLayer.metrics.map((metric) => (
                        <div key={metric.label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                          <p className="text-[10px] uppercase tracking-[0.26em] text-slate-400">{metric.label}</p>
                          <p className="mt-2 text-xl font-semibold text-white">{metric.value}</p>
                          <p className="mt-2 text-xs text-slate-400">{metric.hint}</p>
                        </div>
                      ))}
                    </div>

                    <div className="mt-6 grid gap-6 lg:grid-cols-2">
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Design signals</p>
                        <ul className="mt-3 space-y-3">
                          {activeLayer.bullets.map((bullet) => (
                            <li key={bullet} className="flex items-start gap-3 text-sm text-slate-200">
                              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-cyan-300" />
                              <span>{bullet}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Recent timeline</p>
                        <div className="mt-3 space-y-3">
                          {activeLayer.timeline.map((item, index) => (
                            <div key={`${activeLayer.id}-${item}`} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 p-3">
                              <div className="mt-1 flex h-6 w-6 items-center justify-center rounded-full bg-cyan-400/15 text-[11px] font-semibold text-cyan-100">
                                {index + 1}
                              </div>
                              <p className="text-sm text-slate-200">{item}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="rounded-[32px] border-white/10 bg-slate-950/60 text-white shadow-[0_30px_100px_rgba(0,0,0,0.35)] backdrop-blur-xl">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.35em] text-slate-400">Realtime telemetry</p>
                        <h3 className="mt-2 text-xl font-semibold">Operational event stream</h3>
                      </div>
                      <div className="flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-100">
                        <Activity className="h-3.5 w-3.5" />
                        Live
                      </div>
                    </div>

                    <div className="mt-5 space-y-3">
                      {[
                        {
                          icon: Layers3,
                          label: "Workflow state",
                          value: project?.workflow_status || "intake",
                          time: fmtCompactDate(project?.updated_at),
                        },
                        {
                          icon: GitBranch,
                          label: "Latest pipeline job",
                          value: snapshot.latestJob ? `${snapshot.latestJob.status} · ${snapshot.latestJob.progress || 0}%` : "No job yet",
                          time: fmtCompactDate(snapshot.latestJob?.created_at),
                        },
                        {
                          icon: BarChart3,
                          label: "Latest estimate",
                          value: latestEstimate ? `v${latestEstimate.version_number} · ${fmtCurrency(latestEstimate.total_estimated_cost, latestEstimate.currency || "CAD")}` : "No estimate version",
                          time: fmtCompactDate(latestEstimate?.created_at),
                        },
                        {
                          icon: MessageSquare,
                          label: "Review signal",
                          value: latestShare ? `${latestShare.review_type || "estimation_review"} · ${latestShare.status}` : "No review share",
                          time: fmtCompactDate(latestShare?.created_at),
                        },
                        {
                          icon: FileText,
                          label: "Quote package",
                          value: latestQuote ? `v${latestQuote.version_number} · ${latestQuote.status || "draft"}` : "No quote yet",
                          time: fmtCompactDate(latestQuote?.created_at),
                        },
                        {
                          icon: Building2,
                          label: "CRM handoff",
                          value: latestDeal ? `${latestDeal.stage || latestDeal.status || "synced"} · ${latestDeal.deal_name || latestDeal.crm_deal_id}` : "No CRM sync yet",
                          time: fmtCompactDate(latestDeal?.synced_at),
                        },
                      ].map((eventItem) => {
                        const Icon = eventItem.icon;
                        return (
                          <div key={eventItem.label} className="flex items-start gap-4 rounded-2xl border border-white/10 bg-white/5 p-4">
                            <div className="rounded-2xl border border-white/10 bg-white/10 p-3">
                              <Icon className="h-4 w-4 text-cyan-200" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-4">
                                <p className="text-sm font-medium text-white">{eventItem.label}</p>
                                <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">{eventItem.time}</span>
                              </div>
                              <p className="mt-1 text-sm text-slate-300">{eventItem.value}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </section>

            {loadingSnapshot && (
              <div className="pointer-events-none fixed bottom-5 right-5 z-20 flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/80 px-4 py-2 text-sm text-slate-100 shadow-[0_20px_40px_rgba(0,0,0,0.35)]">
                <Loader2 className="h-4 w-4 animate-spin" />
                Synchronizing workflow telemetry...
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default WorkflowCommandCenterPage;
